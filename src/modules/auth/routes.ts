import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, pool, tx } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { randomHandle } from '../../lib/handle.js';
import { sendMail } from '../../lib/mailer.js';
import { applyAdminRole } from '../../lib/super.js';
import { checkPassword, hashPassword, newOpaqueToken, sha256, signAccessToken } from '../../lib/security.js';
import { isValidTimeZone } from '../../lib/time.js';
import { randomAvatar } from '../profile/avatar.js';

export const LEGAL_VERSION = '2026-10-30';

const Email = z.string().trim().toLowerCase().email().max(254);
const Password = z.string().min(8).max(128);

/** Country from the CDN / load balancer geo header, if one is configured in front of the API. */
function geoCountry(req: FastifyRequest): string | null {
  const h = req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country'] ?? req.headers['x-country-code'];
  return typeof h === 'string' && /^[A-Z]{2}$/i.test(h) ? h.toUpperCase() : null;
}

async function issueToken(userId: string, purpose: 'verify' | 'reset' | 'magic', ttlMinutes: number) {
  const { token, hash } = newOpaqueToken();
  await pool.query(
    `INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`,
    [hash, userId, purpose, ttlMinutes],
  );
  return token;
}

async function consumeToken(token: string, purpose: string): Promise<string> {
  const row = await one<{ user_id: string }>(pool,
    `UPDATE auth_tokens SET used_at = now()
     WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha256(token), purpose]);
  if (!row) throw badRequest('invalid_token', 'This link is invalid or has expired.');
  return row.user_id;
}

async function sendVerification(userId: string, email: string) {
  const token = await issueToken(userId, 'verify', 60 * 24);
  await sendMail({
    to: email,
    subject: 'Confirm your Fortune Muse email',
    text: `Welcome to Fortune Muse! Confirm your email to start your first reading:\n${config.APP_URL}/verify?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

/** Launch-region gate for new accounts. */
export function signupCountry(req: FastifyRequest, claimed?: string): string {
  const country = geoCountry(req) ?? claimed?.toUpperCase() ?? 'US';
  if (!config.launchCountries.includes(country)) {
    throw forbidden('region_unavailable', 'Fortune Muse is not available in your region yet.');
  }
  return country;
}

/** Creates the user with a handle, an avatar and the signup consents. Used by email signup and OAuth. */
export async function createUser(opts: {
  email: string; passwordHash: string | null; country: string; timezone?: string; emailVerified?: boolean;
  afterInsert?: (c: PoolClient, userId: string) => Promise<void>;
}): Promise<{ id: string; email: string; handle: string }> {
  const tz = opts.timezone && isValidTimeZone(opts.timezone) ? opts.timezone : 'America/New_York';
  return tx(async (c) => {
    let handle = randomHandle();
    for (let i = 0; i < 5 && (await one(c, 'SELECT 1 FROM users WHERE handle=$1', [handle])); i++) handle = randomHandle();
    const u = await one(c,
      `INSERT INTO users(email,password_hash,email_verified,handle,role,country,timezone,age_confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id, email, handle`,
      [opts.email, opts.passwordHash, opts.emailVerified ?? false, handle, 'user', opts.country, tz]);
    const av = randomAvatar();
    await c.query('INSERT INTO avatars(user_id,base_id,customization_json) VALUES ($1,$2,$3)', [u.id, av.base_id, av.customization]);
    for (const type of ['terms', 'privacy', 'age_18']) {
      await c.query('INSERT INTO consents(user_id,type,version) VALUES ($1,$2,$3)', [u.id, type, LEGAL_VERSION]);
    }
    await opts.afterInsert?.(c, u.id);
    return u;
  });
}

export async function sessionPayload(userId: string) {
  await applyAdminRole(userId);
  const u = await one(pool, 'SELECT id, role FROM users WHERE id=$1', [userId]);
  return { token: signAccessToken({ sub: u.id, role: u.role }) };
}

export default async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', strict, async (req) => {
    const body = z.object({
      email: Email,
      password: Password,
      ageConfirmed: z.literal(true, { message: 'You must be 18 or older to use Fortune Muse.' }),
      acceptTerms: z.literal(true, { message: 'Please accept the Terms and Privacy Policy.' }),
      timezone: z.string().optional(),
      country: z.string().length(2).optional(),
    }).parse(req.body);

    const country = signupCountry(req, body.country);
    if (await one(pool, 'SELECT 1 FROM users WHERE email=$1', [body.email])) {
      throw conflict('email_taken', 'An account with this email already exists.');
    }
    const user = await createUser({ email: body.email, passwordHash: await hashPassword(body.password), country, timezone: body.timezone });

    await sendVerification(user.id, user.email);
    track(user.id, 'signup');
    return sessionPayload(user.id);
  });

  app.post('/auth/login', strict, async (req) => {
    const body = z.object({ email: Email, password: z.string() }).parse(req.body);
    const u = await one(pool, 'SELECT id, password_hash, status FROM users WHERE email=$1', [body.email]);
    if (!u?.password_hash || !(await checkPassword(body.password, u.password_hash))) {
      throw unauthorized('Email or password is incorrect.');
    }
    if (u.status === 'banned') throw forbidden('banned', 'This account has been suspended.');
    track(u.id, 'login');
    return sessionPayload(u.id);
  });

  // Passwordless login. Always answers ok so the endpoint does not reveal which emails exist.
  app.post('/auth/magic-link', strict, async (req) => {
    const { email } = z.object({ email: Email }).parse(req.body);
    const u = await one(pool, 'SELECT id FROM users WHERE email=$1', [email]);
    if (u) {
      const token = await issueToken(u.id, 'magic', 15);
      await sendMail({ to: email, subject: 'Your Fortune Muse sign-in link', text: `Tap to sign in:\n${config.APP_URL}/magic?token=${token}\n\nThis link expires in 15 minutes.` });
    }
    return { ok: true };
  });

  app.post('/auth/magic/verify', strict, async (req) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    const userId = await consumeToken(token, 'magic');
    await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [userId]);
    return sessionPayload(userId);
  });

  app.post('/auth/verify-email', strict, async (req) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    const userId = await consumeToken(token, 'verify');
    await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [userId]);
    await applyAdminRole(userId);
    track(userId, 'email_verified');
    return { ok: true };
  });

  app.post('/auth/resend-verification', strict, async (req) => {
    const me = await requireUser(req);
    const u = await one(pool, 'SELECT email, email_verified FROM users WHERE id=$1', [me.id]);
    if (!u.email_verified) await sendVerification(me.id, u.email);
    return { ok: true };
  });

  app.post('/auth/forgot', strict, async (req) => {
    const { email } = z.object({ email: Email }).parse(req.body);
    const u = await one(pool, 'SELECT id FROM users WHERE email=$1', [email]);
    if (u) {
      const token = await issueToken(u.id, 'reset', 60);
      await sendMail({ to: email, subject: 'Reset your Fortune Muse password', text: `Reset your password here:\n${config.APP_URL}/reset?token=${token}\n\nThis link expires in 1 hour. If you did not ask for this, ignore this email.` });
    }
    return { ok: true };
  });

  app.post('/auth/reset', strict, async (req) => {
    const body = z.object({ token: z.string(), password: Password }).parse(req.body);
    const userId = await consumeToken(body.token, 'reset');
    await pool.query('UPDATE users SET password_hash=$2, email_verified=true WHERE id=$1', [userId, await hashPassword(body.password)]);
    return sessionPayload(userId);
  });
}
