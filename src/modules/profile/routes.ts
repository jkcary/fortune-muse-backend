import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool } from '../../db/pool.js';
import { requireUser } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { track } from '../../lib/events.js';
import { isSuper } from '../../lib/super.js';
import { isValidTimeZone } from '../../lib/time.js';
import { AVATAR_OPTIONS, MOODS, UNLOCKABLE_ACCESSORIES, UNLOCKABLE_BACKGROUNDS } from './avatar.js';

export async function loadProfile(userId: string) {
  const user = await one(pool,
    `SELECT u.id, u.email, u.email_verified, u.handle, u.role, u.country, u.language, u.gender, u.age_range, u.timezone,
            u.memory_enabled, u.rooms_enabled, u.created_at,
            json_build_object('baseId', a.base_id, 'customization', a.customization_json, 'mood', a.mood) AS avatar
     FROM users u JOIN avatars a ON a.user_id = u.id WHERE u.id=$1`, [userId]);
  const inv = await many(pool,
    `SELECT r.id, r.type, r.name, r.asset, count(*) FILTER (WHERE i.used_at IS NULL)::int AS available
     FROM inventory i JOIN rewards r ON r.id = i.reward_id WHERE i.user_id=$1 GROUP BY r.id`, [userId]);
  return {
    ...user,
    super: isSuper(user),
    inventory: inv,
    freeReadings: inv.find((i) => i.type === 'free_reading')?.available ?? 0,
  };
}

export default async function profileRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const me = await requireUser(req);
    track(me.id, 'app_open');
    return loadProfile(me.id);
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      language: z.enum(['en']).optional(),
      gender: z.enum(['female', 'male', 'nonbinary', 'prefer_not']).nullable().optional(),
      ageRange: z.enum(['18-24', '25-34', '35-44', '45-54', '55+']).nullable().optional(),
      timezone: z.string().refine(isValidTimeZone, 'Unknown time zone').optional(),
    }).parse(req.body);
    await pool.query(
      `UPDATE users SET language=COALESCE($2,language),
         gender=CASE WHEN $3::boolean THEN $4 ELSE gender END,
         age_range=CASE WHEN $5::boolean THEN $6 ELSE age_range END,
         timezone=COALESCE($7,timezone) WHERE id=$1`,
      [me.id, body.language ?? null, body.gender !== undefined, body.gender ?? null, body.ageRange !== undefined, body.ageRange ?? null, body.timezone ?? null]);
    return loadProfile(me.id);
  });

  app.get('/avatar/options', async () => ({ ...AVATAR_OPTIONS, moods: MOODS, unlockable: { accessory: UNLOCKABLE_ACCESSORIES, background: UNLOCKABLE_BACKGROUNDS } }));

  app.patch('/me/avatar', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      baseId: z.enum(AVATAR_OPTIONS.base).optional(),
      palette: z.enum(AVATAR_OPTIONS.palette).optional(),
      accessory: z.string().optional(),
      background: z.string().optional(),
      mood: z.enum(MOODS).optional(),
    }).parse(req.body);

    // Unlockable items must be in the user's inventory.
    const owned = new Set((await many(pool, 'SELECT r.asset FROM inventory i JOIN rewards r ON r.id=i.reward_id WHERE i.user_id=$1', [me.id])).map((r) => r.asset));
    if (body.accessory && !(AVATAR_OPTIONS.accessory as readonly string[]).includes(body.accessory) && !(UNLOCKABLE_ACCESSORIES.includes(body.accessory) && owned.has(body.accessory))) {
      throw badRequest('item_locked', 'That accessory is not unlocked yet.');
    }
    if (body.background && !(AVATAR_OPTIONS.background as readonly string[]).includes(body.background) && !(UNLOCKABLE_BACKGROUNDS.includes(body.background) && owned.has(body.background))) {
      throw badRequest('item_locked', 'That background is not unlocked yet.');
    }
    const cur = await one(pool, 'SELECT base_id, customization_json FROM avatars WHERE user_id=$1', [me.id]);
    const customization = {
      ...cur.customization_json,
      ...(body.palette && { palette: body.palette }),
      ...(body.accessory && { accessory: body.accessory }),
      ...(body.background && { background: body.background }),
    };
    await pool.query('UPDATE avatars SET base_id=$2, customization_json=$3, mood=COALESCE($4,mood), updated_at=now() WHERE user_id=$1',
      [me.id, body.baseId ?? cur.base_id, customization, body.mood ?? null]);
    return loadProfile(me.id);
  });

  // Turning memory off stops both reading and writing (plan §M5).
  app.patch('/settings/memory', async (req) => {
    const me = await requireUser(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await pool.query('UPDATE users SET memory_enabled=$2 WHERE id=$1', [me.id, enabled]);
    track(me.id, enabled ? 'memory_on' : 'memory_off');
    return { memoryEnabled: enabled };
  });

  app.patch('/settings/rooms', async (req) => {
    const me = await requireUser(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await pool.query('UPDATE users SET rooms_enabled=$2 WHERE id=$1', [me.id, enabled]);
    return { roomsEnabled: enabled };
  });
}
