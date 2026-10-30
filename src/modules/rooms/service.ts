import type { WebSocket } from 'ws';
import { many, one, pool, tx } from '../../db/pool.js';

export const ROOM_CAPACITY = 50;
export const ROOM_TTL_HOURS = 24;

/** Finds today's open room for this topic cluster with space, or opens a new one. */
export async function findOrCreateRoom(topic: string, cluster: { id: string; label: string }, date: string) {
  return tx(async (c) => {
    // Serialize matching per cluster so two users don't both open a new room at the same moment.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${topic}:${cluster.id}:${date}`]);
    const open = await one(c,
      `SELECT r.* FROM rooms r
       WHERE r.topic=$1 AND r.topic_cluster=$2 AND r.local_date=$3 AND r.status='open' AND r.expires_at > now()
         AND (SELECT count(*) FROM room_members m WHERE m.room_id=r.id AND m.left_at IS NULL) < $4
       ORDER BY r.created_at LIMIT 1`, [topic, cluster.id, date, ROOM_CAPACITY]);
    if (open) return open;
    return one(c,
      `INSERT INTO rooms(topic, topic_cluster, label, local_date, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5)) RETURNING *`,
      [topic, cluster.id, cluster.label, date, ROOM_TTL_HOURS]);
  });
}

export async function blockedIds(userId: string): Promise<Set<string>> {
  const rows = await many(pool,
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id=$1 UNION SELECT blocker_id FROM blocks WHERE blocked_id=$1`, [userId]);
  return new Set(rows.map((r) => r.id));
}

// --- Live connections (single process; move to Redis pub/sub when scaling out) ---

interface Conn { userId: string; socket: WebSocket }
const live = new Map<string, Set<Conn>>();

export function addConn(roomId: string, conn: Conn) {
  if (!live.has(roomId)) live.set(roomId, new Set());
  live.get(roomId)!.add(conn);
  return () => live.get(roomId)?.delete(conn);
}

/** Sends to everyone in the room except users on either side of a block with the sender. */
export async function broadcast(roomId: string, payload: unknown, fromUserId?: string) {
  const conns = live.get(roomId);
  if (!conns) return;
  const hidden = fromUserId ? await blockedIds(fromUserId) : new Set<string>();
  const data = JSON.stringify(payload);
  for (const c of conns) {
    if (hidden.has(c.userId)) continue;
    if (c.socket.readyState === 1) c.socket.send(data);
  }
}

export function disconnectUser(roomId: string, userId: string) {
  for (const c of live.get(roomId) ?? []) if (c.userId === userId) c.socket.close(4001, 'left');
}

/** Closes expired rooms and deletes their messages (reported messages survive as snapshots on the report). */
export async function expireRooms() {
  const expired = await many(pool, `UPDATE rooms SET status='closed' WHERE status='open' AND expires_at <= now() RETURNING id`);
  for (const r of expired) {
    await pool.query('DELETE FROM messages WHERE room_id=$1', [r.id]);
    for (const c of live.get(r.id) ?? []) {
      if (c.socket.readyState === 1) c.socket.send(JSON.stringify({ type: 'closed' }));
      c.socket.close(4000, 'room_closed');
    }
    live.delete(r.id);
  }
  return expired.length;
}
