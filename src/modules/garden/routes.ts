import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, pool, tx } from "../../db/pool.js";
import { requireUser } from "../../lib/auth.js";
import { badRequest } from "../../lib/errors.js";
import { localDate } from "../../lib/time.js";
import { DECOR, GARDEN_LEVELS, earnedDecor, lightState } from "./engine.js";
import {
  QuestionReflectionBody,
  reflectQuestion,
} from "./questionReflection.js";

async function state(userId: string, timezone: string) {
  const today = localDate(timezone);
  const progress = await one(
    pool,
    "SELECT completed,decor FROM garden_progress WHERE user_id=$1",
    [userId],
  );
  const moments = await one(
    pool,
    "SELECT count(*)::int AS count FROM garden_moments WHERE user_id=$1",
    [userId],
  );
  const moment = await one(
    pool,
    "SELECT kind FROM garden_moments WHERE user_id=$1 AND date=$2",
    [userId, today],
  );
  return {
    completed: progress?.completed ?? [],
    decor: progress?.decor ?? [],
    momentCount: moments?.count ?? 0,
    todayKind: moment?.kind ?? null,
    today,
  };
}
export default async function gardenRoutes(app: FastifyInstance) {
  app.post(
    "/garden/question-reflection",
    { config: { rateLimit: { max: 18, timeWindow: "1 hour" } } },
    async (req) => {
      const me = req.headers.authorization ? await requireUser(req) : null;
      const body = QuestionReflectionBody.parse(req.body);
      return reflectQuestion(body, me?.id ?? req.ip);
    },
  );
  app.get("/garden", async (req) => {
    const me = await requireUser(req);
    return state(me.id, me.timezone);
  });
  app.post(
    "/garden/complete",
    { config: { rateLimit: { max: 120, timeWindow: "1 hour" } } },
    async (req) => {
      const me = await requireUser(req);
      const body = z
        .object({
          level: z.number().int().min(1).max(GARDEN_LEVELS.length),
          rotations: z.array(z.number().int().min(0).max(3)).max(25),
        })
        .strict()
        .parse(req.body);
      if (!lightState(GARDEN_LEVELS[body.level - 1], body.rotations).solved)
        throw badRequest("unsolved", "Connect every star and the pearl first.");
      await tx(async (db) => {
        await db.query(
          "INSERT INTO garden_progress(user_id) VALUES($1) ON CONFLICT DO NOTHING",
          [me.id],
        );
        const row = await one(
          db,
          "SELECT completed FROM garden_progress WHERE user_id=$1 FOR UPDATE",
          [me.id],
        );
        const completed = row!.completed as number[];
        if (body.level > completed.length + 1)
          throw badRequest(
            "level_locked",
            "Complete the earlier lanterns first.",
          );
        if (!completed.includes(body.level)) {
          completed.push(body.level);
          await db.query(
            "UPDATE garden_progress SET completed=$2,updated_at=now() WHERE user_id=$1",
            [me.id, completed],
          );
        }
      });
      return state(me.id, me.timezone);
    },
  );
  app.patch("/garden/decor", async (req) => {
    const me = await requireUser(req);
    const body = z
      .object({
        decor: z.array(z.enum(DECOR.map((d) => d.id))).max(DECOR.length),
      })
      .strict()
      .parse(req.body);
    await tx(async (db) => {
      await db.query(
        "INSERT INTO garden_progress(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [me.id],
      );
      const row = await one(
        db,
        "SELECT completed FROM garden_progress WHERE user_id=$1 FOR UPDATE",
        [me.id],
      );
      const earned = earnedDecor(row!.completed).map((d) => d.id as string);
      if (body.decor.some((d) => !earned.includes(d)))
        throw badRequest(
          "decor_locked",
          "Earn this decoration by completing levels.",
        );
      await db.query(
        "UPDATE garden_progress SET decor=$2,updated_at=now() WHERE user_id=$1",
        [me.id, [...new Set(body.decor)]],
      );
    });
    return state(me.id, me.timezone);
  });
  app.post("/garden/moment", async (req) => {
    const me = await requireUser(req);
    const body = z
      .object({ kind: z.enum(["joy", "discovery", "question"]) })
      .strict()
      .parse(req.body);
    await pool.query(
      "INSERT INTO garden_moments(user_id,date,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [me.id, localDate(me.timezone), body.kind],
    );
    return state(me.id, me.timezone);
  });
}
