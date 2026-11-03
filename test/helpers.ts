import type { FastifyInstance } from 'fastify';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { devOutbox } from '../src/lib/mailer.js';
import { buildServer } from '../src/server.js';

export async function setup(): Promise<FastifyInstance> {
  const database=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(process.env.NODE_ENV!=='test'||!database.endsWith('_test'))throw new Error('Refusing to reset a database without the _test suffix.');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seed();
  return buildServer();
}

let n = 0;
/** Registers and verifies a user, returns its bearer token and id. */
export async function newUser(app: FastifyInstance, email = `user${++n}-${Date.now()}@test.dev`) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'password123', ageConfirmed: true, acceptTerms: true, timezone: 'America/Los_Angeles' } });
  if (res.statusCode !== 200) throw new Error(res.body);
  const { token } = res.json();
  const mail = devOutbox.filter((m) => m.to === email).at(-1)!;
  const verifyToken = mail.text.match(/token=([\w-]+)/)![1];
  await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: verifyToken } });
  const me = (await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } })).json();
  return { token, id: me.id as string, handle: me.handle as string, email, auth: { authorization: `Bearer ${token}` } };
}

/** Creates a paid (dev) reading and waits until it is ready. */
export async function paidReading(app: FastifyInstance, auth: Record<string, string>, question = 'Is this a good week to ask for a raise?', topic = 'wealth') {
  const created = await app.inject({ method: 'POST', url: '/readings', headers: auth, payload: { deityId: 'master-bao', topic, tier: 'deep', question, digitalContentConsent: true } });
  const { reading, payment } = created.json();
  await app.inject({ method: 'POST', url: '/payments/dev/confirm', headers: auth, payload: { orderId: payment.orderId } });
  for (let i = 0; i < 50; i++) {
    const r = (await app.inject({ method: 'GET', url: `/readings/${reading.id}`, headers: auth })).json().reading;
    if (r.status === 'ready') return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('reading never became ready');
}
