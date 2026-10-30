import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, pool } from '../../db/pool.js';
import { badRequest, conflict, forbidden } from '../../lib/errors.js';
import { Language } from '../../lib/i18n.js';
import { track } from '../../lib/events.js';
import { newOpaqueToken, sha256 } from '../../lib/security.js';
import { createUser, sessionPayload, signupCountry } from './routes.js';

/**
 * Sign in with Google (Gmail), Microsoft (Outlook / Hotmail / Live) and Apple (iCloud).
 *
 * 1. App opens  GET {API}/auth/oauth/:provider/start?redirect=<app url>
 * 2. Provider → GET|POST {API}/auth/oauth/:provider/callback  (Apple posts a form)
 * 3. API redirects to <app url>?ticket=…  (or ?error=cancelled|failed)
 * 4. App posts the ticket to /auth/oauth/exchange: existing users get a session; new users are
 *    asked for the 18+ / terms consent first and then post the ticket again with it.
 *
 * Without keys a provider is replaced by a local test page in development (like dev payments).
 */

const PROVIDERS = ['google', 'microsoft', 'apple'] as const;
type Provider = (typeof PROVIDERS)[number];
const ProviderParam = z.object({ provider: z.enum(PROVIDERS) });

const LABEL: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };
const DEV_EMAIL: Record<Provider, string> = { google: 'you@gmail.com', microsoft: 'you@outlook.com', apple: 'you@icloud.com' };

// Personal Microsoft accounts (outlook.com, hotmail.com, live.com) all sign in through this tenant.
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const COOKIE = 'fm_oauth';

interface Identity { subject: string; email: string; emailVerified: boolean }
interface State { p: Provider; r: string; n: string }

const configured = (p: Provider) => ({
  google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  microsoft: !!(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET),
  apple: !!(config.APPLE_CLIENT_ID && config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY),
})[p];
const devMode = (p: Provider) => !configured(p) && config.NODE_ENV !== 'production';
const callbackUrl = (p: Provider) => `${config.API_URL}/auth/oauth/${p}/callback`;

/** Only send tickets back to the app itself: its web origins and its native scheme. */
export function allowedRedirect(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'fortunemuse:') return true;
  if (config.NODE_ENV !== 'production') {
    if (u.protocol === 'exp:') return true; // Expo Go
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return true;
  }
  // API_URL is where the admin console lives.
  const origins = [config.APP_URL, config.API_URL, ...config.corsOrigins].map((o) => { try { return new URL(o).origin; } catch { return ''; } });
  return origins.includes(u.origin);
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// SameSite=None so Apple's cross-site form POST still carries it. Browsers accept Secure on http://localhost.
const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/auth/oauth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;

// --- Provider protocol --------------------------------------------------------

function authorizeUrl(p: Provider, state: string, nonce: string): string {
  const common = { response_type: 'code', redirect_uri: callbackUrl(p), state, nonce };
  const [base, params] = {
    google: ['https://accounts.google.com/o/oauth2/v2/auth',
      { client_id: config.GOOGLE_CLIENT_ID!, scope: 'openid email profile', prompt: 'select_account' }],
    microsoft: ['https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      { client_id: config.MICROSOFT_CLIENT_ID!, scope: 'openid email profile', prompt: 'select_account' }],
    apple: ['https://appleid.apple.com/auth/authorize',
      { client_id: config.APPLE_CLIENT_ID!, scope: 'name email', response_mode: 'form_post' }],
  }[p] as [string, Record<string, string>];
  return `${base}?${new URLSearchParams({ ...common, ...params })}`;
}

function appleClientSecret(): string {
  return jwt.sign({}, config.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), {
    algorithm: 'ES256', keyid: config.APPLE_KEY_ID, issuer: config.APPLE_TEAM_ID,
    audience: 'https://appleid.apple.com', subject: config.APPLE_CLIENT_ID, expiresIn: '5m',
  });
}

async function postForm(url: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${data.error ?? 'unknown'} ${data.error_description ?? ''}`);
  return data;
}

/**
 * Trades the code for an ID token. The token comes straight from the provider over TLS, so per
 * OpenID Connect Core §3.1.3.7 we check its claims (issuer, audience, expiry, nonce) rather than its signature.
 */
async function exchangeCode(p: Provider, code: string, nonce: string): Promise<Identity> {
  const [tokenUrl, clientId, clientSecret] = {
    google: ['https://oauth2.googleapis.com/token', config.GOOGLE_CLIENT_ID!, config.GOOGLE_CLIENT_SECRET!],
    microsoft: ['https://login.microsoftonline.com/common/oauth2/v2.0/token', config.MICROSOFT_CLIENT_ID!, config.MICROSOFT_CLIENT_SECRET!],
    apple: ['https://appleid.apple.com/auth/token', config.APPLE_CLIENT_ID!, ''],
  }[p];
  const tokens = await postForm(tokenUrl, {
    grant_type: 'authorization_code', code, redirect_uri: callbackUrl(p),
    client_id: clientId, client_secret: p === 'apple' ? appleClientSecret() : clientSecret,
  });
  const c = jwt.decode(tokens.id_token) as Record<string, any> | null;
  if (!c) throw new Error('no id_token');
  const issOk = {
    google: c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com',
    microsoft: c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`,
    apple: c.iss === 'https://appleid.apple.com',
  }[p];
  if (!issOk || c.aud !== clientId || c.nonce !== nonce || !(c.exp * 1000 > Date.now())) throw new Error('id_token claims rejected');

  const email = String(c.email ?? '').trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) throw new Error('no email in id_token');
  const emailVerified = {
    google: c.email_verified === true,
    // Work/school tenants can set arbitrary emails, so only trust personal accounts or a verified-domain claim.
    microsoft: c.tid === MSA_TENANT || c.xms_edov === true,
    apple: c.email_verified === true || c.email_verified === 'true',
  }[p];
  return { subject: String(c.sub), email, emailVerified };
}

// --- Dev stand-in for the provider page -----------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function devPage(p: Provider, state: string): string {
  const action = `/auth/oauth/${p}/callback`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev sign-in · ${LABEL[p]}</title>
<style>body{font-family:system-ui,sans-serif;background:#FFF8EC;color:#2B2118;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #EADFCB;border-radius:14px;padding:28px;width:min(360px,calc(100vw - 32px));box-sizing:border-box}
h1{font-size:20px;margin:0 0 6px}p{color:#7A6A58;font-size:14px;line-height:1.45}label{font-size:13px;font-weight:600;color:#7A6A58}
input{width:100%;box-sizing:border-box;font-size:16px;padding:10px;border:1px solid #EADFCB;border-radius:10px;margin:6px 0 16px}
button{width:100%;font-size:16px;font-weight:600;padding:12px;border:0;border-radius:999px;background:#B8322A;color:#fff;cursor:pointer}
a{display:block;text-align:center;margin-top:14px;color:#A87A00;font-size:14px}</style></head>
<body><main><h1>Continue with ${LABEL[p]}</h1>
<p>Development stand-in for the ${LABEL[p]} sign-in page. Add the ${LABEL[p]} keys to <code>backend/.env</code> to use the real one.</p>
<form method="get" action="${action}"><input type="hidden" name="state" value="${esc(state)}">
<label for="e">Email the provider would return</label><input id="e" name="dev_email" type="email" required value="${DEV_EMAIL[p]}">
<button type="submit">Continue</button></form>
<a href="${action}?${new URLSearchParams({ state, error: 'access_denied' })}">Cancel</a></main></body></html>`;
}

// --- Tickets ------------------------------------------------------------------

async function issueTicket(p: Provider, id: Identity): Promise<string> {
  const { token, hash } = newOpaqueToken();
  await pool.query(
    `INSERT INTO oauth_tickets(ticket_hash,provider,subject,email,email_verified,expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')`,
    [hash, p, id.subject, id.email, id.emailVerified]);
  return token;
}

const invalidTicket = () => badRequest('invalid_ticket', 'This sign-in has expired. Please try again.');

// --- Routes ------------------------------------------------------------------

export default async function oauthRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // Apple's callback is an HTML form post.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get('/auth/oauth/providers', async () => ({
    providers: PROVIDERS.filter((p) => configured(p) || devMode(p)).map((p) => ({ id: p, dev: devMode(p) })),
  }));

  app.get('/auth/oauth/:provider/start', strict, async (req, reply) => {
    const { provider } = ProviderParam.parse(req.params);
    const { redirect } = z.object({ redirect: z.string() }).parse(req.query);
    if (!allowedRedirect(redirect)) throw badRequest('invalid_redirect', 'Unknown return address.');
    if (!configured(provider) && !devMode(provider)) throw forbidden('provider_unavailable', `${LABEL[provider]} sign-in is not available yet.`);

    const nonce = randomBytes(16).toString('base64url');
    const state = jwt.sign({ p: provider, r: redirect, n: nonce } satisfies State, config.JWT_SECRET, { expiresIn: '10m', audience: 'oauth-state' });
    reply.header('set-cookie', cookie(nonce, 600));
    if (devMode(provider)) return reply.redirect(`/auth/oauth/${provider}/dev?${new URLSearchParams({ state })}`);
    return reply.redirect(authorizeUrl(provider, state, nonce));
  });

  app.get('/auth/oauth/:provider/dev', async (req, reply) => {
    const { provider } = ProviderParam.parse(req.params);
    const { state } = z.object({ state: z.string() }).parse(req.query);
    if (!devMode(provider)) throw forbidden();
    return reply.type('text/html').send(devPage(provider, state));
  });

  app.route({
    method: ['GET', 'POST'],
    url: '/auth/oauth/:provider/callback',
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { provider } = ProviderParam.parse(req.params);
      const q = { ...(req.query as object), ...(req.body && typeof req.body === 'object' ? req.body : {}) } as Record<string, string | undefined>;

      let st: State;
      try {
        st = jwt.verify(q.state ?? '', config.JWT_SECRET, { audience: 'oauth-state' }) as unknown as State;
      } catch {
        throw badRequest('invalid_state', 'This sign-in attempt expired. Please go back to the app and try again.');
      }
      // The nonce cookie ties the callback to the browser that started it (blocks login CSRF).
      if (st.p !== provider || readCookie(req, COOKIE) !== st.n) {
        throw badRequest('invalid_state', 'This sign-in attempt expired. Please go back to the app and try again.');
      }
      reply.header('set-cookie', cookie('', 0));
      const back = (params: Record<string, string>) => reply.redirect(withParams(st.r, params), 303);

      if (q.error) return back({ error: ['access_denied', 'user_cancelled_authorize'].includes(q.error) ? 'cancelled' : 'failed' });

      let identity: Identity;
      if (devMode(provider)) {
        const email = z.string().trim().toLowerCase().email().safeParse(q.dev_email);
        if (!email.success) return back({ error: 'failed' });
        identity = { subject: `dev:${email.data}`, email: email.data, emailVerified: true };
      } else {
        try {
          identity = await exchangeCode(provider, q.code ?? '', st.n);
        } catch (e) {
          req.log.warn({ err: e, provider }, 'oauth exchange failed');
          return back({ error: 'failed' });
        }
      }
      return back({ ticket: await issueTicket(provider, identity) });
    },
  });

  /**
   * Existing account → session. New account → { needsSignup, email } until the consents are sent.
   * An unlinked account with the same email is linked only when the provider vouches for the email.
   */
  app.post('/auth/oauth/exchange', strict, async (req) => {
    const body = z.object({
      ticket: z.string(),
      ageConfirmed: z.literal(true, { message: 'You must be 18 or older to use Fortune Muse.' }).optional(),
      acceptTerms: z.literal(true, { message: 'Please accept the Terms and Privacy Policy.' }).optional(),
      timezone: z.string().optional(),
      country: z.string().length(2).optional(),
      language: Language.optional(),
    }).parse(req.body);

    const t = await one<{ provider: Provider; subject: string; email: string; email_verified: boolean }>(pool,
      'SELECT provider, subject, email, email_verified FROM oauth_tickets WHERE ticket_hash=$1 AND used_at IS NULL AND expires_at > now()',
      [sha256(body.ticket)]);
    if (!t) throw invalidTicket();

    const linked = await one<{ user_id: string }>(pool, 'SELECT user_id FROM oauth_identities WHERE provider=$1 AND subject=$2', [t.provider, t.subject]);
    const byEmail = linked ? null : await one<{ id: string }>(pool, 'SELECT id FROM users WHERE email=$1', [t.email]);
    if (byEmail && !t.email_verified) {
      throw conflict('email_taken', 'An account with this email already exists. Sign in with your password instead.');
    }
    if (!linked && !byEmail && !(body.ageConfirmed && body.acceptTerms)) {
      return { needsSignup: true, email: t.email, provider: t.provider };
    }

    const used = await one(pool, 'UPDATE oauth_tickets SET used_at=now() WHERE ticket_hash=$1 AND used_at IS NULL RETURNING 1', [sha256(body.ticket)]);
    if (!used) throw invalidTicket();

    let userId: string;
    if (linked) {
      userId = linked.user_id;
    } else if (byEmail) {
      userId = byEmail.id;
      await pool.query('INSERT INTO oauth_identities(provider,subject,user_id,email) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t.provider, t.subject, userId, t.email]);
      await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [userId]);
    } else {
      const user = await createUser({
        email: t.email, passwordHash: null, country: signupCountry(req, body.country), timezone: body.timezone,
        emailVerified: t.email_verified, language: body.language,
        afterInsert: (c, id) => c.query('INSERT INTO oauth_identities(provider,subject,user_id,email) VALUES ($1,$2,$3,$4)', [t.provider, t.subject, id, t.email]).then(() => {}),
      });
      track(user.id, 'signup', { method: t.provider });
      return sessionPayload(user.id);
    }

    const u = await one<{ status: string }>(pool, 'SELECT status FROM users WHERE id=$1', [userId]);
    if (u?.status === 'banned') throw forbidden('banned', 'This account has been suspended.');
    track(userId, 'login', { method: t.provider });
    return sessionPayload(userId);
  });
}
