import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { pool } from '../src/db/pool.js';
import { newUser, paidReading, setup } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { app = await setup(); });
afterAll(async () => { await app.close(); await pool.end(); });

describe('accounts (M1)', () => {
  it('refuses registration without the 18+ confirmation', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'kid@test.dev', password: 'password123', ageConfirmed: false, acceptTerms: true } });
    expect(res.statusCode).toBe(400);
  });

  it('refuses registration from outside the launch region', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', headers: { 'cf-ipcountry': 'DE' }, payload: { email: 'de@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true } });
    expect(res.json().error).toBe('region_unavailable');
  });

  it('assigns a handle and an avatar, and blocks readings until the email is verified', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'new@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true } });
    const auth = { authorization: `Bearer ${res.json().token}` };
    const me = (await app.inject({ method: 'GET', url: '/me', headers: auth })).json();
    expect(me.handle).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
    expect(me.avatar.baseId).toBeTruthy();
    const r = await app.inject({ method: 'POST', url: '/readings', headers: auth, payload: { deityId: 'master-bao', topic: 'love', tier: 'standard', question: 'Will my crush notice me?', digitalContentConsent: true } });
    expect(r.json().error).toBe('email_unverified');
  });

  it('logs in and resets a password', async () => {
    const u = await newUser(app, 'reset@test.dev');
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'password123' } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email: u.email } });
    const { devOutbox } = await import('../src/lib/mailer.js');
    const token = devOutbox.at(-1)!.text.match(/token=([\w-]+)/)![1];
    expect((await app.inject({ method: 'POST', url: '/auth/reset', payload: { token, password: 'newpassword1' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'newpassword1' } })).statusCode).toBe(200);
  });
});

describe('readings (M3/M4/M8)', () => {
  it('delivers a complete result after payment', async () => {
    const u = await newUser(app);
    const r = await paidReading(app, u.auth);
    const res = r.result;
    for (const key of ['answer', 'direction', 'outfit', 'shoes', 'avoidColor', 'song', 'drink', 'food', 'luckyAction', 'gentleReminder', 'dos', 'donts', 'reflections']) {
      expect(res[key], key).toBeTruthy();
    }
    expect(res.disclaimer).toMatch(/entertainment/i);
    expect(res.aiGenerated).toBe(true);
    expect(res.song.spotifyUrl).toContain('open.spotify.com');
  });

  it('answers crisis questions with help resources and no charge', async () => {
    const u = await newUser(app);
    const res = await app.inject({ method: 'POST', url: '/readings', headers: u.auth, payload: { deityId: 'master-bao', topic: 'love', tier: 'standard', question: 'I want to kill myself after the breakup', digitalContentConsent: true } });
    expect(res.json().safety.kind).toBe('crisis');
    expect(JSON.stringify(res.json())).toContain('988');
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [u.id])).rows[0].n).toBe(0);
  });

  it('does not deliver a result before payment', async () => {
    const u = await newUser(app);
    const { reading } = (await app.inject({ method: 'POST', url: '/readings', headers: u.auth, payload: { deityId: 'nugget-nell', topic: 'wealth', tier: 'standard', question: 'Should I start my side project?', digitalContentConsent: true } })).json();
    const r = (await app.inject({ method: 'GET', url: `/readings/${reading.id}`, headers: u.auth })).json().reading;
    expect(r.status).toBe('awaiting_payment');
    expect(r.result).toBeNull();
  });
});

describe('memory (M5)', () => {
  it('greets plainly with no memory, quotes the user after feedback, and stops when turned off', async () => {
    const u = await newUser(app);
    const plain = (await app.inject({ method: 'GET', url: '/greeting?deityId=master-bao', headers: u.auth })).json();
    expect(plain.memoryRef).toBeNull();

    await app.inject({ method: 'POST', url: '/feedback', headers: u.auth, payload: { content: 'Feeling nervous about my interview', mood: 'low' } });
    // Backdate the memory to yesterday so the greeting picks it up.
    await pool.query(`UPDATE memories SET created_at = now() - interval '1 day' WHERE user_id=$1`, [u.id]);
    const g = (await app.inject({ method: 'GET', url: '/greeting?deityId=master-bao', headers: u.auth })).json();
    expect(g.text).toContain('Yesterday you told me: “Feeling nervous about my interview”');

    await app.inject({ method: 'PATCH', url: '/settings/memory', headers: u.auth, payload: { enabled: false } });
    expect((await app.inject({ method: 'GET', url: '/greeting?deityId=master-bao', headers: u.auth })).json().memoryRef).toBeNull();
    const fb = (await app.inject({ method: 'POST', url: '/feedback', headers: u.auth, payload: { content: 'should not be stored' } })).json();
    expect(fb.saved).toBe(false);

    const list = (await app.inject({ method: 'GET', url: '/memories', headers: u.auth })).json();
    expect(list.items).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/memories/${list.items[0].id}`, headers: u.auth });
    expect((await app.inject({ method: 'GET', url: '/memories', headers: u.auth })).json().items).toHaveLength(0);
  });
});

describe('daily draw (M6)', () => {
  it('allows exactly one free draw per day and publishes odds summing to 100%', async () => {
    const u = await newUser(app);
    const today = (await app.inject({ method: 'GET', url: '/draws/today', headers: u.auth })).json();
    const total = today.odds.reduce((s: number, o: any) => s + o.probability, 0);
    expect(Math.round(total)).toBe(100);
    expect((await app.inject({ method: 'POST', url: '/draws/today', headers: u.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/draws/today', headers: u.auth })).statusCode).toBe(409);
  });

  it('lets a free reading voucher pay for a standard reading', async () => {
    const u = await newUser(app);
    await pool.query(`INSERT INTO inventory(user_id,reward_id) VALUES ($1,'free-reading')`, [u.id]);
    const res = (await app.inject({ method: 'POST', url: '/readings', headers: u.auth, payload: { deityId: 'sir-greenleaf', topic: 'love', tier: 'standard', question: 'Where should I look to meet someone new?', useVoucher: true, digitalContentConsent: true } })).json();
    expect(res.payment.type).toBe('none');
    expect((await app.inject({ method: 'GET', url: '/me', headers: u.auth })).json().freeReadings).toBe(0);
  });
});

describe('same-question rooms (M7)', () => {
  it('puts similar questions in one room, filters chat, supports report/block, and closes after 24h', async () => {
    const a = await newUser(app);
    const b = await newUser(app);
    const ra = await paidReading(app, a.auth, 'Should I ask my boss for a raise?');
    const rb = await paidReading(app, b.auth, 'Will I get a promotion this year?');
    const ja = (await app.inject({ method: 'POST', url: '/rooms/join', headers: a.auth, payload: { readingId: ra.id } })).json();
    const jb = (await app.inject({ method: 'POST', url: '/rooms/join', headers: b.auth, payload: { readingId: rb.id } })).json();
    expect(ja.room.id).toBe(jb.room.id);
    expect(jb.members.map((m: any) => m.handle)).toEqual(expect.arrayContaining([a.handle, b.handle]));
    expect(JSON.stringify(jb.members)).not.toContain('@');

    // Live chat over WebSocket
    await app.listen({ port: 0 });
    const port = (app.server.address() as any).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/${ja.room.id}/ws?token=${b.token}`);
    const received: any[] = [];
    await new Promise((res) => ws.on('message', (d) => { const m = JSON.parse(d.toString()); received.push(m); if (m.type === 'ready') res(null); }));
    const sent = await app.inject({ method: 'POST', url: `/rooms/${ja.room.id}/messages`, headers: a.auth, payload: { text: 'Good luck everyone!' } });
    expect(sent.statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 100));
    expect(received.some((m) => m.type === 'message' && m.message.text === 'Good luck everyone!')).toBe(true);

    await new Promise((res) => setTimeout(res, 1100));
    const blocked = await app.inject({ method: 'POST', url: `/rooms/${ja.room.id}/messages`, headers: a.auth, payload: { text: 'text me at 555-123-4567' } });
    expect(blocked.json().error).toBe('blocked_contact_info');

    const msgId = sent.json().message.id;
    expect((await app.inject({ method: 'POST', url: '/reports', headers: b.auth, payload: { messageId: msgId, reason: 'spam' } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/blocks', headers: b.auth, payload: { userId: a.id } });
    const view = (await app.inject({ method: 'GET', url: `/rooms/${ja.room.id}`, headers: b.auth })).json();
    expect(view.messages).toHaveLength(0);
    expect(view.members.map((m: any) => m.id)).not.toContain(a.id);

    const closed = new Promise((res) => ws.on('close', res));
    await pool.query(`UPDATE rooms SET expires_at = now() - interval '1 second' WHERE id=$1`, [ja.room.id]);
    const { expireRooms } = await import('../src/modules/rooms/service.js');
    await expireRooms();
    await closed;
    expect((await app.inject({ method: 'GET', url: `/rooms/${ja.room.id}`, headers: a.auth })).statusCode).toBe(404);
    expect((await pool.query('SELECT count(*)::int AS n FROM messages WHERE room_id=$1', [ja.room.id])).rows[0].n).toBe(0);
    // The report keeps its own copy for moderators.
    expect((await pool.query('SELECT message_snapshot FROM reports WHERE message_id=$1', [msgId])).rows[0].message_snapshot).toBe('Good luck everyone!');
  });
});

describe('privacy (M9) and admin (M10)', () => {
  it('exports and deletes an account', async () => {
    const u = await newUser(app);
    await paidReading(app, u.auth);
    const exp = (await app.inject({ method: 'POST', url: '/account/export', headers: u.auth })).json();
    expect(exp.profile.email).toBe(u.email);
    expect(exp.readings).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: '/account', headers: u.auth, payload: { confirm: 'DELETE', password: 'password123' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/me', headers: u.auth })).statusCode).toBe(401);
  });

  it('restricts admin endpoints and returns dashboard KPIs', async () => {
    const u = await newUser(app);
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: u.auth })).statusCode).toBe(403);
    const admin = await newUser(app, 'admin@test.dev');
    const stats = (await app.inject({ method: 'GET', url: '/admin/stats', headers: admin.auth })).json();
    expect(stats.kpis.map((k: any) => k.key)).toEqual(['signup_to_reading', 'reading_to_paid', 'd1', 'd7', 'memory_on', 'room_speak']);
    const alcohol = await app.inject({ method: 'POST', url: '/admin/content', headers: admin.auth, payload: { kind: 'drink', data: { name: 'Red wine' } } });
    expect(alcohol.json().error).toBe('alcohol');
  });
});
