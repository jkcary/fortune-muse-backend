import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { HEXAGRAMS, interpretLines } from "../src/modules/oracle/iching.js";
import { drainDelivery } from "../src/modules/delivery/queue.js";
import { newUser, setup } from "./helpers.js";

describe("three-coin engine", () => {
  it("maps all 64 hexagrams in King Wen order", () => {
    expect(HEXAGRAMS).toHaveLength(64);
    expect(new Set(HEXAGRAMS.map((h) => h.bits)).size).toBe(64);
    expect(interpretLines([7, 7, 7, 7, 7, 7]).primary.number).toBe(1);
    expect(interpretLines([8, 8, 8, 8, 8, 8]).primary.number).toBe(2);
    expect(interpretLines([7, 8, 7, 8, 7, 8]).primary.number).toBe(63);
    expect(interpretLines([8, 7, 8, 7, 8, 7]).primary.number).toBe(64);
    expect(interpretLines([8, 7, 7, 8, 8, 8]).primary.number).toBe(46);
  });
  it("exhaustively maps 4096 combinations and flips precisely the moving lines", () => {
    for (let n = 0; n < 4096; n++) {
      const values = Array.from(
        { length: 6 },
        (_, i) => 6 + (Math.floor(n / 4 ** i) % 4),
      );
      const basis = interpretLines(values);
      expect(basis.primary.bits).toBe(
        values.map((v) => String(v % 2)).join(""),
      );
      expect(basis.moving).toEqual(
        values.flatMap((v, i) => (v === 6 || v === 9 ? [i + 1] : [])),
      );
      if (basis.moving.length)
        expect(basis.transformation!.bits).toBe(
          values
            .map((v) => (v === 6 ? "1" : v === 9 ? "0" : String(v % 2)))
            .join(""),
        );
      else expect(basis.transformation).toBeNull();
    }
    expect(interpretLines([6, 6, 6, 6, 6, 6]).transformation!.number).toBe(1);
    expect(interpretLines([9, 9, 9, 9, 9, 9]).transformation!.number).toBe(2);
    expect(() => interpretLines([7])).toThrow();
  });
});
let app: FastifyInstance;
beforeAll(async () => {
  app = await setup();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
async function cast(auth: Record<string, string> = {}, privateMode = false) {
  const id = randomUUID(),
    token = randomUUID() + randomUUID();
  const payload = {
    id,
    token,
    topic: "wealth",
    question: "What should I consider about a new project?",
    context: "I have a full time job.",
    ageConfirmed: true,
    informationConfirmed: true,
    privateMode,
  };
  const res = await app.inject({
    method: "POST",
    url: "/oracle/casts",
    headers: auth,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
  return { id, token, payload, headers: { ...auth, "x-oracle-token": token } };
}
describe("oracle experience and delivery", () => {
  it("validates stateless review requests without creating a cast", async () => {
    const before = (
      await pool.query("SELECT count(*)::int AS n FROM oracle_casts")
    ).rows[0].n;
    const payload = {
      topic: "wealth",
      language: "en-US",
      ageConfirmed: true,
      question: "How can I reflect on this project?",
      context: "My plan is not agreed yet.",
    };
    for (const patch of [
      { ageConfirmed: false },
      { question: "a" },
      { context: "x".repeat(1201) },
      { language: "xx" },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: "/oracle/review",
        payload: { ...payload, ...patch },
      });
      expect(result.statusCode).toBe(400);
    }
    const result = await app.inject({
      method: "POST",
      url: "/oracle/review",
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ fields: null, aiGenerated: false });
    const intercepted = await app.inject({
      method: "POST",
      url: "/oracle/review",
      payload: { ...payload, question: "I want to end my life" },
    });
    expect(intercepted.json().safety.kind).toBe("crisis");
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM oracle_casts")).rows[0]
        .n,
    ).toBe(before);
  });
  it("requires explicit information confirmation and saves the user's edited question and context", async () => {
    const id = randomUUID(),
      token = randomUUID() + randomUUID();
    const payload = {
      id,
      token,
      topic: "love",
      question: "My corrected question about communicating needs.",
      context:
        "Current situation: My corrected background.\nNotes: Proposed, not agreed.\nAdditional information: Confirmed by me.",
      ageConfirmed: true,
      privateMode: true,
    };
    for (const patch of [{}, { informationConfirmed: false }]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/oracle/casts",
        payload: { ...payload, ...patch },
      });
      expect(rejected.statusCode).toBe(400);
    }
    expect(
      (await pool.query("SELECT id FROM oracle_casts WHERE id=$1", [id]))
        .rowCount,
    ).toBe(0);
    const saved = await app.inject({
      method: "POST",
      url: "/oracle/casts",
      payload: { ...payload, informationConfirmed: true },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().cast).toMatchObject({
      question: payload.question,
      context: payload.context,
      rounds: [],
    });
    expect(
      (
        await pool.query(
          "SELECT information_confirmed_at FROM oracle_casts WHERE id=$1",
          [id],
        )
      ).rows[0].information_confirmed_at,
    ).not.toBeNull();
  });
  it("offers bounded, stateless guide conversations to adult guests in all four languages", async () => {
    const before = (
      await pool.query("SELECT count(*)::int AS n FROM oracle_casts")
    ).rows[0].n;
    for (const [language, expected] of [
      ["en-US", "Thank you"],
      ["en-GB", "Thank you"],
      ["zh-Hans", "谢谢"],
      ["zh-Hant", "謝謝"],
    ]) {
      const turns: { role: string; text: string }[] = [];
      for (const [index, text] of [
        "What should I consider about a new career path?",
        "I have an offer and enjoy my current team.",
        "I want room to learn.",
        "Over the next month.",
      ].entries()) {
        turns.push({ role: "user", text });
        const result = await app.inject({
          method: "POST",
          url: "/oracle/prepare",
          payload: { topic: "wealth", language, ageConfirmed: true, turns },
        });
        expect(result.statusCode, result.body).toBe(200);
        const body = result.json();
        expect(body.aiGenerated).toBe(false);
        expect(body.ready).toBe(index === 3);
        if (index === 0) expect(body.reply).toContain(expected);
        turns.push({ role: "assistant", text: body.reply });
      }
      turns.push({ role: "user", text: "One more question." });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/oracle/prepare",
            payload: { topic: "wealth", language, ageConfirmed: true, turns },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM oracle_casts")).rows[0]
        .n,
    ).toBe(before);
  });
  it("requires adult confirmation and validates guide transcripts before generation", async () => {
    const valid = {
      topic: "love",
      language: "en-US",
      ageConfirmed: true,
      turns: [{ role: "user", text: "What patterns should I notice?" }],
    };
    for (const patch of [
      { ageConfirmed: false },
      { language: "unknown" },
      { turns: [{ role: "assistant", text: "Hello" }] },
      { turns: [{ role: "user", text: "a".repeat(601) }] },
      {
        turns: [
          { role: "user", text: "A question" },
          { role: "user", text: "Another question" },
          { role: "user", text: "More" },
        ],
      },
      {
        turns: [
          { role: "user", text: "A question" },
          { role: "assistant", text: "Tell me more" },
          { role: "user", text: "a".repeat(301) },
        ],
      },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/oracle/prepare",
            payload: { ...valid, ...patch },
          })
        ).statusCode,
      ).toBe(400);
    const intercepted = await app.inject({
      method: "POST",
      url: "/oracle/prepare",
      payload: {
        ...valid,
        turns: [{ role: "user", text: "I want to end my life" }],
      },
    });
    expect(intercepted.json().safety.kind).toBe("crisis");
    expect(intercepted.json().reply).toBeUndefined();
  });
  it("requires adult consent, protects guest casts and preserves an idempotent question", async () => {
    const c = await cast();
    expect(
      (await app.inject({ method: "GET", url: "/oracle/casts/" + c.id }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/oracle/casts/" + c.id,
          headers: { "x-oracle-token": "wrong" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/oracle/casts",
          payload: c.payload,
        })
      ).json().cast.id,
    ).toBe(c.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/oracle/casts",
          payload: { ...c.payload, question: "A different question" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/oracle/casts",
          payload: { ...c.payload, id: randomUUID(), ageConfirmed: false },
        })
      ).statusCode,
    ).toBe(400);
    const exposed = (
      await app.inject({
        method: "GET",
        url: "/oracle/casts/" + c.id,
        headers: c.headers,
      })
    ).json();
    expect(JSON.stringify(exposed)).not.toContain(c.token);
    expect(exposed.cast.basis).toBeNull();
  });
  it("serializes rounds, rejects gaps and never rerolls retries", async () => {
    const c = await cast();
    const url = "/oracle/casts/" + c.id + "/rounds";
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: c.headers,
          payload: { index: 1 },
        })
      ).statusCode,
    ).toBe(409);
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: "POST",
          url,
          headers: c.headers,
          payload: { index: 0 },
        }),
      ),
    );
    expect(a.json().cast.rounds).toEqual(b.json().cast.rounds);
    expect(a.json().cast.rounds).toHaveLength(1);
    const complete = (
      await app.inject({
        method: "POST",
        url,
        headers: c.headers,
        payload: { complete: true },
      })
    ).json().cast;
    const retry = (
      await app.inject({
        method: "POST",
        url,
        headers: c.headers,
        payload: { complete: true },
      })
    ).json().cast;
    expect(retry.rounds).toEqual(complete.rounds);
    expect(retry.basis).toEqual(complete.basis);
    for (const r of retry.rounds)
      expect(r.value).toBe(r.coins.reduce((a: number, b: number) => a + b, 0));
  });
  it("isolates accounts, defaults memory off and excludes temporary readings from the journal", async () => {
    const u = await newUser(app),
      other = await newUser(app);
    const c = await cast(u.auth),
      temporary = await cast(u.auth, true);
    expect(
      (await app.inject({ method: "GET", url: "/me", headers: u.auth })).json()
        .memory_enabled,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/oracle/casts/" + c.id,
          headers: other.auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/oracle/casts/" + temporary.id,
          headers: temporary.headers,
          payload: { note: "private" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/oracle/casts/" + c.id,
          headers: c.headers,
          payload: { note: "My reflection.", favorite: true },
        })
      ).json().cast.favorite,
    ).toBe(true);
    const journal = (
      await app.inject({
        method: "GET",
        url: "/oracle/journal",
        headers: u.auth,
      })
    ).json().casts;
    expect(journal.map((r: any) => r.id)).toContain(c.id);
    expect(journal.map((r: any) => r.id)).not.toContain(temporary.id);
    const exported = (
      await app.inject({
        method: "POST",
        url: "/account/export",
        headers: u.auth,
        payload: {},
      })
    ).json();
    expect(exported.oracleReadings).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain(c.token);
  });
  it("delivers once after duplicate payments, preserves the cast and limits followups", async () => {
    const u = await newUser(app);
    const c = await cast(u.auth);
    const base = "/oracle/casts/" + c.id;
    const basis = (
      await app.inject({
        method: "POST",
        url: base + "/rounds",
        headers: c.headers,
        payload: { complete: true },
      })
    ).json().cast.basis;
    const upgrade = () =>
      app.inject({
        method: "POST",
        url: base + "/upgrade",
        headers: c.headers,
        payload: { digitalContentConsent: true },
      });
    const [first, second] = await Promise.all([upgrade(), upgrade()]);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.json().payment.orderId).toBe(first.json().payment.orderId);
    const orderId = first.json().payment.orderId;
    const confirm = () =>
      app.inject({
        method: "POST",
        url: "/payments/dev/confirm",
        headers: u.auth,
        payload: { orderId },
      });
    await Promise.all([confirm(), confirm()]);
    let result: any;
    for (let i = 0; i < 100; i++) {
      result = (
        await app.inject({ method: "GET", url: base, headers: c.headers })
      ).json().cast;
      if (result.premiumStatus === "ready") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(result.premiumStatus).toBe("ready");
    expect(result.basis).toEqual(basis);
    expect(result.premium.generator).toBe("mock");
    expect(result.premium.actionGuideVersion).toBe("crystal-1");
    expect(result.premium.action).toContain("4. Check");
    const originalInterpretation = result.premium.interpretation;
    await pool.query(
      "UPDATE oracle_casts SET premium_json=(premium_json - 'actionGuideVersion') || '{\"action\":\"Old action\"}'::jsonb WHERE id=$1",
      [c.id],
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: base + "/action-guide",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    const refined = await app.inject({
      method: "POST",
      url: base + "/action-guide",
      headers: c.headers,
      payload: {},
    });
    expect(refined.statusCode, refined.body).toBe(200);
    expect(refined.json().cast.premium.action).toContain("4. Check");
    expect(refined.json().cast.premium.interpretation).toBe(
      originalInterpretation,
    );
    expect(refined.json().cast.basis).toEqual(basis);
    const cached = await app.inject({
      method: "POST",
      url: base + "/action-guide",
      headers: c.headers,
      payload: {},
    });
    expect(cached.json().cast.premium.action).toBe(
      refined.json().cast.premium.action,
    );
    expect(
      (
        await pool.query("SELECT count(*)::int AS n FROM orders WHERE id=$1", [
          orderId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT * FROM delivery_jobs WHERE kind='oracle' AND subject_id=$1",
          [c.id],
        )
      ).rows,
    ).toHaveLength(1);
    const f = {
      id: randomUUID(),
      question: "How can I apply this to my work?",
    };
    await app.inject({
      method: "POST",
      url: base + "/followups",
      headers: c.headers,
      payload: f,
    });
    await app.inject({
      method: "POST",
      url: base + "/followups",
      headers: c.headers,
      payload: f,
    });
    await app.inject({
      method: "POST",
      url: base + "/followups",
      headers: c.headers,
      payload: { ...f, id: randomUUID() },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: base + "/followups",
          headers: c.headers,
          payload: { ...f, id: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    const { refundOrder } = await import("../src/modules/readings/service.js");
    await Promise.all([
      refundOrder(orderId, "test"),
      refundOrder(orderId, "test"),
    ]);
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [orderId]))
        .rows[0].status,
    ).toBe("refunded");
  });
  it("recovers paid work after its worker lease expires", async () => {
    const u = await newUser(app);
    const c = await cast(u.auth);
    await app.inject({
      method: "POST",
      url: "/oracle/casts/" + c.id + "/rounds",
      headers: c.headers,
      payload: { complete: true },
    });
    const order = (
      await pool.query(
        "INSERT INTO orders(user_id,provider,amount,status) VALUES($1,'dev',299,'paid') RETURNING id",
        [u.id],
      )
    ).rows[0];
    await pool.query(
      "UPDATE oracle_casts SET order_id=$2,premium_status='generating' WHERE id=$1",
      [c.id, order.id],
    );
    await pool.query(
      "INSERT INTO delivery_jobs(kind,subject_id,state,attempts,lease_until,lease_token) VALUES('oracle',$1,'running',1,now()-interval '1 second',$2)",
      [c.id, randomUUID()],
    );
    for (let i = 0; i < 30; i++) {
      await drainDelivery();
      const row = (
        await pool.query(
          "SELECT premium_status FROM oracle_casts WHERE id=$1",
          [c.id],
        )
      ).rows[0];
      if (row.premium_status === "ready") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(
      (
        await pool.query(
          "SELECT premium_status FROM oracle_casts WHERE id=$1",
          [c.id],
        )
      ).rows[0].premium_status,
    ).toBe("ready");
  });
  it("refunds the exact consumed voucher without releasing another used voucher", async () => {
    const u = await newUser(app);
    const c = await cast(u.auth);
    const inv = (
      await pool.query(
        "INSERT INTO inventory(user_id,reward_id) VALUES($1,'free-reading'),($1,'free-reading') RETURNING id",
        [u.id],
      )
    ).rows;
    await app.inject({
      method: "POST",
      url: "/oracle/casts/" + c.id + "/rounds",
      headers: c.headers,
      payload: { complete: true },
    });
    const upgraded = await app.inject({
      method: "POST",
      url: "/oracle/casts/" + c.id + "/upgrade",
      headers: c.headers,
      payload: { digitalContentConsent: true, useVoucher: true },
    });
    expect(upgraded.statusCode, upgraded.body).toBe(200);
    const orderId = upgraded.json().cast.order.id;
    const used = (
      await pool.query("SELECT voucher_inventory_id FROM orders WHERE id=$1", [
        orderId,
      ])
    ).rows[0].voucher_inventory_id;
    const other = inv.find((v) => v.id !== used).id;
    await pool.query("UPDATE inventory SET used_at=now() WHERE id=$1", [other]);
    const { refundOrder } = await import("../src/modules/readings/service.js");
    await refundOrder(orderId, "test");
    const rows = (
      await pool.query("SELECT id,used_at FROM inventory WHERE user_id=$1", [
        u.id,
      ])
    ).rows;
    expect(rows.find((v) => v.id === used).used_at).toBeNull();
    expect(rows.find((v) => v.id === other).used_at).not.toBeNull();
  });
  it("purges expired private content and keeps a detached paid receipt", async () => {
    const u = await newUser(app);
    const c = await cast(u.auth, true);
    const order = (
      await pool.query(
        "INSERT INTO orders(user_id,provider,amount,status) VALUES($1,'dev',299,'paid') RETURNING id",
        [u.id],
      )
    ).rows[0];
    await pool.query(
      "UPDATE oracle_casts SET expires_at=now()-interval '1 minute',order_id=$2,premium_status='ready' WHERE id=$1",
      [c.id, order.id],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/oracle/casts/" + c.id,
          headers: c.headers,
        })
      ).statusCode,
    ).toBe(404);
    const { purgeTemporaryReadings } = await import("../src/jobs.js");
    await purgeTemporaryReadings();
    expect(
      (await pool.query("SELECT id FROM oracle_casts WHERE id=$1", [c.id]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT id FROM orders WHERE id=$1", [order.id]))
        .rowCount,
    ).toBe(1);
  });
  it("intercepts unsafe questions before any order and restricts delivery operations to admins", async () => {
    const c = await cast();
    const unsafe = await app.inject({
      method: "POST",
      url: "/oracle/casts",
      payload: {
        ...c.payload,
        id: randomUUID(),
        question: "I want to kill myself",
      },
    });
    expect(unsafe.json().safety.kind).toBe("crisis");
    expect(unsafe.json().cast).toBeUndefined();
    const user = await newUser(app);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/oracle/admin/overview",
          headers: user.auth,
        })
      ).statusCode,
    ).toBe(403);
    const admin = await newUser(app, "admin@test.dev");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/oracle/admin/overview",
          headers: admin.auth,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("recovers dead workers immediately but leaves live advisory-lock owners alone", async () => {
    const id = randomUUID();
    const lease = randomUUID();
    const job = (
      await pool.query(
        "INSERT INTO delivery_jobs(kind,subject_id,state,lease_until,lease_token) VALUES('oracle',$1,'running',now()+interval '10 minutes',$2) RETURNING id",
        [id, lease],
      )
    ).rows[0];
    const live = await pool.connect();
    await live.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      job.id,
    ]);
    const { recoverDelivery } =
      await import("../src/modules/delivery/queue.js");
    try {
      await recoverDelivery();
      expect(
        (
          await pool.query("SELECT state FROM delivery_jobs WHERE id=$1", [
            job.id,
          ])
        ).rows[0].state,
      ).toBe("running");
    } finally {
      await live.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        job.id,
      ]);
      live.release();
    }
    await recoverDelivery();
    expect(
      (
        await pool.query("SELECT state FROM delivery_jobs WHERE id=$1", [
          job.id,
        ])
      ).rows[0].state,
    ).toBe("pending");
  });
  it("settles asynchronous refunds only after provider confirmation and exposes failures for retry", async () => {
    const u = await newUser(app);
    const c = await cast(u.auth);
    const order = (
      await pool.query(
        "INSERT INTO orders(user_id,provider,amount,status,stripe_payment_intent,provider_refund_id,refund_status) VALUES($1,'stripe',299,'refund_requested','pi_oracle_test','re_oracle_test','pending') RETURNING id",
        [u.id],
      )
    ).rows[0];
    await pool.query(
      "UPDATE oracle_casts SET order_id=$2,premium_status='refunding' WHERE id=$1",
      [c.id, order.id],
    );
    const { applyRefundStatus } =
      await import("../src/modules/readings/service.js");
    await applyRefundStatus({
      id: "re_oracle_test",
      status: "pending",
      payment_intent: "pi_oracle_test",
    });
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [order.id]))
        .rows[0].status,
    ).toBe("refund_requested");
    await applyRefundStatus({
      id: "re_oracle_test",
      status: "succeeded",
      payment_intent: "wrong_intent",
    });
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [order.id]))
        .rows[0].status,
    ).toBe("refund_requested");
    await applyRefundStatus({
      id: "re_oracle_test",
      status: "failed",
      payment_intent: "pi_oracle_test",
    });
    expect(
      (
        await pool.query(
          "SELECT state FROM delivery_jobs WHERE kind='refund' AND subject_id=$1",
          [order.id],
        )
      ).rows[0].state,
    ).toBe("failed");
    await applyRefundStatus({
      id: "re_oracle_test",
      status: "succeeded",
      payment_intent: "pi_oracle_test",
    });
    expect(
      (await pool.query("SELECT status FROM orders WHERE id=$1", [order.id]))
        .rows[0].status,
    ).toBe("refunded");
    expect(
      (
        await pool.query(
          "SELECT premium_status FROM oracle_casts WHERE id=$1",
          [c.id],
        )
      ).rows[0].premium_status,
    ).toBe("refunded");
  });
  it("persists all four language preferences and uses them for new readings without changing the cast", async () => {
    const user = await newUser(app);
    for (const language of ["en-US", "en-GB", "zh-Hans", "zh-Hant"]) {
      const saved = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: user.auth,
        payload: { language },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(
        (
          await app.inject({ method: "GET", url: "/me", headers: user.auth })
        ).json().language,
      ).toBe(language);
      const c = await cast(user.auth);
      const base = "/oracle/casts/" + c.id;
      const basis = (
        await app.inject({
          method: "POST",
          url: base + "/rounds",
          headers: c.headers,
          payload: { complete: true },
        })
      ).json().cast.basis;
      const upgraded = (
        await app.inject({
          method: "POST",
          url: base + "/upgrade",
          headers: c.headers,
          payload: { digitalContentConsent: true },
        })
      ).json();
      await app.inject({
        method: "POST",
        url: "/payments/dev/confirm",
        headers: user.auth,
        payload: { orderId: upgraded.payment.orderId },
      });
      let result: any;
      for (let n = 0; n < 100; n++) {
        result = (
          await app.inject({ method: "GET", url: base, headers: c.headers })
        ).json().cast;
        if (result.premiumStatus === "ready") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(result.premiumStatus).toBe("ready");
      expect(result.premium.language).toBe(language);
      expect(result.basis).toEqual(basis);
      if (language === "zh-Hans")
        expect(result.premium.interpretation).toContain("个性化");
      else if (language === "zh-Hant")
        expect(result.premium.interpretation).toContain("個人化");
      else
        expect(result.premium.interpretation).toContain(
          language === "en-GB" ? "personalised" : "personalized",
        );
    }
  });
});
