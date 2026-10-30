import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { track } from '../../lib/events.js';

/** Accounts reported by this many different people in 7 days are restricted from posting until reviewed. */
export const AUTO_RESTRICT_REPORTERS = 3;

export default async function moderationRoutes(app: FastifyInstance) {
  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      targetUserId: z.string().uuid().optional(),
      messageId: z.string().uuid().optional(),
      reason: z.enum(['harassment', 'hate', 'sexual', 'spam', 'scam', 'self_harm', 'underage', 'other']),
      details: z.string().trim().max(1000).optional(),
    }).refine((b) => b.targetUserId || b.messageId, 'Say who or what you are reporting').parse(req.body);

    let target = body.targetUserId ?? null;
    let snapshot: string | null = null;
    let roomId: string | null = null;
    if (body.messageId) {
      const m = await one(pool, 'SELECT user_id, text, room_id FROM messages WHERE id=$1', [body.messageId]);
      if (!m) throw badRequest('unknown_message');
      target = m.user_id;
      snapshot = m.text;
      roomId = m.room_id;
    }
    if (target === me.id) throw badRequest('self_report');
    await pool.query(
      `INSERT INTO reports(reporter_id,target_user_id,message_id,room_id,message_snapshot,reason,details) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [me.id, target, body.messageId ?? null, roomId, snapshot, body.reason, body.details ?? null]);

    if (target) {
      const n = await one(pool,
        `SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE target_user_id=$1 AND created_at > now() - interval '7 days' AND status <> 'dismissed'`, [target]);
      if (n.n >= AUTO_RESTRICT_REPORTERS) {
        await pool.query(`UPDATE users SET status='restricted' WHERE id=$1 AND status='active'`, [target]);
      }
    }
    track(me.id, 'report', { reason: body.reason });
    return { ok: true };
  });

  app.get('/blocks', async (req) => {
    const me = await requireUser(req);
    return { blocks: await many(pool, 'SELECT u.id, u.handle, b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1', [me.id]) };
  });

  app.post('/blocks', async (req) => {
    const me = await requireUser(req);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    if (userId === me.id) throw badRequest('self_block');
    await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me.id, userId]);
    return { ok: true };
  });

  app.delete('/blocks/:userId', async (req) => {
    const me = await requireUser(req);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    await pool.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [me.id, userId]);
    return { ok: true };
  });
}
