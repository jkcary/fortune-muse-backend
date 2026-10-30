import { many, one, pool, tx } from '../../db/pool.js';
import { track } from '../../lib/events.js';
import { asLang } from '../../lib/i18n.js';
import { localDate } from '../../lib/time.js';
import { getStripe } from '../payments/stripe.js';
import { generateReading } from './generator.js';
import { sampleLibrary } from './library.js';

/** Called once an order is paid. Retries once; on a second failure the order is refunded (plan §5.5). */
export async function runGeneration(readingId: string, log: { error: (o: unknown, m?: string) => void } = console) {
  const reading = await one(pool,
    `UPDATE readings SET status='generating' WHERE id=$1 AND status IN ('awaiting_payment','generating') RETURNING *`, [readingId]);
  if (!reading) return;
  const [deity, user] = await Promise.all([
    one(pool, 'SELECT name, persona_prompt FROM deities WHERE id=$1', [reading.deity_id]),
    one(pool, 'SELECT memory_enabled, timezone, language FROM users WHERE id=$1', [reading.user_id]),
  ]);
  const memories = user?.memory_enabled
    ? (await many(pool, `SELECT content FROM memories WHERE user_id=$1 AND content <> '' ORDER BY created_at DESC LIMIT 3`, [reading.user_id])).map((m) => m.content)
    : [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const library = await sampleLibrary(reading.topic);
      const result = await generateReading({
        deity, topic: reading.topic, tier: reading.tier, question: reading.question, library, memories,
        localDate: localDate(user?.timezone ?? 'America/New_York'), language: asLang(user?.language),
      });
      await pool.query(`UPDATE readings SET status='ready', result_json=$2, attempts=$3 WHERE id=$1`, [readingId, result, attempt]);
      track(reading.user_id, 'reading_ready', { tier: reading.tier, generator: result.generator });
      return;
    } catch (e) {
      log.error({ err: e, readingId, attempt }, 'reading generation failed');
      await pool.query('UPDATE readings SET attempts=$2 WHERE id=$1', [readingId, attempt]);
    }
  }
  await pool.query(`UPDATE readings SET status='failed' WHERE id=$1`, [readingId]);
  if (reading.order_id) await refundOrder(reading.order_id, 'generation_failed');
  await pool.query(`UPDATE readings SET status='refunded' WHERE id=$1`, [readingId]);
  track(reading.user_id, 'reading_failed_refunded');
}

/** Refunds an order through whichever provider took it. Vouchers go back to the inventory. */
export async function refundOrder(orderId: string, reason: string) {
  const order = await one(pool, 'SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!order || order.status === 'refunded') return;
  if (order.provider === 'stripe' && order.stripe_payment_intent) {
    await getStripe().refunds.create({ payment_intent: order.stripe_payment_intent, metadata: { orderId, reason } });
  }
  if (order.provider === 'voucher') {
    await pool.query(
      `UPDATE inventory SET used_at=NULL WHERE id = (
         SELECT id FROM inventory WHERE user_id=$1 AND reward_id='free-reading' AND used_at IS NOT NULL ORDER BY used_at DESC LIMIT 1)`,
      [order.user_id]);
  }
  await pool.query(`UPDATE orders SET status='refunded', refund_reason=$2, updated_at=now() WHERE id=$1`, [orderId, reason]);
}

/** Marks an order paid exactly once and starts generation. Safe to call from duplicate webhooks. */
export async function markOrderPaid(orderId: string, paymentIntent?: string | null, tax = 0) {
  const paid = await tx(async (c) => {
    const o = await one(c,
      `UPDATE orders SET status='paid', stripe_payment_intent=COALESCE($2, stripe_payment_intent), tax=$3, updated_at=now()
       WHERE id=$1 AND status='pending' RETURNING id, user_id, amount`, [orderId, paymentIntent ?? null, tax]);
    if (!o) return null;
    return one(c, 'SELECT id FROM readings WHERE order_id=$1', [orderId]);
  });
  if (paid) {
    track(null, 'order_paid', { orderId });
    void runGeneration(paid.id);
  }
  return Boolean(paid);
}
