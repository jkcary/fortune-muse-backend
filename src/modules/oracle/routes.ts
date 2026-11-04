import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { many, one, pool, tx, type Db } from "../../db/pool.js";
import { requireUser, requireVerified, requireAdmin } from "../../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { sha256 } from "../../lib/security.js";
import { isSuper } from "../../lib/super.js";
import { track } from "../../lib/events.js";
import { enqueue, kickDelivery } from "../delivery/queue.js";
import { getStripe } from "../payments/stripe.js";
import { HELP_RESOURCES, screenQuestion } from "../safety/safety.js";
import {
  HEXAGRAMS,
  METHOD,
  CONTENT_VERSION,
  interpretLines,
  tossCoins,
} from "./iching.js";

import type { OracleCast, OracleJourney } from "./contracts.js";
import { Language } from "../../lib/i18n.js";
import { createGlimpse } from "./glimpse.js";
import { createDoorExercise } from "./doorExercise.js";
import { archive, ArchiveQuery } from "./archive.js";
import { PreparationBody, prepareReading } from "./preparation.js";
import { ReviewBody, organizeReview } from "./review.js";
import { refineActionGuide } from "./actionGuide.js";
const PRICE = 299;
const Id = z.object({ id: z.string().uuid() });
async function identity(req: FastifyRequest) {
  return req.headers.authorization ? requireUser(req) : null;
}
async function access(req: FastifyRequest, db: Db = pool, lock = false) {
  const { id } = Id.parse(req.params);
  const me = await identity(req);
  const row = await one(
    db,
    `SELECT * FROM oracle_casts WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  const token = req.headers["x-oracle-token"];
  const allowed =
    row &&
    (row.user_id
      ? row.user_id === me?.id
      : typeof token === "string" && sha256(token) === row.token_hash);
  if (
    !allowed ||
    (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
  )
    throw notFound("Reading not found or expired.");
  return { row, me };
}
function view(row: any, order?: any, followups: any[] = []): OracleCast {
  return {
    id: row.id,
    version: 2,
    topic: row.topic,
    question: row.question,
    context: row.context,
    privateMode: row.private_mode,
    rounds: row.rounds,
    basis: row.basis_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    saved: Boolean(row.user_id) && !row.private_mode,
    favorite: row.favorite,
    note: row.note,
    glimpse: row.glimpse_json ?? null,
    doorExerciseContent: row.door_exercise_json ?? null,
    journey: row.journey_json ?? null,
    premiumStatus: row.premium_status,
    premium: row.premium_status === "ready" ? row.premium_json : null,
    order: order
      ? {
          id: order.id,
          status: order.status,
          provider: order.provider,
          amount: order.amount,
          tax: order.tax,
        }
      : null,
    followups: followups.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      status: f.status,
    })),
  };
}
async function loaded(row: any) {
  const [order, followups] = await Promise.all([
    row.order_id
      ? one(pool, "SELECT * FROM orders WHERE id=$1", [row.order_id])
      : null,
    many(
      pool,
      "SELECT * FROM oracle_followups WHERE cast_id=$1 ORDER BY created_at",
      [row.id],
    ),
  ]);
  return { cast: view(row, order, followups) };
}
function safety(text: string) {
  const verdict = screenQuestion(text);
  return verdict.ok
    ? null
    : { kind: verdict.kind, ...HELP_RESOURCES[verdict.kind] };
}

export default async function oracleRoutes(app: FastifyInstance) {
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });
  app.post(
    "/oracle/review",
    { config: { rateLimit: { max: 24, timeWindow: "1 hour" } } },
    async (req) => {
      const body = ReviewBody.parse(req.body);
      const check = safety(body.question + "\n" + body.context);
      if (check) return { safety: check };
      return organizeReview(body);
    },
  );
  app.post(
    "/oracle/prepare",
    { config: { rateLimit: { max: 24, timeWindow: "1 hour" } } },
    async (req) => {
      const body = PreparationBody.parse(req.body);
      const check = safety(
        body.turns.map((turn) => turn.text).join("\n") + "\n" + body.context,
      );
      if (check) return { safety: check };
      return prepareReading(body);
    },
  );
  app.get("/oracle/admin/overview", async (req) => {
    await requireAdmin(req);
    const jobs = await many(
      pool,
      `SELECT id,kind,subject_id,state,attempts,last_error,created_at,updated_at FROM delivery_jobs ORDER BY created_at DESC LIMIT 100`,
    );
    const summary = await many(
      pool,
      `SELECT state,count(*)::int AS count FROM delivery_jobs GROUP BY state`,
    );
    return { jobs, summary, contentVersion: CONTENT_VERSION };
  });
  app.post("/oracle/admin/jobs/:id/retry", async (req) => {
    const admin = await requireAdmin(req);
    const { id } = Id.parse(req.params);
    await tx(async (c) => {
      const job = await one(
        c,
        `SELECT * FROM delivery_jobs WHERE id=$1 AND state='failed' FOR UPDATE`,
        [id],
      );
      if (!job) throw notFound("Failed job not found");
      if (job.kind === "oracle" || job.kind === "legacy") {
        const table = job.kind === "oracle" ? "oracle_casts" : "readings";
        const statusColumn =
          job.kind === "oracle" ? "premium_status" : "status";
        const r = await one(
          c,
          `SELECT r.*,o.status AS payment_status FROM ${table} r JOIN orders o ON o.id=r.order_id WHERE r.id=$1`,
          [job.subject_id],
        );
        if (!r || r.payment_status !== "paid" || r[statusColumn] === "ready")
          throw badRequest(
            "not_retryable",
            "Only paid, undelivered readings can be retried.",
          );
        await c.query(`UPDATE ${table} SET ${statusColumn}=$2 WHERE id=$1`, [
          job.subject_id,
          job.kind === "oracle" ? "queued" : "generating",
        ]);
      }
      await c.query(
        `UPDATE delivery_jobs SET state='pending',attempts=0,last_error=NULL,available_at=now(),lease_until=NULL WHERE id=$1`,
        [id],
      );
      await c.query(
        `INSERT INTO admin_audit(admin_id,action,details) VALUES($1,'delivery.retry',$2)`,
        [admin.id, { jobId: id, kind: job.kind }],
      );
    });
    kickDelivery();
    return { ok: true };
  });
  app.get("/oracle/catalog", async () => ({
    brand: "ORACLE ONE",
    price: PRICE,
    currency: "usd",
    followups: 2,
    method: METHOD,
    hexagrams: HEXAGRAMS,
    contentStatus:
      "Original editorial reflections. Cultural review required before public launch.",
  }));
  app.post(
    "/oracle/casts",
    { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } },
    async (req) => {
      const body = z
        .object({
          id: z.string().uuid(),
          token: z.string().min(32).max(128),
          topic: z.enum(["wealth", "love"]),
          question: z.string().trim().min(3).max(600),
          context: z.string().trim().max(1200).default(""),
          ageConfirmed: z.literal(true),
          informationConfirmed: z.literal(true),
          privateMode: z.boolean().default(false),
        })
        .parse(req.body);
      const check = safety(body.question + "\n" + body.context);
      if (check) return { safety: check };
      const me = await identity(req);
      await pool.query(
        `INSERT INTO oracle_casts(id,token_hash,user_id,topic,question,context,private_mode,expires_at,information_confirmed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $3::uuid IS NOT NULL AND NOT $7 THEN NULL ELSE now()+interval '24 hours' END,now())
      ON CONFLICT(id) DO NOTHING`,
        [
          body.id,
          sha256(body.token),
          me?.id ?? null,
          body.topic,
          body.question,
          body.context,
          body.privateMode,
        ],
      );
      const row = await one(pool, "SELECT * FROM oracle_casts WHERE id=$1", [
        body.id,
      ]);
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
        throw conflict(
          "reading_expired",
          "This temporary reading has expired. Begin a new reading.",
        );
      if (
        row.token_hash !== sha256(body.token) ||
        (row.user_id && row.user_id !== me?.id)
      )
        throw conflict("request_conflict", "Please begin a new reading.");
      if (
        row.question !== body.question ||
        row.context !== body.context ||
        row.topic !== body.topic ||
        row.private_mode !== body.privateMode
      )
        throw conflict(
          "immutable_question",
          "This reading already has a question. Start a new reading to change it.",
        );
      return loaded(row);
    },
  );
  app.get("/oracle/casts/:id", async (req) => loaded((await access(req)).row));
  app.post(
    "/oracle/casts/:id/glimpse",
    { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } },
    async (req) => {
      const { language } = z
        .object({ language: Language.default("en-US") })
        .parse(req.body);
      const { row } = await access(req);
      if (!row.basis_json)
        throw badRequest("cast_incomplete", "Complete all six lines first.");
      const result = await createGlimpse(row, language);
      return { ...(await loaded(result.row)), unavailable: result.unavailable };
    },
  );
  app.post("/oracle/casts/:id/door-exercise", {config:{rateLimit:{max:24,timeWindow:"1 hour"}}}, async req=>{
    const body=z.object({language:Language.default("en-US"),selection:z.object({priority:z.string().regex(/^p[1-4]$/),cost:z.string().regex(/^c[1-4]$/)}).strict().optional()}).strict().parse(req.body);
    const {row}=await access(req);
    return loaded(await createDoorExercise(row,body.language,body.selection));
  });
  app.patch(
    "/oracle/casts/:id/journey",
    { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } },
    async (req) => {
      const Status = z.enum(["planned", "tried", "waiting", "paused"]);
      const body = z
        .object({
          selectedDoor: z.enum(["a", "b"]).nullable().optional(),
          doorExercise: z.union([
            z.object({door:z.enum(["a","b"]),priority:z.enum(["security","growth","connection","space"]),cost:z.enum(["time","uncertainty","conversation"])}).strict(),
            z.object({version:z.literal(1),door:z.enum(["a","b"]),priority:z.string().regex(/^p[1-4]$/),cost:z.string().regex(/^c[1-4]$/)}).strict(),
          ]).optional(),
          feedback: z.enum(["fits", "misses"]).nullable().optional(),
          action: z.string().trim().min(3).max(400).optional(),
          actionNotes: z.string().max(6000).optional(),
          followUpEnabled: z.boolean().optional(),
          status: Status.optional(),
          update: z
            .object({
              id: z.string().uuid(),
              text: z.string().trim().max(600).default(""),
              status: Status,
              kind: z.enum(["status", "changed"]).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body);
      const result = await tx(async (c) => {
        const { row, me } = await access(req, c, true);
        if (!row.basis_json)
          throw badRequest("cast_incomplete", "Complete all six lines first.");
        if (body.followUpEnabled && (!me || row.private_mode))
          throw badRequest(
            "saving_required",
            "Sign in and use a non-temporary reading to keep following this story.",
          );
        const journey: OracleJourney = row.journey_json ?? {
          selectedDoor: null,
          feedback: null,
          action: "",
          followUpEnabled: false,
          status: "planned",
          updates: [],
        };
        if (journey.selectedDoor && body.selectedDoor !== undefined && body.selectedDoor !== journey.selectedDoor)
          throw conflict("door_locked", "This reading already has a chosen path.");
        if (body.doorExercise && journey.selectedDoor && body.doorExercise.door !== journey.selectedDoor)
          throw conflict("door_locked", "Only the chosen path can be explored.");
        if (body.selectedDoor && body.doorExercise && body.doorExercise.door !== body.selectedDoor)
          throw badRequest("door_mismatch", "Keep the exercise with the chosen path.");
        if (body.selectedDoor !== undefined)
          journey.selectedDoor = body.selectedDoor;
        if (body.doorExercise !== undefined) {
          const exercise=body.doorExercise;
          if ("version" in exercise) {
            const content=row.door_exercise_json;
            if (!content || content.door!==exercise.door || !content.priorities.some((p:any)=>p.id===exercise.priority) || !content.costs.some((c:any)=>c.id===exercise.cost))
              throw badRequest("invalid_choice", "Choose from your saved personal options.");
          } else if(row.door_exercise_json) throw conflict("exercise_updated", "Reload your personal options before saving.");
          journey.doorExercise=exercise;
        }
        if (body.actionNotes !== undefined) journey.actionNotes = body.actionNotes;
        if (body.feedback !== undefined) journey.feedback = body.feedback;
        if (body.action !== undefined) journey.action = body.action;
        if (body.followUpEnabled !== undefined)
          journey.followUpEnabled = body.followUpEnabled;
        // An old update replay must not overwrite a newer chapter's status.
        if (body.status !== undefined && !body.update)
          journey.status = body.status;
        let appended = false;
        if (body.update) {
          if (!journey.action)
            throw badRequest(
              "action_required",
              "Choose a small action before adding an update.",
            );
          if (body.status !== undefined && body.status !== body.update.status)
            throw badRequest(
              "status_conflict",
              "Use the same status for this update.",
            );
          if (
            body.update.kind === "changed" &&
            body.update.status !== "waiting"
          )
            throw badRequest(
              "status_conflict",
              "A changed situation remains open for exploration.",
            );
          const previous = journey.updates.find(
            (u) => u.id === body.update!.id,
          );
          if (
            previous &&
            (previous.text !== body.update.text ||
              previous.status !== body.update.status ||
              (previous.kind ?? "status") !== (body.update.kind ?? "status"))
          )
            throw conflict(
              "update_conflict",
              "This update is already saved. Start a new update to change it.",
            );
          if (!previous) {
            if (journey.updates.length >= 20)
              throw badRequest(
                "story_full",
                "This story has reached its 20-update limit. You can keep using your journal notes.",
              );
            journey.updates.push({
              ...body.update,
              createdAt: new Date().toISOString(),
            });
            journey.status = body.update.status;
            appended = true;
          }
        }
        if (journey.status === "paused") journey.followUpEnabled = false;
        if (journey.followUpEnabled && !journey.action)
          throw badRequest(
            "action_required",
            "Choose a small action before following this story.",
          );
        const updated = await one(
          c,
          `UPDATE oracle_casts SET journey_json=$2,
          user_id=CASE WHEN $3 THEN $4::uuid ELSE user_id END,
          expires_at=CASE WHEN $3 THEN NULL ELSE expires_at END,updated_at=now() WHERE id=$1 RETURNING *`,
          [row.id, journey, body.followUpEnabled === true, me?.id ?? null],
        );
        return { row: updated, appended, userId: me?.id ?? null };
      });
      if (result.appended)
        track(result.userId, "oracle_story_updated", {
          status: body.update!.status,
          kind: body.update!.kind ?? "status",
        });
      return loaded(result.row);
    },
  );
  app.post(
    "/oracle/casts/:id/action-guide",
    { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } },
    async (req) => {
      const { row, me } = await access(req);
      if (
        !row.basis_json ||
        row.premium_status !== "ready" ||
        !row.premium_json
      )
        throw badRequest(
          "reading_not_ready",
          "A complete personal interpretation is needed before refining its action guide.",
        );
      const preference = me
        ? await one(pool, "SELECT language FROM users WHERE id=$1", [me.id])
        : null;
      return loaded(await refineActionGuide(row, preference?.language));
    },
  );
  app.post("/oracle/casts/:id/rounds", async (req) => {
    const { index, complete } = z
      .object({
        index: z.number().int().min(0).max(5).optional(),
        complete: z.boolean().default(false),
      })
      .parse(req.body);
    const row = await tx(async (c) => {
      const { row } = await access(req, c, true);
      if (index === undefined && !complete) throw badRequest("round_required");
      const rounds = [...row.rounds];
      if (!complete && index! < rounds.length) return row; // retry an already-recorded round
      if (!complete && index !== rounds.length)
        throw conflict("round_order", "Resume with the next uncast line.");
      const target = complete ? 6 : rounds.length + 1;
      while (rounds.length < target) rounds.push(tossCoins());
      const basis =
        rounds.length === 6 ? interpretLines(rounds.map((r) => r.value)) : null;
      return one(
        c,
        `UPDATE oracle_casts SET rounds=$2,basis_json=$3,updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id, JSON.stringify(rounds), basis],
      );
    });
    return loaded(row);
  });
  app.patch("/oracle/casts/:id", async (req) => {
    const me = await requireUser(req);
    const body = z
      .object({
        note: z.string().max(2000).optional(),
        favorite: z.boolean().optional(),
        save: z.boolean().optional(),
      })
      .parse(req.body);
    const row = await tx(async (c) => {
      const { row } = await access(req, c, true);
      if (row.private_mode)
        throw badRequest(
          "private_reading",
          "Temporary readings cannot be saved. Start a new reading with saving enabled.",
        );
      return one(
        c,
        `UPDATE oracle_casts SET user_id=$2,expires_at=NULL,note=COALESCE($3,note),favorite=COALESCE($4,favorite),updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id, me.id, body.note ?? null, body.favorite ?? null],
      );
    });
    return loaded(row);
  });
  app.delete("/oracle/casts/:id", async (req) => {
    await tx(async (c) => {
      const { row } = await access(req, c, true);
      const order = row.order_id
        ? await one(c, "SELECT status FROM orders WHERE id=$1", [row.order_id])
        : null;
      if (
        ["queued", "generating", "refunding"].includes(row.premium_status) ||
        order?.status === "pending"
      )
        throw conflict(
          "delivery_in_progress",
          "Finish or cancel checkout before deleting this reading.",
        );
      await c.query(
        `DELETE FROM delivery_jobs WHERE (kind='oracle' AND subject_id=$1) OR (kind='followup' AND subject_id IN (SELECT id FROM oracle_followups WHERE cast_id=$1))`,
        [row.id],
      );
      await c.query("DELETE FROM oracle_casts WHERE id=$1", [row.id]);
    });
    return { deleted: true };
  });
  app.get("/oracle/journal", async (req) => {
    const me = await requireUser(req);
    const rows = await many(
      pool,
      `SELECT * FROM oracle_casts WHERE user_id=$1 AND private_mode=false AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC LIMIT 100`,
      [me.id],
    );
    const preference = await one(
      pool,
      "SELECT current_cast_id FROM oracle_return_preferences WHERE user_id=$1",
      [me.id],
    );
    return {
      casts: rows.map((r) => view(r)),
      returnPreferences: { currentCastId: preference?.current_cast_id ?? null },
    };
  });
  app.get("/oracle/archive",async req=>{
    const me=await requireUser(req);
    const {rows,...result}=await archive(me.id,me.timezone,ArchiveQuery.parse(req.query));
    return {...result,casts:rows.map(row=>view(row))};
  });
  app.patch("/oracle/return-preferences", async (req) => {
    const me = await requireUser(req);
    const { currentCastId } = z
      .object({ currentCastId: z.string().uuid().nullable() })
      .strict()
      .parse(req.body);
    return tx(async (c) => {
      if (currentCastId) {
        const story = await one(
          c,
          `SELECT id FROM oracle_casts WHERE id=$1 AND user_id=$2
          AND private_mode=false AND expires_at IS NULL AND basis_json IS NOT NULL
          AND length(trim(journey_json->>'action'))>0
          AND journey_json->>'followUpEnabled'='true'
          AND journey_json->>'status'<>'paused' FOR SHARE`,
          [currentCastId, me.id],
        );
        if (!story) throw notFound("An active saved story is needed.");
      }
      await c.query(
        `INSERT INTO oracle_return_preferences(user_id,current_cast_id) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET current_cast_id=$2,updated_at=now()`,
        [me.id, currentCastId],
      );
      return { currentCastId };
    });
  });
  app.post("/oracle/casts/:id/upgrade", async (req) => {
    const me = await requireVerified(req);
    const body = z
      .object({
        digitalContentConsent: z.literal(true),
        useVoucher: z.boolean().default(false),
      })
      .parse(req.body);
    const result = await tx(async (c) => {
      const { row } = await access(req, c, true);
      if (!row.basis_json)
        throw badRequest("cast_incomplete", "Complete all six lines first.");
      if (row.order_id) {
        const existing = await one(c, "SELECT * FROM orders WHERE id=$1", [
          row.order_id,
        ]);
        if (
          existing &&
          !["canceled", "failed", "refunded"].includes(existing.status)
        )
          return { row, order: existing };
      }
      const u = await one(
        c,
        "SELECT email,email_verified FROM users WHERE id=$1",
        [me.id],
      );
      const comp = isSuper(u!);
      let voucherId: string | null = null;
      if (body.useVoucher && !comp) {
        const v = await one(
          c,
          `UPDATE inventory SET used_at=now() WHERE id=(SELECT id FROM inventory WHERE user_id=$1 AND reward_id='free-reading' AND used_at IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`,
          [me.id],
        );
        if (!v)
          throw conflict("no_voucher", "No free reading voucher is available.");
        voucherId = v.id;
      }
      const provider = comp
        ? "comp"
        : voucherId
          ? "voucher"
          : config.devPayments
            ? "dev"
            : "stripe";
      const paid = comp || Boolean(voucherId);
      const order = await one(
        c,
        `INSERT INTO orders(user_id,provider,amount,status,voucher_inventory_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [
          me.id,
          provider,
          paid ? 0 : PRICE,
          paid ? "paid" : "pending",
          voucherId,
        ],
      );
      await c.query(
        `INSERT INTO consents(user_id,type,version) VALUES($1,'digital_content','oracle-2026-11-02') ON CONFLICT DO NOTHING`,
        [me.id],
      );
      const updated = await one(
        c,
        `UPDATE oracle_casts SET user_id=$2,order_id=$3,premium_status=$4,premium_json=NULL,
        expires_at=CASE WHEN private_mode THEN now()+interval '24 hours' ELSE NULL END WHERE id=$1 RETURNING *`,
        [row.id, me.id, order.id, paid ? "queued" : "awaiting_payment"],
      );
      await c.query(
        `DELETE FROM delivery_jobs WHERE kind='oracle' AND subject_id=$1 AND state IN ('done','failed')`,
        [row.id],
      );
      if (paid) {
        await enqueue("oracle", row.id, c);
      }
      return { row: updated, order };
    });
    const { row, order } = result;
    if (order.status !== "pending") {
      kickDelivery();
      return { cast: view(row, order), payment: { type: "none" } };
    }
    if (order.provider === "dev")
      return {
        cast: view(row, order),
        payment: { type: "dev", orderId: order.id, amount: order.amount },
      };
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: (await one(
          pool,
          "SELECT email FROM users WHERE id=$1",
          [me.id],
        ))!.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: order.amount,
              tax_behavior: "exclusive",
              product_data: {
                name: "ORACLE ONE · Deep Reading",
                description:
                  "Personalized I Ching interpretation and two follow-up questions. Entertainment and reflection.",
              },
            },
          },
        ],
        automatic_tax: { enabled: true },
        metadata: { orderId: order.id, castId: row.id },
        payment_intent_data: { metadata: { orderId: order.id } },
        success_url: `${config.APP_URL}/oracle/${row.id}?paid=1`,
        cancel_url: `${config.APP_URL}/oracle/${row.id}?canceled=1`,
      },
      { idempotencyKey: `oracle-checkout-${order.id}` },
    );
    await pool.query("UPDATE orders SET provider_session_id=$2 WHERE id=$1", [
      order.id,
      session.id,
    ]);
    return {
      cast: view(row, order),
      payment: { type: "stripe", checkoutUrl: session.url },
    };
  });
  app.post("/oracle/casts/:id/cancel-checkout", async (req) => {
    await requireUser(req);
    const { row } = await access(req);
    const order = row.order_id
      ? await one(pool, "SELECT * FROM orders WHERE id=$1", [row.order_id])
      : null;
    if (
      order?.status === "pending" &&
      order.provider === "stripe" &&
      order.provider_session_id
    ) {
      const session = await getStripe().checkout.sessions.retrieve(
        order.provider_session_id,
      );
      if (session.payment_status === "paid" || session.status === "complete")
        throw conflict(
          "payment_processing",
          "Payment is being confirmed. Please check again shortly.",
        );
      if (session.status === "open")
        await getStripe().checkout.sessions.expire(order.provider_session_id);
    }
    await tx(async (c) => {
      const canceled = order
        ? await one(
            c,
            `UPDATE orders SET status='canceled',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id`,
            [order.id],
          )
        : null;
      if (canceled)
        await c.query(
          `UPDATE oracle_casts SET premium_status='free' WHERE id=$1 AND premium_status='awaiting_payment'`,
          [row.id],
        );
    });
    return loaded((await access(req)).row);
  });
  app.post(
    "/oracle/casts/:id/followups",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req) => {
      await requireVerified(req);
      const body = z
        .object({
          id: z.string().uuid(),
          question: z.string().trim().min(3).max(600),
        })
        .parse(req.body);
      const check = safety(body.question);
      if (check) return { safety: check };
      const row = await tx(async (c) => {
        const { row } = await access(req, c, true);
        if (row.premium_status !== "ready")
          throw badRequest(
            "reading_required",
            "A completed deep reading is required.",
          );
        const existing = await one(
          c,
          "SELECT * FROM oracle_followups WHERE id=$1",
          [body.id],
        );
        if (existing) {
          if (
            existing.cast_id !== row.id ||
            existing.question !== body.question
          )
            throw conflict("request_conflict");
          return row;
        }
        if (
          Number(
            (await one(
              c,
              "SELECT count(*) AS n FROM oracle_followups WHERE cast_id=$1",
              [row.id],
            ))!.n,
          ) >= 2
        )
          throw conflict(
            "followup_limit",
            "Your two included follow-up questions have been used.",
          );
        await c.query(
          "INSERT INTO oracle_followups(id,cast_id,question) VALUES($1,$2,$3)",
          [body.id, row.id, body.question],
        );
        await enqueue("followup", body.id, c);
        return row;
      });
      kickDelivery();
      return loaded(row);
    },
  );
}
