import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { one, pool, tx, type Db } from "../../db/pool.js";

export type DeliveryKind = "legacy" | "oracle" | "refund" | "followup";
export async function enqueue(kind: DeliveryKind, id: string, db: Db = pool) {
  await db.query(
    `INSERT INTO delivery_jobs(kind,subject_id) VALUES ($1,$2) ON CONFLICT (kind,subject_id) DO NOTHING`,
    [kind, id],
  );
}
/** A dead worker loses its PostgreSQL session lock. Recover it without waiting for a lease timeout. */
export async function recoverDelivery() {
  await tx(async (c) => {
    const jobs = await c.query(
      `SELECT id FROM delivery_jobs WHERE state='running' FOR UPDATE SKIP LOCKED`,
    );
    for (const job of jobs.rows) {
      const lock = await c.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS available",
        [job.id],
      );
      if (lock.rows[0].available)
        await c.query(
          `UPDATE delivery_jobs SET state='pending',lease_token=NULL,lease_until=NULL,available_at=now(),updated_at=now() WHERE id=$1`,
          [job.id],
        );
    }
  });
}
let running = false;
export function kickDelivery() {
  void drainDelivery().catch(() => {
    /* durable jobs are recovered by the scheduler */
  });
}
/** Row leases allow multiple processes. Heartbeats preserve ownership during model requests. */
export async function drainDelivery() {
  if (running) return;
  running = true;
  try {
    for (let count = 0; count < 20; count++) {
      const token = randomUUID();
      const job = await tx((c) =>
        one(
          c,
          `UPDATE delivery_jobs SET state='running',attempts=attempts+1,
        lease_token=$1,lease_until=now()+interval '10 minutes',updated_at=now()
        WHERE id=(SELECT id FROM delivery_jobs WHERE
          (state='pending' AND available_at<=now()) OR (state='running' AND lease_until<now())
          ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
          [token],
        ),
      );
      if (!job) break;
      const heartbeat = setInterval(() => {
        void pool
          .query(
            `UPDATE delivery_jobs SET lease_until=now()+interval '10 minutes' WHERE id=$1 AND lease_token=$2 AND state='running'`,
            [job.id, token],
          )
          .catch(() => {});
      }, 30_000);
      heartbeat.unref();
      let execution: PoolClient | null = null;
      let owns = false;
      try {
        execution = await pool.connect();
        owns = Boolean(
          (
            await execution.query(
              "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS owns",
              [job.id],
            )
          ).rows[0].owns,
        );
        if (!owns) {
          await pool.query(
            `UPDATE delivery_jobs SET state='pending',attempts=attempts-1,available_at=now()+interval '30 seconds' WHERE id=$1 AND lease_token=$2 AND state='running'`,
            [job.id, token],
          );
          continue;
        }
        const current = await one(
          pool,
          "SELECT id FROM delivery_jobs WHERE id=$1 AND lease_token=$2 AND state='running'",
          [job.id, token],
        );
        if (!current) continue;
        if (job.kind === "legacy")
          await (
            await import("../readings/service.js")
          ).executeGeneration(job.subject_id);
        else if (job.kind === "oracle")
          await (
            await import("../oracle/generation.js")
          ).generatePremium(job.subject_id);
        else if (job.kind === "followup")
          await (
            await import("../oracle/generation.js")
          ).generateFollowup(job.subject_id);
        else {
          const order = await one(
            pool,
            "SELECT refund_reason FROM orders WHERE id=$1",
            [job.subject_id],
          );
          await (
            await import("../readings/service.js")
          ).refundOrder(
            job.subject_id,
            order?.refund_reason ?? "generation_failed",
          );
        }
        await pool.query(
          `UPDATE delivery_jobs SET state='done',lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running'`,
          [job.id, token],
        );
      } catch {
        // Provider error payloads may contain user content: store only a generic failure code.
        const exhausted = job.attempts >= (job.kind === "refund" ? 8 : 2);
        await tx(async (c) => {
          await c.query(
            `UPDATE delivery_jobs SET state=$3,last_error='delivery_failed',lease_until=NULL,
            available_at=now()+make_interval(secs=>$4),updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running'`,
            [
              job.id,
              token,
              exhausted ? "failed" : "pending",
              Math.min(300, job.attempts * 5),
            ],
          );
          if (exhausted && (job.kind === "legacy" || job.kind === "oracle")) {
            const table = job.kind === "legacy" ? "readings" : "oracle_casts";
            const statusColumn =
              job.kind === "legacy" ? "status" : "premium_status";
            const row = await one(
              c,
              `UPDATE ${table} SET ${statusColumn}=$2 WHERE id=$1 AND ${statusColumn}<>'ready' RETURNING order_id`,
              [job.subject_id, job.kind === "legacy" ? "failed" : "refunding"],
            );
            if (row?.order_id) {
              await c.query(
                `UPDATE orders SET refund_reason='generation_failed' WHERE id=$1`,
                [row.order_id],
              );
              await enqueue("refund", row.order_id, c);
            }
          }
          if (exhausted && job.kind === "followup")
            await c.query(
              `UPDATE oracle_followups SET status='failed' WHERE id=$1`,
              [job.subject_id],
            );
        });
      } finally {
        clearInterval(heartbeat);
        if (owns && execution)
          await execution
            .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
              job.id,
            ])
            .catch(() => {});
        execution?.release();
      }
    }
  } finally {
    running = false;
  }
}
