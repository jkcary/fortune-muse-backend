import { pool } from './db/pool.js';
import { expireRooms } from './modules/rooms/service.js';

/** Background housekeeping. In production run on one instance (or move to a scheduler). */
export function startJobs(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(() => fn().catch((err) => log.error({ err }, `${name} failed`)), ms);
    t.unref();
  };
  every(60_000, 'expire rooms', async () => {
    const n = await expireRooms();
    if (n) log.info({ n }, 'closed expired rooms');
  });
  every(10 * 60_000, 'expire stale orders', () =>
    pool.query(`UPDATE orders SET status='canceled', updated_at=now() WHERE status='pending' AND created_at < now() - interval '2 hours'`));
  every(60 * 60_000, 'purge auth tokens', () => pool.query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`));
}
