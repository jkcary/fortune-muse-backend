import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { decrypt, encrypt } from '../src/lib/secrets.js';
import { extractJson } from '../src/modules/ai/llm.js';
import { newUser, setup } from './helpers.js';

let app: FastifyInstance;
let admin: Awaited<ReturnType<typeof newUser>>;

// A stand-in for any OpenAI-compatible provider: records requests and answers with `reply()`.
let fake: Server;
let fakeUrl = '';
let requests: { auth?: string; body: any }[] = [];
let reply: (body: any) => { status: number; content?: string } = () => ({ status: 200, content: '{}' });

beforeAll(async () => {
  app = await setup();
  admin = await newUser(app, 'admin@test.dev');
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ auth: req.headers.authorization, body });
      const r = reply(body);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.status === 200
        ? { model: body.model, choices: [{ message: { role: 'assistant', content: r.content } }] }
        : { error: { message: 'Incorrect API key provided' } }));
    });
  });
  await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
});
afterAll(async () => { fake.close(); await app.close(); await pool.end(); });
beforeEach(() => { requests = []; });

const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers: admin.auth, payload });
const useCustom = (task: string) => put(`/admin/ai/${task}`, { provider: 'custom', model: 'fake-1', baseUrl: fakeUrl });
const intake = (auth: Record<string, string>, text: string) =>
  app.inject({ method: 'POST', url: '/readings/intake', headers: auth, payload: { deityId: 'master-bao', topic: 'wealth', turns: [{ role: 'user', text }] } });

describe('AI settings', () => {
  it('encrypts keys (AES-256-GCM round trip, tamper-proof)', () => {
    const sealed = encrypt('sk-test-123456');
    expect(sealed).not.toContain('sk-test');
    expect(decrypt(sealed)).toBe('sk-test-123456');
    const [iv, tag, data] = sealed.split('.');
    expect(() => decrypt([iv, tag, data.slice(0, -2) + 'AA'].join('.'))).toThrow();
  });

  it('is admin-only', async () => {
    const u = await newUser(app);
    expect((await app.inject({ method: 'GET', url: '/admin/ai', headers: u.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/admin/ai/intake', headers: u.auth, payload: { provider: 'mock' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/ai', headers: admin.auth })).statusCode).toBe(200);
  });

  it('never sends a saved key back, and keeps it out of the audit log', async () => {
    const key = 'sk-very-secret-key-7777';
    await put('/admin/ai/keys/openai', { apiKey: key });
    const res = await app.inject({ method: 'GET', url: '/admin/ai', headers: admin.auth });
    expect(res.body).not.toContain(key);
    expect(res.json().keys.openai).toMatchObject({ source: 'console', last4: '7777' });
    const stored = (await pool.query("SELECT ciphertext FROM ai_keys WHERE provider='openai'")).rows[0].ciphertext;
    expect(stored).not.toContain(key);
    const audit = JSON.stringify((await pool.query('SELECT details FROM admin_audit')).rows);
    expect(audit).not.toContain(key);
    await app.inject({ method: 'DELETE', url: '/admin/ai/keys/openai', headers: admin.auth });
    expect((await app.inject({ method: 'GET', url: '/admin/ai', headers: admin.auth })).json().keys.openai.source).toBeNull();
  });

  it('validates settings', async () => {
    expect((await put('/admin/ai/intake', { provider: 'nope' })).statusCode).toBe(400);
    expect((await put('/admin/ai/intake', { provider: 'openai', model: '' })).statusCode).toBe(400);
    expect((await put('/admin/ai/intake', { provider: 'custom', model: 'x', baseUrl: 'ftp://x' })).statusCode).toBe(400);
  });
});

describe('OpenAI-compatible providers', () => {
  it('runs the intake on the chosen provider with its key and JSON mode', async () => {
    await useCustom('intake');
    await put('/admin/ai/keys/custom', { apiKey: 'custom-key-1234' });
    reply = () => ({ status: 200, content: '```json\n{"reply":"Tell me about your review.","ready":false,"summary":{"question":"Raise?","context":"","timeframe":"","goal":""}}\n```' });
    const u = await newUser(app);
    const out = (await intake(u.auth, 'Should I ask for a raise?')).json();
    expect(out.reply).toBe('Tell me about your review.');
    expect(requests).toHaveLength(1);
    expect(requests[0].auth).toBe('Bearer custom-key-1234');
    expect(requests[0].body.model).toBe('fake-1');
    // "custom" uses json_object, so the schema goes into the system prompt.
    expect(requests[0].body.response_format).toEqual({ type: 'json_object' });
    expect(requests[0].body.messages[0].content).toContain('JSON Schema');
  });

  it('lights up "Start" only after a follow-up, even if the model already knows enough', async () => {
    await useCustom('intake');
    reply = () => ({ status: 200, content: '{"reply":"Why this month?","ready":true,"summary":{"question":"Start my side project this month?","context":"","timeframe":"this month","goal":""}}' });
    const u = await newUser(app);
    expect((await intake(u.auth, 'Should I start my side project this month?')).json()).toMatchObject({ ready: false, canStart: false });
    const two = await app.inject({ method: 'POST', url: '/readings/intake', headers: u.auth, payload: { deityId: 'master-bao', topic: 'wealth', turns: [
      { role: 'user', text: 'Should I start my side project this month?' }, { role: 'assistant', text: 'Why this month?' }, { role: 'user', text: 'My contract ends' }] } });
    expect(two.json()).toMatchObject({ ready: true, canStart: true });
    // json_object providers get the conversation as one user message (DeepSeek returns empty replies otherwise).
    const sent = requests.at(-1)!.body.messages;
    expect(sent).toHaveLength(2);
    expect(sent[1].content).toContain('User: My contract ends');
    expect(sent[1].content).toContain('You: Why this month?');
  });

  it('retries once on invalid JSON, then falls back to the scripted reply', async () => {
    await useCustom('intake');
    reply = () => ({ status: 200, content: 'Sure! Here is my answer without JSON.' });
    const u = await newUser(app);
    const out = (await intake(u.auth, 'Should I ask for a raise?')).json();
    expect(requests).toHaveLength(2);
    expect(out.reply).toContain('What is going on around this');
  });

  it('writes readings with the reading model, and the result names it', async () => {
    await useCustom('reading');
    reply = () => ({ status: 200, content: JSON.stringify({
      direction: 'East', direction_note: 'Face east while you plan.', answer: 'Steady steps win this week.', outfit_index: 0, shoes_index: 0,
      avoid_color_index: 0, song_index: 0, drink_index: 0, food_index: 0, lucky_action: 'Before 3 p.m. today, write your three wins on one card.',
      gentle_reminder: 'Rest well.', dos: ['Prepare notes'], donts: ['Rush'], lucky_hour: '', reflections: [], deity_message: 'Bao nods.',
    }) });
    const u = await newUser(app);
    const created = (await app.inject({ method: 'POST', url: '/readings', headers: u.auth, payload: { deityId: 'master-bao', topic: 'wealth', tier: 'standard', question: 'Raise this week?', digitalContentConsent: true } })).json();
    await app.inject({ method: 'POST', url: '/payments/dev/confirm', headers: u.auth, payload: { orderId: created.payment.orderId } });
    let r: any;
    for (let i = 0; i < 50; i++) {
      r = (await app.inject({ method: 'GET', url: `/readings/${created.reading.id}`, headers: u.auth })).json().reading;
      if (r.status === 'ready') break;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(r.result.answer).toBe('Steady steps win this week.');
    const row = (await pool.query('SELECT result_json FROM readings WHERE id=$1', [created.reading.id])).rows[0];
    expect(row.result_json.generator).toBe('custom:fake-1');
  });

  it('"Test connection" reports a rejected key clearly', async () => {
    reply = () => ({ status: 401 });
    const res = (await app.inject({ method: 'POST', url: '/admin/ai/test', headers: admin.auth, payload: {
      settings: { provider: 'custom', model: 'fake-1', baseUrl: fakeUrl }, apiKey: 'wrong-key-0000',
    } })).json();
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toContain('HTTP 401');
    expect(res.error).not.toContain('wrong-key');
  });

  it('extracts JSON wrapped in prose or code fences', () => {
    expect(extractJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => extractJson('no json')).toThrow();
  });
});
