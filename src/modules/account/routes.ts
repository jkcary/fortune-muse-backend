import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { checkPassword } from '../../lib/security.js';

export async function exportUserData(userId: string) {
  const q = (sql: string) => many(pool, sql, [userId]);
  return {
    exportedAt: new Date().toISOString(),
    profile: await one(pool,
      'SELECT id, email, handle, country, language, gender, age_range, timezone, memory_enabled, rooms_enabled, created_at FROM users WHERE id=$1', [userId]),
    avatar: await one(pool, 'SELECT base_id, customization_json, mood FROM avatars WHERE user_id=$1', [userId]),
    consents: await q('SELECT type, version, granted_at FROM consents WHERE user_id=$1'),
    readings: await q('SELECT id, deity_id, topic, tier, question, intake_json, result_json, status, created_at FROM readings WHERE user_id=$1 ORDER BY created_at'),
    oracleReadings: await q('SELECT id,topic,question,context,rounds,basis_json,premium_json,premium_status,private_mode,note,favorite,created_at FROM oracle_casts WHERE user_id=$1 ORDER BY created_at'),
    oracleFollowups: await q('SELECT f.id,f.cast_id,f.question,f.answer,f.status,f.created_at FROM oracle_followups f JOIN oracle_casts c ON c.id=f.cast_id WHERE c.user_id=$1'),
    orders: await q('SELECT id, amount, currency, tax, status, created_at FROM orders WHERE user_id=$1 ORDER BY created_at'),
    memories: await q('SELECT content, mood_tag, created_at FROM memories WHERE user_id=$1 ORDER BY created_at'),
    dailyDraws: await q('SELECT date, reward_id FROM daily_draws WHERE user_id=$1 ORDER BY date'),
    inventory: await q('SELECT reward_id, used_at, created_at FROM inventory WHERE user_id=$1'),
    roomMessages: await q('SELECT room_id, text, created_at FROM messages WHERE user_id=$1 ORDER BY created_at'),
    blocks: await q('SELECT blocked_id, created_at FROM blocks WHERE blocker_id=$1'),
    reportsFiled: await q('SELECT reason, details, status, created_at FROM reports WHERE reporter_id=$1'),
  };
}

/** Deletes the account and everything tied to it. Orders stay, detached from the person, for tax records. */
export async function deleteUser(userId: string) {
  await pool.query(`INSERT INTO delivery_jobs(kind,subject_id) SELECT 'refund',id FROM orders WHERE user_id=$1 AND status='paid' AND EXISTS(SELECT 1 FROM oracle_casts c WHERE c.order_id=orders.id AND c.premium_status IN ('queued','generating','failed')) ON CONFLICT DO NOTHING`,[userId]);
  await pool.query('DELETE FROM users WHERE id=$1', [userId]);
}

export default async function accountRoutes(app: FastifyInstance) {
  app.post('/account/export', async (req, reply) => {
    const me = await requireUser(req);
    reply.header('Content-Disposition', `attachment; filename="fortune-muse-data-${me.handle}.json"`);
    return exportUserData(me.id);
  });

  app.delete('/account', async (req) => {
    const me = await requireUser(req);
    const body = z.object({ password: z.string().optional(), confirm: z.literal('DELETE') }).parse(req.body);
    const u = await one(pool, 'SELECT password_hash FROM users WHERE id=$1', [me.id]);
    if (u.password_hash && !(body.password && (await checkPassword(body.password, u.password_hash)))) {
      throw badRequest('wrong_password', 'Password is incorrect.');
    }
    await deleteUser(me.id);
    return { deleted: true };
  });

  // US state privacy rights requests (access, delete, correct, do-not-sell/share). Works without signing in.
  app.post('/privacy-requests', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email(), type: z.enum(['access', 'delete', 'do_not_sell', 'correct']) }).parse(req.body);
    const u = await one(pool, 'SELECT id FROM users WHERE email=$1', [body.email]);
    await pool.query('INSERT INTO privacy_requests(user_id,email,type) VALUES ($1,$2,$3)', [u?.id ?? null, body.email, body.type]);
    return { ok: true, message: 'We received your request and will respond within 45 days.' };
  });
}
