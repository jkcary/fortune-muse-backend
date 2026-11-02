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

describe('sign in with Google / Microsoft / Apple', () => {
  /** Runs the dev stand-in flow and returns the ticket the app would receive. */
  async function ticketFor(provider: string, email: string) {
    const start = await app.inject({ method: 'GET', url: `/auth/oauth/${provider}/start?redirect=${encodeURIComponent('http://localhost:8081/oauth')}` });
    expect(start.statusCode).toBe(302);
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const state = new URL(start.headers.location as string, 'http://x').searchParams.get('state')!;
    const cb = await app.inject({ method: 'GET', url: `/auth/oauth/${provider}/callback?${new URLSearchParams({ state, dev_email: email })}`, headers: { cookie } });
    const back = new URL(cb.headers.location as string);
    expect(back.origin + back.pathname).toBe('http://localhost:8081/oauth');
    return back.searchParams.get('ticket')!;
  }

  it('lists the providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/oauth/providers' });
    expect(res.json().providers.map((p: any) => p.id)).toEqual(['google', 'microsoft', 'apple']);
  });

  it('asks a new user for consent, then creates a verified account; tickets are single use', async () => {
    const ticket = await ticketFor('google', 'Fresh@Gmail.com');
    const first = await app.inject({ method: 'POST', url: '/auth/oauth/exchange', payload: { ticket } });
    expect(first.json()).toMatchObject({ needsSignup: true, email: 'fresh@gmail.com' });
    const second = await app.inject({ method: 'POST', url: '/auth/oauth/exchange', payload: { ticket, ageConfirmed: true, acceptTerms: true, timezone: 'America/Chicago' } });
    const auth = { authorization: `Bearer ${second.json().token}` };
    const me = (await app.inject({ method: 'GET', url: '/me', headers: auth })).json();
    expect(me).toMatchObject({ email: 'fresh@gmail.com', email_verified: true, timezone: 'America/Chicago' });
    expect(me.avatar.baseId).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/auth/oauth/exchange', payload: { ticket } })).json().error).toBe('invalid_ticket');
    // Next time the same identity signs straight in.
    const again = await app.inject({ method: 'POST', url: '/auth/oauth/exchange', payload: { ticket: await ticketFor('google', 'fresh@gmail.com') } });
    expect(again.json().token).toBeTruthy();
  });

  it('links to an existing email account', async () => {
    const u = await newUser(app, 'linked@icloud.com');
    const res = await app.inject({ method: 'POST', url: '/auth/oauth/exchange', payload: { ticket: await ticketFor('apple', u.email) } });
    const me = (await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${res.json().token}` } })).json();
    expect(me.id).toBe(u.id);
  });

  it('rejects foreign redirects and callbacks from another browser', async () => {
    const bad = await app.inject({ method: 'GET', url: `/auth/oauth/microsoft/start?redirect=${encodeURIComponent('https://evil.example/oauth')}` });
    expect(bad.json().error).toBe('invalid_redirect');
    const start = await app.inject({ method: 'GET', url: `/auth/oauth/microsoft/start?redirect=${encodeURIComponent('http://localhost:8081/oauth')}` });
    const state = new URL(start.headers.location as string, 'http://x').searchParams.get('state')!;
    const cb = await app.inject({ method: 'GET', url: `/auth/oauth/microsoft/callback?${new URLSearchParams({ state, dev_email: 'x@outlook.com' })}` });
    expect(cb.json().error).toBe('invalid_state');
  });
});

describe('language', () => {
  it('accepts only the four app languages and stores the choice', async () => {
    const u = await newUser(app);
    expect((await app.inject({ method: 'GET', url: '/me', headers: u.auth })).json().language).toBe('en-US');
    expect((await app.inject({ method: 'PATCH', url: '/me', headers: u.auth, payload: { language: 'fr-FR' } })).statusCode).toBe(400);
    for (const language of ['zh-Hans', 'zh-Hant', 'en-GB', 'en-US']) {
      expect((await app.inject({ method: 'PATCH', url: '/me', headers: u.auth, payload: { language } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/me', headers: u.auth })).json().language).toBe(language);
    }
  });

  it('lets browsers PATCH and DELETE (CORS preflight)', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/me', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'PATCH' } });
    expect(String(res.headers['access-control-allow-methods'])).toMatch(/PATCH.*DELETE|DELETE.*PATCH/);
  });

  it('takes the device language at signup', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'zh@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true, language: 'zh-Hant' } });
    const me = (await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${res.json().token}` } })).json();
    expect(me.language).toBe('zh-Hant');
  });
});

describe('super accounts', () => {
  const reading = (auth: Record<string, string>) => app.inject({ method: 'POST', url: '/readings', headers: auth,
    payload: { deityId: 'master-bao', topic: 'wealth', tier: 'deep', question: 'Will my side project take off?', digitalContentConsent: true } });

  it('switch on only after the email is verified, then read for free and open the console', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'super@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true } });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    // Typing the address is not enough.
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth })).json()).toMatchObject({ role: 'user', super: false });
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: auth })).statusCode).toBe(403);

    const { devOutbox } = await import('../src/lib/mailer.js');
    const token = devOutbox.filter((m) => m.to === 'super@test.dev').at(-1)!.text.match(/token=([\w-]+)/)![1];
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } });
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth })).json()).toMatchObject({ role: 'admin', super: true });
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: auth })).statusCode).toBe(200);

    const res = (await reading(auth)).json();
    expect(res.payment.type).toBe('none');
    expect(res.reading.price).toBe(0);
    const order = (await pool.query('SELECT provider, amount, status FROM orders WHERE id=$1', [res.reading.orderId])).rows[0];
    expect(order).toEqual({ provider: 'comp', amount: 0, status: 'paid' });
    for (let i = 0; i < 50; i++) {
      const r = (await app.inject({ method: 'GET', url: `/readings/${res.reading.id}`, headers: auth })).json().reading;
      if (r.status === 'ready') return;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error('free reading never became ready');
  });

  it('upgrades an existing verified account on its next sign-in', async () => {
    const u = await newUser(app, 'super2@test.dev');
    await pool.query("UPDATE users SET role='user' WHERE id=$1", [u.id]);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'password123' } });
    const me = (await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${login.json().token}` } })).json();
    expect(me).toMatchObject({ role: 'admin', super: true });
  });

  it('ADMIN_EMAILS also waits for a verified email', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'admin2@test.dev', password: 'password123', ageConfirmed: true, acceptTerms: true } });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    expect((await app.inject({ method: 'GET', url: '/me', headers: auth })).json()).toMatchObject({ role: 'user', super: false });
    expect((await app.inject({ method: 'GET', url: '/admin/stats', headers: auth })).statusCode).toBe(403);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin2@test.dev', password: 'password123' } });
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${login.json().token}` } })).json().role).toBe('user');
  });

  it('leaves other accounts paying', async () => {
    const u = await newUser(app);
    expect((await reading(u.auth)).json().payment.type).toBe('dev');
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
    // Backdate the memory to noon yesterday in the user's time zone (a plain "now - 1 day" fails on DST change days).
    await pool.query(`UPDATE memories SET created_at = ((date_trunc('day', now() AT TIME ZONE u.timezone) - interval '12 hours') AT TIME ZONE u.timezone)
      FROM users u WHERE u.id = memories.user_id AND memories.user_id=$1`, [u.id]);
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
