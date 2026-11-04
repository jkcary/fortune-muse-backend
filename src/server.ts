import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { HttpError } from './lib/errors.js';
import { devOutbox } from './lib/mailer.js';
import oracleRoutes from './modules/oracle/routes.js';
import gardenRoutes from './modules/garden/routes.js';
import accountRoutes from './modules/account/routes.js';
import adminRoutes from './modules/admin/routes.js';
import aiRoutes from './modules/ai/routes.js';
import { getTaskConfig } from './modules/ai/settings.js';
import oauthRoutes from './modules/auth/oauth.js';
import authRoutes from './modules/auth/routes.js';
import deityRoutes from './modules/deities/routes.js';
import drawRoutes from './modules/draws/routes.js';
import memoryRoutes from './modules/memory/routes.js';
import moderationRoutes from './modules/moderation/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import profileRoutes from './modules/profile/routes.js';
import readingRoutes from './modules/readings/routes.js';
import roomRoutes from './modules/rooms/routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildServer() {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.x-oracle-token'] },
    trustProxy: true,
  });

  await app.register(cors, {
    // @fastify/cors 11 allows only GET/HEAD/POST by default; the app also PATCHes and DELETEs.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || config.NODE_ENV === 'development'),
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: () => config.NODE_ENV === 'test' });
  await app.register(websocket);
  await app.register(fastifyStatic, { root: path.join(root, 'public'), prefix: '/console/' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid_input', message: err.issues[0]?.message ?? 'Invalid input', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    const [intake, reading] = await Promise.all([getTaskConfig('intake'), getTaskConfig('reading')]);
    const name = (c: { provider: string; model: string }) => (c.model ? `${c.provider}:${c.model}` : c.provider);
    return { ok: true, devPayments: config.devPayments, ai: { intake: name(intake), reading: name(reading) } };
  });
  app.get('/console', async (_req, reply) => reply.redirect('/console/admin.html'));

  if (config.NODE_ENV !== 'production') {
    // Lets you read verification / magic-link emails locally without a mail provider.
    app.get('/dev/outbox', async () => ({ mails: [...devOutbox].reverse() }));
  }

  for (const routes of [authRoutes, oauthRoutes, profileRoutes, deityRoutes, readingRoutes, paymentRoutes, memoryRoutes, drawRoutes,
    roomRoutes, moderationRoutes, accountRoutes, adminRoutes, aiRoutes, oracleRoutes, gardenRoutes]) {
    await app.register(routes);
  }
  return app;
}
