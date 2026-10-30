import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, pool } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { markOrderPaid } from '../readings/service.js';
import { getStripe } from './stripe.js';

export default async function paymentRoutes(app: FastifyInstance) {
  // Stripe needs the raw body to verify the signature, so this scope parses JSON as a Buffer.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/payments/webhook', async (req, reply) => {
      if (!config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: 'webhook_not_configured' });
      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(req.body as Buffer, req.headers['stripe-signature'] as string, config.STRIPE_WEBHOOK_SECRET);
      } catch {
        return reply.code(400).send({ error: 'bad_signature' });
      }
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const s = event.data.object;
        const orderId = s.metadata?.orderId;
        if (orderId && s.payment_status === 'paid') {
          if (s.currency !== 'usd') {
            req.log.warn({ orderId, currency: s.currency }, 'unexpected currency');
          } else {
            const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
            await markOrderPaid(orderId, pi, s.total_details?.amount_tax ?? 0);
          }
        }
      }
      if (event.type === 'checkout.session.expired') {
        const orderId = event.data.object.metadata?.orderId;
        if (orderId) await pool.query(`UPDATE orders SET status='canceled', updated_at=now() WHERE id=$1 AND status='pending'`, [orderId]);
      }
      return { received: true };
    });
  });

  // Local development only: stands in for Stripe Checkout.
  app.post('/payments/dev/confirm', async (req) => {
    if (!config.devPayments) throw notFound();
    const me = await requireUser(req);
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body);
    const o = await one(pool, `SELECT id FROM orders WHERE id=$1 AND user_id=$2 AND provider='dev'`, [orderId, me.id]);
    if (!o) throw badRequest('unknown_order');
    await markOrderPaid(orderId);
    return { ok: true };
  });
}
