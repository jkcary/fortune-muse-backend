import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { _test } from '../src/modules/readings/generator.js';
import { buildIntakeMessages, buildIntakeSystem, mockIntake, START_NOTE } from '../src/modules/readings/intake.js';
import { screenQuestion } from '../src/modules/safety/safety.js';
import { newUser, setup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await setup(); });
afterAll(async () => { await app.close(); await pool.end(); });

const intake = (auth: Record<string, string>, turns: { role: string; text: string }[], start = false) =>
  app.inject({ method: 'POST', url: '/readings/intake', headers: auth, payload: { deityId: 'master-bao', topic: 'wealth', turns, start } });

describe('intake prompt', () => {
  it('asks one question at a time, in the user’s language, without predictions', () => {
    const sys = buildIntakeSystem('You are Master Bao.', 'wealth', 'zh-Hans');
    expect(sys).toContain('ONE short question per turn');
    expect(sys).toContain('do not give the fortune');
    expect(sys).toContain('Simplified Chinese');
  });
  it('tells the model when the user starts the reading early', () => {
    const msgs = buildIntakeMessages([{ role: 'user', text: 'Raise?' }, { role: 'assistant', text: 'Tell me more.' }], true);
    expect(msgs.at(-1)).toEqual({ role: 'user', content: START_NOTE });
  });
  it('feeds the conversation summary into the reading prompt', () => {
    const lib = { songs: [{ title: 'Lovely Day', artist: 'Bill Withers' }], drinks: ['Tea'], foods: ['Noodles'], outfits: [{ style: 'Blazer', color: 'navy' }], shoes: [{ style: 'Loafers', color: 'brown' }], colors: ['olive'], actions: ['Before noon today, write one goal.'] };
    const { user } = _test.buildPrompt({ deity: { name: 'Bao', persona_prompt: 'p' }, topic: 'wealth', tier: 'standard', question: 'Raise?', library: lib, memories: [], localDate: '2026-11-02', language: 'en-US', intake: { context: 'Review is Friday', timeframe: 'this week', goal: 'a 5% raise' } });
    expect(user).toContain('- Situation: Review is Friday');
    expect(user).toContain('- Hoping for: a 5% raise');
  });
});

describe('mock intake (no API key)', () => {
  it('asks three follow-ups, then is ready with a summary', () => {
    const turns: { role: 'user' | 'assistant'; text: string }[] = [];
    const answers = ['Should I ask for a raise?', 'My review is on Friday', 'This week', 'Five percent more'];
    for (const [i, a] of answers.entries()) {
      turns.push({ role: 'user', text: a });
      const r = mockIntake(turns, 'en-US', false);
      expect(r.ready).toBe(i === 3);
      // The question alone is not enough; with the situation too, the reading can start.
      expect(r.canStart).toBe(i >= 1);
      turns.push({ role: 'assistant', text: r.reply });
    }
    expect(mockIntake(turns.slice(0, -1), 'en-US', false).summary).toEqual({ question: 'Should I ask for a raise?', context: 'My review is on Friday', timeframe: 'This week', goal: 'Five percent more' });
  });
  it('speaks every app language and can start early', () => {
    expect(mockIntake([{ role: 'user', text: '这周适合提加薪吗？' }], 'zh-Hans', false).reply).toContain('情况');
    expect(mockIntake([{ role: 'user', text: '這週適合提加薪嗎？' }], 'zh-Hant', false).reply).toContain('情況');
    // "Start now" is ignored until enough is known.
    expect(mockIntake([{ role: 'user', text: 'Raise?' }], 'en-GB', true)).toMatchObject({ ready: false, canStart: false });
    const two = [{ role: 'user' as const, text: 'Raise?' }, { role: 'assistant' as const, text: 'Tell me more.' }, { role: 'user' as const, text: 'Review is Friday' }];
    expect(mockIntake(two, 'en-GB', true)).toMatchObject({ ready: true, canStart: true, summary: { question: 'Raise?', context: 'Review is Friday' } });
  });
});

describe('POST /readings/intake', () => {
  it('runs the conversation, then the reading keeps the transcript', async () => {
    const u = await newUser(app);
    const turns = [{ role: 'user', text: 'Is this a good week to ask for a raise?' }];
    const first = (await intake(u.auth, turns)).json();
    expect(first).toMatchObject({ ready: false, canStart: false, summary: { question: 'Is this a good week to ask for a raise?' } });
    // Asking to start this early does nothing.
    expect((await intake(u.auth, turns, true)).json()).toMatchObject({ ready: false, canStart: false });
    turns.push({ role: 'assistant', text: first.reply }, { role: 'user', text: 'My review is on Friday' });
    const done = (await intake(u.auth, turns, true)).json();
    expect(done.ready).toBe(true);

    const created = await app.inject({ method: 'POST', url: '/readings', headers: u.auth, payload: {
      deityId: 'master-bao', topic: 'wealth', tier: 'standard', question: done.summary.question,
      intake: { turns, summary: done.summary }, digitalContentConsent: true,
    } });
    const { reading } = created.json();
    expect(reading.intake.summary.context).toBe('My review is on Friday');
    expect((await app.inject({ method: 'GET', url: `/readings/${reading.id}`, headers: u.auth })).json().reading.intake.turns).toHaveLength(3);
  });

  it('rejects malformed transcripts and long messages', async () => {
    const u = await newUser(app);
    expect((await intake(u.auth, [{ role: 'assistant', text: 'Hi' }])).statusCode).toBe(400);
    expect((await intake(u.auth, [{ role: 'user', text: 'x'.repeat(201) }])).statusCode).toBe(400);
  });

  it('answers crisis messages with help resources, in English or Chinese', async () => {
    const u = await newUser(app);
    expect((await intake(u.auth, [{ role: 'user', text: 'I want to end my life' }])).json().safety.kind).toBe('crisis');
    expect((await intake(u.auth, [{ role: 'user', text: '我不想活了' }])).json().safety.kind).toBe('crisis');
    expect(screenQuestion('我想杀了他').ok).toBe(false);
  });

  it('needs a verified account', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'unverified-intake@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true } });
    expect((await intake({ authorization: `Bearer ${res.json().token}` }, [{ role: 'user', text: 'Raise?' }])).json().error).toBe('email_unverified');
  });
});
