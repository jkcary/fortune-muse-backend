import { many, one, pool, tx } from "../../db/pool.js";
import { track } from "../../lib/events.js";
import { asLang } from "../../lib/i18n.js";
import { localDate } from "../../lib/time.js";
import { getStripe } from "../payments/stripe.js";
import { generateReading } from "./generator.js";
import { sampleLibrary } from "./library.js";
import { config } from "../../config.js";
import { enqueue, kickDelivery } from "../delivery/queue.js";

/** Public entry point: enqueue before returning; a worker owns execution. */
export async function runGeneration(readingId: string, _log?: unknown) {
  await enqueue("legacy", readingId);
  kickDelivery();
}
export async function executeGeneration(readingId: string) {
  const reading = await one(
    pool,
    `UPDATE readings SET status='generating' WHERE id=$1 AND status IN ('awaiting_payment','generating')
    AND EXISTS(SELECT 1 FROM orders WHERE id=readings.order_id AND status='paid') RETURNING *`,
    [readingId],
  );
  if (!reading) return;
  const [deity, user] = await Promise.all([
    one(pool, "SELECT name,persona_prompt FROM deities WHERE id=$1", [
      reading.deity_id,
    ]),
    one(
      pool,
      "SELECT memory_enabled,timezone,language FROM users WHERE id=$1",
      [reading.user_id],
    ),
  ]);
  if (!user || !deity) return;
  const memories = user.memory_enabled
    ? (
        await many(
          pool,
          `SELECT content FROM memories WHERE user_id=$1 AND content<>'' ORDER BY created_at DESC LIMIT 3`,
          [reading.user_id],
        )
      ).map((m) => m.content)
    : [];
  const library = await sampleLibrary(reading.topic);
  const result = await generateReading({
    deity,
    topic: reading.topic,
    tier: reading.tier,
    question: reading.question,
    library,
    memories,
    localDate: localDate(user.timezone),
    language: asLang(user.language),
    intake: reading.intake_json?.summary ?? null,
  });
  if (config.NODE_ENV === "production" && result.generator === "mock")
    throw new Error("production_model_required");
  await pool.query(
    `UPDATE readings SET status='ready',result_json=$2,attempts=attempts+1 WHERE id=$1 AND status='generating'
    AND EXISTS(SELECT 1 FROM orders WHERE id=readings.order_id AND status='paid')`,
    [readingId, result],
  );
  track(reading.user_id, "reading_ready", {
    tier: reading.tier,
    generator: result.generator,
  });
}

/** Refunds an order through whichever provider took it. Vouchers go back to the inventory. */
export async function refundOrder(orderId: string, reason: string) {
  let failed = false;
  await tx(async (c) => {
    const order = await one(c, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      orderId,
    ]);
    if (!order || order.status === "refunded") return;
    if (!["paid", "refund_requested"].includes(order.status))
      throw new Error("order_not_paid");
    let settled = true;
    if (order.provider === "stripe") {
      if (!order.stripe_payment_intent)
        throw new Error("payment_intent_missing");
      const attempt =
        order.refund_attempt + (order.refund_status === "failed" ? 1 : 0);
      const refund =
        order.refund_status === "pending" && order.provider_refund_id
          ? await getStripe().refunds.retrieve(order.provider_refund_id)
          : await getStripe().refunds.create(
              {
                payment_intent: order.stripe_payment_intent,
                metadata: { orderId, reason },
              },
              { idempotencyKey: `refund-${orderId}-${attempt}` },
            );
      const status =
        refund.status === "succeeded"
          ? "succeeded"
          : refund.status === "failed" || refund.status === "canceled"
            ? "failed"
            : "pending";
      await c.query(
        "UPDATE orders SET provider_refund_id=$2,refund_status=$3,refund_attempt=$4 WHERE id=$1",
        [orderId, refund.id, status, attempt],
      );
      settled = status === "succeeded";
      failed = status === "failed";
    }
    if (order.provider === "voucher" && order.user_id) {
      if (!order.voucher_inventory_id)
        throw new Error("legacy_voucher_requires_review");
      await c.query(
        "UPDATE inventory SET used_at=NULL WHERE id=$1 AND user_id=$2",
        [order.voucher_inventory_id, order.user_id],
      );
    }
    await c.query(
      "UPDATE orders SET status=$2,refund_reason=$3,updated_at=now() WHERE id=$1",
      [orderId, settled ? "refunded" : "refund_requested", reason],
    );
    if (settled)
      await c.query(`UPDATE readings SET status='refunded' WHERE order_id=$1`, [
        orderId,
      ]);
    await c.query(
      "UPDATE oracle_casts SET premium_status=$2 WHERE order_id=$1",
      [orderId, settled ? "refunded" : "refunding"],
    );
  });
  if (failed) throw new Error("refund_failed");
}

/** Stripe can finish or fail a refund asynchronously; never label a pending refund as completed. */
export async function applyRefundStatus(refund: {
  id: string;
  status: string | null;
  payment_intent: string | { id: string } | null;
}) {
  const intent =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!intent) return;
  await tx(async (c) => {
    const order = await one(
      c,
      "SELECT * FROM orders WHERE provider_refund_id=$1 AND stripe_payment_intent=$2 FOR UPDATE",
      [refund.id, intent],
    );
    if (!order || order.status === "refunded") return;
    const succeeded = refund.status === "succeeded";
    const failed = refund.status === "failed" || refund.status === "canceled";
    await c.query(
      "UPDATE orders SET refund_status=$2,status=$3,updated_at=now() WHERE id=$1",
      [
        order.id,
        succeeded ? "succeeded" : failed ? "failed" : "pending",
        succeeded ? "refunded" : "refund_requested",
      ],
    );
    if (succeeded) {
      await c.query(`UPDATE readings SET status='refunded' WHERE order_id=$1`, [
        order.id,
      ]);
      await c.query(
        `UPDATE oracle_casts SET premium_status='refunded' WHERE order_id=$1`,
        [order.id],
      );
      await c.query("UPDATE delivery_jobs SET state='done',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE kind='refund' AND subject_id=$1",[order.id]);
    }
    if (failed) {
      await c.query(
        `INSERT INTO delivery_jobs(kind,subject_id,state,last_error) VALUES('refund',$1,'failed','refund_failed') ON CONFLICT(kind,subject_id) DO UPDATE SET state='failed',last_error='refund_failed',lease_until=NULL,lease_token=NULL,updated_at=now()`,
        [order.id],
      );
    }
  });
}

/** Payment and durable delivery enqueue commit in the same transaction. */
export async function markOrderPaid(
  orderId: string,
  paymentIntent?: string | null,
  tax = 0,
) {
  const paid = await tx(async (c) => {
    const order = await one(
      c,
      `UPDATE orders SET status='paid',stripe_payment_intent=COALESCE($2,stripe_payment_intent),tax=$3,updated_at=now()
      WHERE id=$1 AND status IN ('pending','canceled') RETURNING id`,
      [orderId, paymentIntent ?? null, tax],
    );
    if (!order) return false;
    const legacy = await one(c, "SELECT id FROM readings WHERE order_id=$1", [
      orderId,
    ]);
    const oracle = await one(
      c,
      `UPDATE oracle_casts SET premium_status='queued' WHERE order_id=$1 RETURNING id`,
      [orderId],
    );
    if (legacy) await enqueue("legacy", legacy.id, c);
    else if (oracle) await enqueue("oracle", oracle.id, c);
    else {
      await c.query(
        `UPDATE orders SET refund_reason='unattached_payment' WHERE id=$1`,
        [orderId],
      );
      await enqueue("refund", orderId, c);
    }
    return true;
  });
  if (paid) {
    track(null, "order_paid", { orderId });
    kickDelivery();
  }
  return paid;
}
