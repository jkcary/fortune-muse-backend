import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { many, one, pool, tx } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { conflict } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { localDate } from '../../lib/time.js';

interface Reward { id: string; type: string; name: string; description: string; weight: number; asset: string }

/** Published odds (plan §M6): each active reward's share of the total weight. */
export async function currentOdds() {
  const rewards = await many<Reward>(pool, 'SELECT id, type, name, description, weight, asset FROM rewards WHERE active AND weight > 0 ORDER BY weight DESC');
  const total = rewards.reduce((s, r) => s + r.weight, 0);
  return rewards.map((r) => ({ ...r, probability: total ? Math.round((r.weight / total) * 10000) / 100 : 0 }));
}

export function pickWeighted<T extends { weight: number }>(items: T[], roll = randomInt): T {
  const total = items.reduce((s, r) => s + r.weight, 0);
  let n = roll(total);
  for (const it of items) {
    if (n < it.weight) return it;
    n -= it.weight;
  }
  return items[items.length - 1];
}

export default async function drawRoutes(app: FastifyInstance) {
  app.get('/draws/odds', async () => ({ odds: await currentOdds() }));

  app.get('/draws/today', async (req) => {
    const me = await requireUser(req);
    const date = localDate(me.timezone);
    const d = await one(pool,
      `SELECT d.date, r.id, r.type, r.name, r.description, r.asset FROM daily_draws d JOIN rewards r ON r.id=d.reward_id
       WHERE d.user_id=$1 AND d.date=$2`, [me.id, date]);
    return { date, drawn: Boolean(d), reward: d ?? null, odds: await currentOdds() };
  });

  // Free, once per local day, no purchase needed and no link to spending.
  app.post('/draws/today', async (req) => {
    const me = await requireUser(req);
    const date = localDate(me.timezone);
    const odds = await currentOdds();
    const reward = pickWeighted(odds);
    const ok = await tx(async (c) => {
      const ins = await c.query('INSERT INTO daily_draws(user_id,date,reward_id) VALUES ($1,$2,$3) ON CONFLICT (user_id,date) DO NOTHING', [me.id, date, reward.id]);
      if (!ins.rowCount) return false;
      await c.query('INSERT INTO inventory(user_id,reward_id) VALUES ($1,$2)', [me.id, reward.id]);
      return true;
    });
    if (!ok) throw conflict('already_drawn', 'You already drew today. Come back tomorrow!');
    track(me.id, 'daily_draw', { reward: reward.id });
    const { weight: _w, ...pub } = reward;
    return { date, reward: pub };
  });
}
