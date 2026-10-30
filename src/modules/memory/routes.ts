import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { asLang } from '../../lib/i18n.js';
import { MOODS } from '../profile/avatar.js';
import { buildGreeting, type MemoryRow } from './greeting.js';

export async function latestMemory(userId: string): Promise<MemoryRow | null> {
  return one<MemoryRow>(pool, 'SELECT content, mood_tag, created_at FROM memories WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
}

export default async function memoryRoutes(app: FastifyInstance) {
  // "What Master Bao remembers" — the complete list, nothing hidden.
  app.get('/memories', async (req) => {
    const me = await requireUser(req);
    const items = await many(pool, 'SELECT id, content, mood_tag, source, created_at FROM memories WHERE user_id=$1 ORDER BY created_at DESC', [me.id]);
    return { enabled: me.memory_enabled, items };
  });

  app.delete('/memories/:id', async (req) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await pool.query('DELETE FROM memories WHERE id=$1 AND user_id=$2', [id, me.id]);
    if (!r.rowCount) throw notFound('Memory not found');
    return { ok: true };
  });

  app.delete('/memories', async (req) => {
    const me = await requireUser(req);
    const r = await pool.query('DELETE FROM memories WHERE user_id=$1', [me.id]);
    return { deleted: r.rowCount };
  });

  // Today's feedback on the result page. Only written to memory when memory is on.
  app.post('/feedback', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      readingId: z.string().uuid().optional(),
      content: z.string().trim().max(500).default(''),
      mood: z.enum(MOODS).optional(),
    }).refine((b) => b.content || b.mood, 'Write something or pick a mood').parse(req.body);

    if (body.mood) await pool.query('UPDATE avatars SET mood=$2, updated_at=now() WHERE user_id=$1', [me.id, body.mood]);
    let saved = false;
    if (me.memory_enabled) {
      await pool.query('INSERT INTO memories(user_id, reading_id, content, mood_tag) VALUES ($1,$2,$3,$4)',
        [me.id, body.readingId ?? null, body.content, body.mood ?? null]);
      saved = true;
    }
    track(me.id, 'feedback', { saved });
    return { saved };
  });

  app.get('/greeting', async (req) => {
    const me = await requireUser(req);
    const { deityId } = z.object({ deityId: z.string() }).parse(req.query);
    const deity = await one(pool, 'SELECT greeting FROM deities WHERE id=$1 AND active', [deityId]);
    if (!deity) throw notFound('Deity not found');
    const memory = me.memory_enabled ? await latestMemory(me.id) : null;
    const u = await one<{ language: string }>(pool, 'SELECT language FROM users WHERE id=$1', [me.id]);
    return buildGreeting({ deityGreeting: deity.greeting, memory, tz: me.timezone, lang: asLang(u?.language) });
  });
}
