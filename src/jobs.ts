import {
  drainDelivery,
  enqueue,
  recoverDelivery,
} from "./modules/delivery/queue.js";
import { pool, tx } from "./db/pool.js";
import { expireRooms } from "./modules/rooms/service.js";

/** Remove expired personal content while retaining detached financial records. */
export async function purgeTemporaryReadings() {
  await tx(async (c) => {
    const expired =
      await c.query(`SELECT c.id,c.order_id,c.premium_status,o.status AS payment_status
      FROM oracle_casts c LEFT JOIN orders o ON o.id=c.order_id WHERE c.expires_at<now() FOR UPDATE OF c`);
    for (const row of expired.rows) {
      if (
        ["paid", "refund_requested"].includes(row.payment_status) &&
        row.premium_status !== "ready"
      ) {
        await c.query(
          `UPDATE orders SET refund_reason='temporary_reading_expired' WHERE id=$1`,
          [row.order_id],
        );
        await enqueue("refund", row.order_id, c);
      }
      await c.query(
        `DELETE FROM delivery_jobs WHERE (kind='oracle' AND subject_id=$1)
        OR (kind='followup' AND subject_id IN (SELECT id FROM oracle_followups WHERE cast_id=$1))`,
        [row.id],
      );
      await c.query("DELETE FROM oracle_casts WHERE id=$1", [row.id]);
    }
  });
}

/** Background housekeeping. In production run on one instance (or move to a scheduler). */
export function startJobs(log: {
  info: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}) {
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(
      () => fn().catch((err) => log.error({ err }, `${name} failed`)),
      ms,
    );
    t.unref();
  };
  void recoverDelivery()
    .then(() => drainDelivery())
    .catch((err) => log.error({ err }, "delivery recovery failed"));
  every(3000, "delivery queue", drainDelivery);
  every(60_000, "expire temporary readings", purgeTemporaryReadings);
  every(60_000, "expire rooms", async () => {
    const n = await expireRooms();
    if (n) log.info({ n }, "closed expired rooms");
  });
  every(10 * 60_000, "expire stale orders", () =>
    pool.query(
      `UPDATE orders SET status='canceled', updated_at=now() WHERE status='pending' AND created_at < now() - interval '2 hours'`,
    ),
  );
  every(60 * 60_000, "purge auth tokens", () =>
    pool.query(
      `DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`,
    ),
  );
}
