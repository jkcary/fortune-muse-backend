import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireUser, requireVerified, userFromToken } from '../../lib/auth.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { CLUSTERS } from '../readings/catalog.js';
import { moderateChat } from '../safety/safety.js';
import { addConn, blockedIds, broadcast, disconnectUser, findOrCreateRoom } from './service.js';

const roomView = (r: any) => ({ id: r.id, topic: r.topic, cluster: r.topic_cluster, label: r.label, expiresAt: r.expires_at, status: r.status });

async function members(roomId: string, viewerId: string) {
  const hidden = await blockedIds(viewerId);
  const rows = await many(pool,
    `SELECT u.id, u.handle, json_build_object('baseId', a.base_id, 'customization', a.customization_json, 'mood', a.mood) AS avatar
     FROM room_members m JOIN users u ON u.id=m.user_id JOIN avatars a ON a.user_id=u.id
     WHERE m.room_id=$1 AND m.left_at IS NULL ORDER BY m.joined_at`, [roomId]);
  return rows.filter((r) => !hidden.has(r.id));
}

async function recentMessages(roomId: string, viewerId: string) {
  const hidden = await blockedIds(viewerId);
  const rows = await many(pool,
    `SELECT m.id, m.text, m.created_at, m.user_id, u.handle FROM messages m LEFT JOIN users u ON u.id=m.user_id
     WHERE m.room_id=$1 ORDER BY m.created_at DESC LIMIT 100`, [roomId]);
  return rows.filter((r) => !hidden.has(r.user_id)).reverse();
}

async function activeMembership(roomId: string, userId: string) {
  return one(pool,
    `SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id
     WHERE r.id=$1 AND m.user_id=$2 AND m.left_at IS NULL AND r.status='open' AND r.expires_at > now()`, [roomId, userId]);
}

// Per-user chat rate limit: at most 1 message per second and 15 per minute.
const sendLog = new Map<string, number[]>();
function allowSend(userId: string): boolean {
  const now = Date.now();
  const log = (sendLog.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (log.length >= 15 || (log.length && now - log[log.length - 1] < 1000)) return false;
  log.push(now);
  sendLog.set(userId, log);
  return true;
}

export default async function roomRoutes(app: FastifyInstance) {
  /** Joins (or returns) the same-question room for one of the user's readings from today. */
  app.post('/rooms/join', async (req) => {
    const me = await requireVerified(req);
    if (!me.rooms_enabled) throw forbidden('rooms_disabled', 'Same-question rooms are turned off in your settings.');
    const { readingId } = z.object({ readingId: z.string().uuid() }).parse(req.body);
    const reading = await one(pool, `SELECT * FROM readings WHERE id=$1 AND user_id=$2 AND status='ready'`, [readingId, me.id]);
    if (!reading) throw notFound('Reading not found');
    const cluster = CLUSTERS[reading.topic as 'wealth' | 'love'].find((c) => c.id === reading.topic_cluster)
      ?? { id: 'general', label: reading.topic === 'wealth' ? 'Money luck in general' : 'Love luck in general' };

    // Already in an open room for this cluster today? Return it.
    let room = await one(pool,
      `SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id
       WHERE m.user_id=$1 AND m.left_at IS NULL AND r.topic=$2 AND r.topic_cluster=$3 AND r.local_date=$4 AND r.status='open' AND r.expires_at > now()`,
      [me.id, reading.topic, cluster.id, reading.local_date]);
    if (!room) {
      room = await findOrCreateRoom(reading.topic, cluster, reading.local_date);
      await pool.query(
        `INSERT INTO room_members(room_id,user_id) VALUES ($1,$2) ON CONFLICT (room_id,user_id) DO UPDATE SET left_at=NULL, joined_at=now()`,
        [room.id, me.id]);
      track(me.id, 'room_join', { cluster: cluster.id });
      void broadcast(room.id, { type: 'presence', event: 'join', handle: me.handle });
    }
    return { room: roomView(room), members: await members(room.id, me.id), messages: await recentMessages(room.id, me.id) };
  });

  app.get('/rooms/current', async (req) => {
    const me = await requireUser(req);
    const rooms = await many(pool,
      `SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id
       WHERE m.user_id=$1 AND m.left_at IS NULL AND r.status='open' AND r.expires_at > now() ORDER BY m.joined_at DESC`, [me.id]);
    return { rooms: rooms.map(roomView) };
  });

  app.get('/rooms/:id', async (req) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const room = await activeMembership(id, me.id);
    if (!room) throw notFound('This room has closed or you are not a member.');
    return { room: roomView(room), members: await members(id, me.id), messages: await recentMessages(id, me.id) };
  });

  app.post('/rooms/:id/leave', async (req) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await pool.query('UPDATE room_members SET left_at=now() WHERE room_id=$1 AND user_id=$2', [id, me.id]);
    disconnectUser(id, me.id);
    void broadcast(id, { type: 'presence', event: 'leave', handle: me.handle });
    return { ok: true };
  });

  // REST fallback for sending (the app normally uses the WebSocket).
  app.post('/rooms/:id/messages', async (req) => {
    const me = await requireVerified(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { text } = z.object({ text: z.string() }).parse(req.body);
    return postMessage(id, me, text);
  });

  app.get('/rooms/:id/ws', { websocket: true }, async (socket, req) => {
    const { id } = req.params as { id: string };
    const me = await userFromToken((req.query as any).token ?? null);
    if (!me || me.status === 'banned' || !z.string().uuid().safeParse(id).success || !(await activeMembership(id, me.id))) {
      socket.close(4003, 'forbidden');
      return;
    }
    const remove = addConn(id, { userId: me.id, socket });
    socket.on('close', remove);
    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type !== 'message' || typeof msg.text !== 'string') return;
      try {
        await postMessage(id, me, msg.text);
      } catch (e: any) {
        socket.send(JSON.stringify({ type: 'error', code: e.code ?? 'error', message: e.message }));
      }
    });
    socket.send(JSON.stringify({ type: 'ready' }));
  });

  async function postMessage(roomId: string, me: { id: string; handle: string; status: string; email_verified: boolean }, text: string) {
    if (!me.email_verified) throw forbidden('email_unverified', 'Please verify your email first.');
    if (me.status === 'restricted') throw forbidden('restricted', 'Your account can’t post messages right now.');
    if (!(await activeMembership(roomId, me.id))) throw notFound('This room has closed.');
    const muted = await one(pool, 'SELECT muted FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, me.id]);
    if (muted?.muted) throw forbidden('muted', 'You are muted in this room.');
    if (!allowSend(me.id)) throw badRequest('slow_down', 'You are sending messages too fast.');
    const mod = moderateChat(text);
    if (!mod.ok) {
      const why: Record<string, string> = {
        contact_info: 'For your safety, links, emails, phone numbers and payment handles can’t be shared here.',
        too_long: 'Messages can be up to 500 characters.',
        safety: 'This message can’t be posted. If you’re going through something hard, call or text 988.',
        empty: 'Message is empty.',
      };
      throw badRequest(`blocked_${mod.reason}`, why[mod.reason] ?? 'Message blocked.');
    }
    const m = await one(pool, 'INSERT INTO messages(room_id,user_id,text) VALUES ($1,$2,$3) RETURNING id, text, created_at', [roomId, me.id, mod.text]);
    const out = { id: m.id, text: m.text, created_at: m.created_at, user_id: me.id, handle: me.handle };
    track(me.id, 'room_message');
    void broadcast(roomId, { type: 'message', message: out }, me.id);
    return { message: out };
  }
}
