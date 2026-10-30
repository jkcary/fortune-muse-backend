import { pool } from '../db/pool.js';

/** First-party product analytics used by the admin dashboard. Never blocks the request. */
export function track(userId: string | null, name: string, props: Record<string, unknown> = {}) {
  pool.query('INSERT INTO events(user_id, name, props) VALUES ($1,$2,$3)', [userId, name, props]).catch(() => {});
}
