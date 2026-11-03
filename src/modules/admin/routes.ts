import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireAdmin } from '../../lib/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { deleteUser } from '../account/routes.js';
import { refundOrder } from '../readings/service.js';
import { mentionsAlcohol } from '../safety/safety.js';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export async function dashboardStats() {
  const n = async (sql: string) => (await one(pool, sql)).n as number;
  const users = await n('SELECT count(*)::int AS n FROM users');
  const withReading = await n(`SELECT count(DISTINCT user_id)::int AS n FROM readings WHERE status IN ('ready','generating')`);
  const payers = await n(`SELECT count(DISTINCT user_id)::int AS n FROM orders WHERE status='paid' AND provider NOT IN ('voucher','comp')`);
  const revenue = await n(`SELECT COALESCE(sum(amount),0)::int AS n FROM orders WHERE status='paid' AND provider NOT IN ('voucher','comp')`);
  const memoryOn = await n('SELECT count(*)::int AS n FROM users WHERE memory_enabled');
  // Retention: active (any tracked event) on the day after / 7th day after signup, among users old enough.
  const retention = async (day: number) => one(pool, `
    SELECT count(*)::int AS cohort,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM events e WHERE e.user_id=u.id AND e.created_at::date = u.created_at::date + $1::int))::int AS retained
    FROM users u WHERE u.created_at::date <= current_date - $1::int`, [day]);
  const d1 = await retention(1);
  const d7 = await retention(7);
  const joiners = await n(`SELECT count(DISTINCT user_id)::int AS n FROM events WHERE name='room_join'`);
  const speakers = await n(`SELECT count(DISTINCT e.user_id)::int AS n FROM events e WHERE e.name='room_message'
                            AND EXISTS (SELECT 1 FROM events j WHERE j.user_id=e.user_id AND j.name='room_join')`);
  const daily = await many(pool, `
    SELECT d::date AS day,
      (SELECT count(*) FROM users WHERE created_at::date=d)::int AS signups,
      (SELECT count(*) FROM readings WHERE created_at::date=d AND status IN ('ready','generating'))::int AS readings,
      (SELECT COALESCE(sum(amount),0) FROM orders WHERE created_at::date=d AND status='paid' AND provider NOT IN ('voucher','comp'))::int AS revenue
    FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`);
  return {
    totals: { users, revenueCents: revenue, payers, openReports: await n(`SELECT count(*)::int AS n FROM reports WHERE status='open'`) },
    // Targets from the MVP plan §1.
    kpis: [
      { key: 'signup_to_reading', label: 'Signup → first reading', value: pct(withReading, users), target: 40 },
      { key: 'reading_to_paid', label: 'First reading → paid', value: pct(payers, withReading), target: 8 },
      { key: 'd1', label: 'Day-1 retention', value: pct(d1.retained, d1.cohort), target: 25 },
      { key: 'd7', label: 'Day-7 retention', value: pct(d7.retained, d7.cohort), target: 10 },
      { key: 'memory_on', label: 'Memory turned on', value: pct(memoryOn, users), target: 60 },
      { key: 'room_speak', label: 'Room members who spoke', value: pct(speakers, joiners), target: 20 },
    ],
    daily,
  };
}

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => { await requireAdmin(req); });

  app.get('/admin/stats', async () => dashboardStats());

  // Users
  app.get('/admin/users', async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const users = await many(pool,
      `SELECT u.id, u.email, u.handle, u.status, u.role, u.email_verified, u.created_at,
         (SELECT count(*) FROM readings r WHERE r.user_id=u.id)::int AS readings,
         (SELECT count(*) FROM reports p WHERE p.target_user_id=u.id)::int AS reports_against
       FROM users u WHERE ($1::text IS NULL OR u.email ILIKE '%'||$1||'%' OR u.handle ILIKE '%'||$1||'%')
       ORDER BY u.created_at DESC LIMIT 100`, [q || null]);
    return { users };
  });

  app.patch('/admin/users/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(['active', 'restricted', 'banned']) }).parse(req.body);
    const u = await one(pool, 'UPDATE users SET status=$2 WHERE id=$1 RETURNING id, status', [id, status]);
    if (!u) throw notFound();
    return u;
  });

  app.delete('/admin/users/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await deleteUser(id);
    return { deleted: true };
  });

  // Orders & refunds
  app.get('/admin/orders', async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    const orders = await many(pool,
      `SELECT o.*, u.email, u.handle FROM orders o LEFT JOIN users u ON u.id=o.user_id
       WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.created_at DESC LIMIT 200`, [status || null]);
    return { orders };
  });

  app.post('/admin/orders/:id/refund', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().default('admin') }).parse(req.body ?? {});
    const o = await one(pool, `SELECT status FROM orders WHERE id=$1`, [id]);
    if (!o) throw notFound();
    if (!['paid', 'refund_requested'].includes(o.status)) throw badRequest('not_refundable');
    await refundOrder(id, reason);
    return { ok: true };
  });

  // Moderation queue
  app.get('/admin/reports', async (req) => {
    const { status } = z.object({ status: z.string().default('open') }).parse(req.query);
    const reports = await many(pool,
      `SELECT p.*, r.handle AS reporter_handle, t.handle AS target_handle, t.status AS target_status
       FROM reports p LEFT JOIN users r ON r.id=p.reporter_id LEFT JOIN users t ON t.id=p.target_user_id
       WHERE p.status=$1 ORDER BY p.created_at DESC LIMIT 200`, [status]);
    return { reports };
  });

  app.patch('/admin/reports/:id', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      status: z.enum(['actioned', 'dismissed']),
      note: z.string().max(1000).optional(),
      userAction: z.enum(['none', 'restore', 'restrict', 'ban']).default('none'),
    }).parse(req.body);
    const rep = await one(pool,
      `UPDATE reports SET status=$2, resolution_note=$3, resolved_by=$4, resolved_at=now() WHERE id=$1 RETURNING target_user_id`,
      [id, body.status, body.note ?? null, admin.id]);
    if (!rep) throw notFound();
    const map = { restore: 'active', restrict: 'restricted', ban: 'banned' } as const;
    if (rep.target_user_id && body.userAction !== 'none') {
      await pool.query('UPDATE users SET status=$2 WHERE id=$1', [rep.target_user_id, map[body.userAction]]);
    }
    return { ok: true };
  });

  // Content library (songs, foods, drinks, actions, outfits…)
  app.get('/admin/content', async (req) => {
    const { kind } = z.object({ kind: z.string().optional() }).parse(req.query);
    return { items: await many(pool, `SELECT * FROM content_items WHERE ($1::text IS NULL OR kind=$1) ORDER BY kind, id`, [kind || null]) };
  });

  const ContentBody = z.object({
    kind: z.enum(['song', 'food', 'drink', 'action', 'outfit', 'shoes', 'color']),
    topic: z.enum(['wealth', 'love']).nullable().default(null),
    data: z.record(z.string(), z.string()),
    active: z.boolean().default(true),
  });

  app.post('/admin/content', async (req) => {
    const b = ContentBody.parse(req.body);
    if (Object.values(b.data).some(mentionsAlcohol)) throw badRequest('alcohol', 'Alcohol is not allowed in the content library.');
    return one(pool, 'INSERT INTO content_items(kind,topic,data,active) VALUES ($1,$2,$3,$4) RETURNING *', [b.kind, b.topic, b.data, b.active]);
  });

  app.patch('/admin/content/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    return one(pool, 'UPDATE content_items SET active=$2 WHERE id=$1 RETURNING *', [id, active]);
  });

  // Daily draw prize pool
  app.get('/admin/rewards', async () => ({ rewards: await many(pool, 'SELECT * FROM rewards ORDER BY weight DESC') }));

  app.patch('/admin/rewards/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ weight: z.number().int().min(0).max(10000).optional(), active: z.boolean().optional() }).parse(req.body);
    const r = await one(pool, 'UPDATE rewards SET weight=COALESCE($2,weight), active=COALESCE($3,active) WHERE id=$1 RETURNING *', [id, b.weight ?? null, b.active ?? null]);
    if (!r) throw notFound();
    return r;
  });

  app.get('/admin/privacy-requests', async () => ({ requests: await many(pool, 'SELECT * FROM privacy_requests ORDER BY created_at DESC LIMIT 200') }));
  app.patch('/admin/privacy-requests/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query(`UPDATE privacy_requests SET status='done' WHERE id=$1`, [id]);
    return { ok: true };
  });
}
