import { z } from "zod";
import { many, one, pool } from "../../db/pool.js";
import { isValidTimeZone } from "../../lib/time.js";

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const ArchiveQuery = z
  .object({
    month: z
      .string()
      .regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/)
      .optional(),
    day: Day.optional(),
    favorites: z.enum(["true", "false"]).default("false"),
    page: z.coerce.number().int().min(0).max(100000).default(0),
    hexagram: z.coerce.number().int().min(1).max(64).optional(),
  })
  .strict()
  .refine((q) => !q.day || !q.month || q.day.startsWith(q.month));
export async function archive(
  userId: string,
  timezone: string,
  query: z.infer<typeof ArchiveQuery>,
) {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const values: unknown[] = [userId, tz];
  const where = [
    "user_id=$1",
    "(created_at AT TIME ZONE $2) IS NOT NULL",
    "private_mode=false",
    "expires_at IS NULL",
    "basis_json IS NOT NULL",
  ];
  const bind = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };
  const local = "to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD')";
  if (query.favorites === "true") where.push("favorite=true");
  if (query.hexagram)
    where.push(
      `(basis_json->'primary'->>'number')::int=${bind(query.hexagram)}`,
    );
  if (query.month) where.push(`${local} LIKE ${bind(query.month + "-%")}`);
  const days = await many(
    pool,
    `SELECT ${local} AS date,count(*)::int AS count,
      (array_agg(basis_json->'primary'->>'bits' ORDER BY created_at DESC,id DESC))[1] AS bits,
      ((array_agg(basis_json->'primary'->>'number' ORDER BY created_at DESC,id DESC))[1])::int AS number
      FROM oracle_casts WHERE ${where.join(" AND ")} GROUP BY 1 ORDER BY 1`,
    values,
  );
  if (query.day) where.push(`${local}=${bind(query.day)}`);
  const totals = await one(
    pool,
    `SELECT count(*)::int AS total,count(DISTINCT basis_json->'primary'->>'number')::int AS distinct_hexagrams FROM oracle_casts WHERE ${where.join(" AND ")}`,
    values,
  );
  const limit = 24;
  const rows = await many(
    pool,
    `SELECT * FROM oracle_casts WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${query.page * limit}`,
    values,
  );
  return {
    rows,
    days,
    total: totals!.total,
    distinctHexagrams: totals!.distinct_hexagrams,
    page: query.page,
    hasMore: (query.page + 1) * limit < totals!.total,
    timezone: tz,
  };
}
