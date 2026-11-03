import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { many, one, pool, tx } from '../../db/pool.js';
import { requireUser, requireVerified } from '../../lib/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { isSuper } from '../../lib/super.js';
import { asLang } from '../../lib/i18n.js';
import { localDate } from '../../lib/time.js';
import { LEGAL_VERSION } from '../auth/routes.js';
import { getStripe } from '../payments/stripe.js';
import { HELP_RESOURCES, screenQuestion } from '../safety/safety.js';
import { clusterQuestion, PRICES } from './catalog.js';
import { MAX_ANSWERS, runIntake, Summary, Turn, USER_MAX } from './intake.js';
import { enqueue, kickDelivery } from '../delivery/queue.js';

const publicReading = (r: any) => ({
  id: r.id, deityId: r.deity_id, topic: r.topic, tier: r.tier, question: r.question,
  status: r.status, price: r.price, orderId: r.order_id, createdAt: r.created_at,
  result: r.status === 'ready' ? r.result_json : null,
  intake: r.intake_json ?? null,
});

/** A transcript that starts with the user and alternates; user turns stay within the question limit. */
const Transcript = z.array(Turn).min(1).max(MAX_ANSWERS * 2 + 1).refine(
  (ts) => ts.every((t, i) => t.role === (i % 2 === 0 ? 'user' : 'assistant') && (t.role === 'assistant' || t.text.length <= USER_MAX)),
  { message: 'Invalid conversation.' },
);

export default async function readingRoutes(app: FastifyInstance) {
  // The free conversation before a reading (see intake.ts). Only the reading itself is charged.
  app.post('/readings/intake', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const me = await requireVerified(req);
    const body = z.object({
      deityId: z.string(),
      topic: z.enum(['wealth', 'love']),
      turns: Transcript,
      start: z.boolean().default(false),
    }).parse(req.body);
    const deity = await one(pool, 'SELECT persona_prompt FROM deities WHERE id=$1 AND active', [body.deityId]);
    if (!deity) throw badRequest('unknown_deity');
    const u = await one<{ language: string }>(pool, 'SELECT language FROM users WHERE id=$1', [me.id]);
    const out = await runIntake({ deity, topic: body.topic, lang: asLang(u?.language), turns: body.turns, start: body.start });
    if ('safety' in out) {
      track(me.id, 'safety_intercept', { kind: out.safety, stage: 'intake' });
      return { safety: { kind: out.safety, ...HELP_RESOURCES[out.safety] } };
    }
    track(me.id, 'intake_turn', { answers: body.turns.filter((t) => t.role === 'user').length, ready: out.ready, generator: out.generator });
    return { reply: out.reply, ready: out.ready, canStart: out.canStart, summary: out.summary };
  });

  app.post('/readings', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const me = await requireVerified(req);
    const body = z.object({
      deityId: z.string(),
      topic: z.enum(['wealth', 'love']),
      tier: z.enum(['standard', 'detailed', 'deep']),
      question: z.string().trim().min(3).max(200),
      // The conversation that led to this question, kept with the reading.
      intake: z.object({ turns: Transcript, summary: Summary }).optional(),
      useVoucher: z.boolean().default(false),
      // Consent to immediate delivery of digital content (no refund once delivered, except failures).
      digitalContentConsent: z.literal(true, { message: 'Please confirm the digital content terms.' }),
    }).parse(req.body);

    // Sensitive topics get help resources instead of a reading, and no charge (plan §M3).
    const verdict = [body.question, ...(body.intake?.turns.filter((t) => t.role === 'user').map((t) => t.text) ?? [])]
      .map(screenQuestion).find((v) => !v.ok) ?? { ok: true as const };
    if (!verdict.ok) {
      track(me.id, 'safety_intercept', { kind: verdict.kind });
      return { safety: { kind: verdict.kind, ...HELP_RESOURCES[verdict.kind] } };
    }

    const deity = await one(pool, 'SELECT id FROM deities WHERE id=$1 AND active', [body.deityId]);
    if (!deity) throw badRequest('unknown_deity');
    if (body.useVoucher && body.tier !== 'standard') throw badRequest('voucher_tier', 'Vouchers cover a standard reading.');

    // Super accounts read for free (recorded as a $0 'comp' order) and keep their vouchers.
    const free = isSuper((await one(pool, 'SELECT email, email_verified FROM users WHERE id=$1', [me.id]))!);
    if (free) body.useVoucher = false;
    const price = PRICES[body.tier].amount;
    const cluster = clusterQuestion(body.topic, body.question);
    const today = localDate(me.timezone);

    const { reading, order } = await tx(async (c) => {
      await c.query('INSERT INTO consents(user_id,type,version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [me.id, 'digital_content', LEGAL_VERSION]);
      let voucherId: string | null = null;
      if (body.useVoucher) {
        const v = await one(c,
          `UPDATE inventory SET used_at=now() WHERE id = (
             SELECT id FROM inventory WHERE user_id=$1 AND reward_id='free-reading' AND used_at IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id`, [me.id]);
        if (!v) throw conflict('no_voucher', 'You have no free reading vouchers.');
        voucherId=v.id;
      }
      const order = await one(c,
        `INSERT INTO orders(user_id, provider, amount, status, voucher_inventory_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [me.id, free ? 'comp' : body.useVoucher ? 'voucher' : config.devPayments ? 'dev' : 'stripe',
          free || body.useVoucher ? 0 : price, free || body.useVoucher ? 'paid' : 'pending', voucherId]);
      const reading = await one(c,
        `INSERT INTO readings(user_id, deity_id, topic, tier, question, topic_cluster, price, order_id, local_date, intake_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [me.id, body.deityId, body.topic, body.tier, body.question, cluster.id, order.amount, order.id, today, body.intake ?? null]);
      if (free || body.useVoucher) await enqueue('legacy', reading.id, c);
      return { reading, order };
    });
    track(me.id, 'reading_created', { tier: body.tier, voucher: body.useVoucher, comp: free });

    if (free || body.useVoucher) {
      kickDelivery();
      return { reading: publicReading(reading), payment: { type: 'none' } };
    }
    if (config.devPayments) {
      return { reading: publicReading(reading), payment: { type: 'dev', orderId: order.id, amount: price } };
    }

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: (await one(pool, 'SELECT email FROM users WHERE id=$1', [me.id])).email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: price,
          tax_behavior: 'exclusive',
          product_data: { name: `Fortune Muse ${PRICES[body.tier].label} Reading`, description: 'For entertainment purposes only.' },
        },
      }],
      automatic_tax: { enabled: true },
      metadata: { orderId: order.id, readingId: reading.id },
      payment_intent_data: { metadata: { orderId: order.id } },
      success_url: `${config.APP_URL}/reading/${reading.id}?paid=1`,
      cancel_url: `${config.APP_URL}/reading/${reading.id}?canceled=1`,
    });
    await pool.query('UPDATE orders SET provider_session_id=$2 WHERE id=$1', [order.id, session.id]);
    return { reading: publicReading(reading), payment: { type: 'stripe', checkoutUrl: session.url } };
  });

  app.get('/readings', async (req) => {
    const me = await requireUser(req);
    const rows = await many(pool, `SELECT * FROM readings WHERE user_id=$1 AND status <> 'awaiting_payment' ORDER BY created_at DESC LIMIT 50`, [me.id]);
    return { readings: rows.map(publicReading) };
  });

  app.get('/readings/:id', async (req) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await one(pool, 'SELECT * FROM readings WHERE id=$1 AND user_id=$2', [id, me.id]);
    if (!r) throw notFound('Reading not found');
    return { reading: publicReading(r) };
  });

  app.get('/orders', async (req) => {
    const me = await requireUser(req);
    const orders = await many(pool,
      `SELECT oc.id AS oracle_id, o.id, o.amount, o.currency, o.tax, o.status, o.provider, o.created_at, r.id AS reading_id, r.tier
       FROM orders o LEFT JOIN readings r ON r.order_id=o.id LEFT JOIN oracle_casts oc ON oc.order_id=o.id WHERE o.user_id=$1 AND o.status <> 'pending' ORDER BY o.created_at DESC`, [me.id]);
    return { orders };
  });

  app.post('/orders/:id/refund-request', async (req) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const o = await one(pool,
      `UPDATE orders SET status='refund_requested', refund_reason=$3, updated_at=now()
       WHERE id=$1 AND user_id=$2 AND status='paid' AND provider NOT IN ('voucher','comp') RETURNING id, status`, [id, me.id, reason]);
    if (!o) throw badRequest('not_refundable', 'This order cannot be refunded.');
    const undelivered=await one(pool,`SELECT id FROM readings WHERE order_id=$1 AND status<>'ready'
      UNION ALL SELECT id FROM oracle_casts WHERE order_id=$1 AND premium_status<>'ready' LIMIT 1`,[id]);
    if(undelivered){await enqueue('refund',id);kickDelivery();}
    return o;
  });
}
