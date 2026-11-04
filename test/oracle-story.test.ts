import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("../src/modules/ai/llm.js", () => ({ generateJson: vi.fn() }));
import { generateJson } from "../src/modules/ai/llm.js";
import { pool } from "../src/db/pool.js";
import { exportUserData } from "../src/modules/account/routes.js";
import { newUser, setup } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await setup();
});
beforeEach(() => {
  vi.mocked(generateJson).mockReset();
  vi.mocked(generateJson).mockResolvedValue(null);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
const ai = {
  reflection:
    "You are comparing higher pay with more learning. It may help to check what each role actually offers before choosing.",
  question: "If the pay were equal, what would you want to learn?",
  doors: [
    {
      title: "Understand the resources",
      perspective:
        "Explore what the higher salary would make possible in your stated choice.",
      tradeoff: "Pay alone will not describe the everyday work.",
      experiment:
        "Write one question about the first three months and ask the hiring contact.",
    },
    {
      title: "Test the learning",
      perspective:
        "Explore what the proposed learning opportunity means in practice.",
      tradeoff:
        "Learning claims may remain uncertain until you ask for specifics.",
      experiment:
        "Spend ten minutes listing two skills you want to practise in the role.",
    },
  ],
};
async function cast(
  auth: Record<string, string> = {},
  privateMode = false,
  finish = true,
) {
  const id = randomUUID(),
    token = randomUUID() + randomUUID();
  const headers = { ...auth, "x-oracle-token": token };
  const created = await app.inject({
    method: "POST",
    url: "/oracle/casts",
    headers,
    payload: {
      id,
      token,
      topic: "wealth",
      question:
        "I have two job offers: higher pay or more learning. How can I compare them?",
      context: "Neither offer has been accepted.",
      ageConfirmed: true,
      informationConfirmed: true,
      privateMode,
    },
  });
  expect(created.statusCode, created.body).toBe(200);
  if (finish)
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/oracle/casts/${id}/rounds`,
          headers,
          payload: { complete: true },
        })
      ).statusCode,
    ).toBe(200);
  return { id, headers };
}
const glimpse = (c: Awaited<ReturnType<typeof cast>>, language = "en-US") =>
  app.inject({
    method: "POST",
    url: `/oracle/casts/${c.id}/glimpse`,
    headers: c.headers,
    payload: { language },
  });
const journey = (c: Awaited<ReturnType<typeof cast>>, payload: object) =>
  app.inject({
    method: "PATCH",
    url: `/oracle/casts/${c.id}/journey`,
    headers: c.headers,
    payload,
  });
describe("free discovery and returning stories", () => {
  it("locks the first committed door under competing requests and permits an identical retry", async () => {
    const c = await cast();
    const responses = await Promise.all([journey(c, {selectedDoor: "a"}),journey(c, {selectedDoor: "b"})]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const chosen=responses.find(r=>r.statusCode===200)!.json().cast.journey.selectedDoor;
    const other=chosen==="a"?"b":"a";
    expect((await journey(c,{selectedDoor: chosen})).statusCode).toBe(200);
    expect((await journey(c,{selectedDoor: null})).json().error).toBe("door_locked");
    expect((await journey(c,{selectedDoor: other})).statusCode).toBe(409);
    expect((await journey(c,{doorExercise:{door:other,priority:"growth",cost:"time"}})).statusCode).toBe(409);
    const read=(await app.inject({method:"GET",url:`/oracle/casts/${c.id}`,headers:c.headers})).json().cast;
    expect(read.journey.selectedDoor).toBe(chosen);
    expect(read.saved).toBe(false);
    expect((await journey(c,{action:"Write one question",feedback:"misses"})).statusCode).toBe(200);
    expect((await journey(c,{})).json().cast.journey.selectedDoor).toBe(chosen);
  });
  it("keeps an account's chosen door across reads and rejects a mismatched combined exercise",async()=>{
    const user=await newUser(app), c=await cast(user.auth);
    expect((await journey(c,{selectedDoor:"a",doorExercise:{door:"b",priority:"space",cost:"time"}})).statusCode).toBe(400);
    expect((await journey(c,{selectedDoor:"b"})).statusCode).toBe(200);
    const read=(await app.inject({method:"GET",url:`/oracle/casts/${c.id}`,headers:user.auth})).json().cast;
    expect(read.journey.selectedDoor).toBe("b");
    expect((await journey(c,{selectedDoor:"a"})).statusCode).toBe(409);
  });
  it("saves text-free changed updates exactly once and preserves the fixed reading", async () => {
    const user = await newUser(app);
    const c = await cast(user.auth);
    await journey(c, {
      action: "Ask for the promotion criteria",
      followUpEnabled: true,
    });
    const before = (
      await pool.query(
        "SELECT rounds,basis_json,premium_status FROM oracle_casts WHERE id=$1",
        [c.id],
      )
    ).rows[0];
    const update = { id: randomUUID(), status: "waiting", kind: "changed" };
    const responses = await Promise.all([
      journey(c, { update }),
      journey(c, { update }),
    ]);
    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().cast.journey.updates).toHaveLength(1);
      expect(response.json().cast.journey.updates[0]).toMatchObject({
        ...update,
        text: "",
      });
    }
    expect(
      (
        await pool.query(
          "SELECT rounds,basis_json,premium_status FROM oracle_casts WHERE id=$1",
          [c.id],
        )
      ).rows[0],
    ).toEqual(before);
    await vi.waitFor(async () => {
      const events = (
        await pool.query(
          "SELECT props FROM events WHERE user_id=$1 AND name='oracle_story_updated'",
          [user.id],
        )
      ).rows;
      expect(events).toEqual([
        { props: { status: "waiting", kind: "changed" } },
      ]);
    });
    expect(
      (await journey(c, { update: { ...update, kind: "status" } })).statusCode,
    ).toBe(409);
    expect(
      (
        await journey(c, {
          update: { id: randomUUID(), status: "tried", kind: "changed" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await journey(c, { update: { id: randomUUID() } })).statusCode,
    ).toBe(400);
    expect(
      (
        await journey(c, {
          update: { id: randomUUID(), status: "tried", text: "x".repeat(601) },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("does not regress status on old retries and pauses return invitations explicitly", async () => {
    const user = await newUser(app);
    const c = await cast(user.auth);
    await journey(c, {
      action: "Write down one question",
      followUpEnabled: true,
    });
    const first = { id: randomUUID(), status: "tried", text: "" };
    await journey(c, { update: first });
    const paused = await journey(c, {
      update: { id: randomUUID(), status: "paused", text: "" },
    });
    expect(paused.json().cast.journey).toMatchObject({
      status: "paused",
      followUpEnabled: false,
    });
    const replay = await journey(c, { update: first, status: "tried" });
    expect(replay.json().cast.journey).toMatchObject({
      status: "paused",
      followUpEnabled: false,
    });
    expect(replay.json().cast.journey.updates).toHaveLength(2);
    expect(
      (
        await journey(c, {
          status: "tried",
          update: { id: randomUUID(), status: "waiting" },
        })
      ).statusCode,
    ).toBe(400);
    const resumed = await journey(c, {
      followUpEnabled: true,
      status: "planned",
    });
    expect(resumed.json().cast.journey).toMatchObject({
      status: "planned",
      followUpEnabled: true,
    });
  });
  it("requires an action and keeps the update limit idempotent", async () => {
    const c = await cast();
    expect(
      (await journey(c, { update: { id: randomUUID(), status: "tried" } }))
        .statusCode,
    ).toBe(400);
    await journey(c, { action: "Try one small step" });
    const updates = Array.from({ length: 20 }, () => ({
      id: randomUUID(),
      status: "waiting",
      text: "",
      createdAt: new Date().toISOString(),
    }));
    await pool.query(
      "UPDATE oracle_casts SET journey_json=jsonb_set(journey_json,'{updates}',$2::jsonb) WHERE id=$1",
      [c.id, JSON.stringify(updates)],
    );
    expect(
      (await journey(c, { update: { id: randomUUID(), status: "tried" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await journey(c, { update: { id: updates[0].id, status: "waiting" } }))
        .statusCode,
    ).toBe(200);
  });
  it("persists only an owned active story preference, exports it and clears deleted selections", async () => {
    const user = await newUser(app),
      other = await newUser(app);
    const c = await cast(user.auth);
    const pref = (currentCastId: string | null, headers = user.auth) =>
      app.inject({
        method: "PATCH",
        url: "/oracle/return-preferences",
        headers,
        payload: { currentCastId },
      });
    expect((await pref(c.id)).statusCode).toBe(404);
    await journey(c, {
      action: "Ask about the next step",
      followUpEnabled: true,
    });
    expect((await pref(c.id, other.auth)).statusCode).toBe(404);
    expect((await pref(c.id)).json()).toEqual({ currentCastId: c.id });
    const journal = await app.inject({
      method: "GET",
      url: "/oracle/journal",
      headers: user.auth,
    });
    expect(journal.json().returnPreferences).toEqual({ currentCastId: c.id });
    expect(
      (await exportUserData(user.id)).oracleReturnPreferences[0]
        .current_cast_id,
    ).toBe(c.id);
    expect((await pref(null)).json()).toEqual({ currentCastId: null });
    await pref(c.id);
    await journey(c, { followUpEnabled: false, status: "paused" });
    expect((await pref(c.id)).statusCode).toBe(404);
    await app.inject({
      method: "DELETE",
      url: `/oracle/casts/${c.id}`,
      headers: user.auth,
    });
    expect(
      (
        await pool.query(
          "SELECT current_cast_id FROM oracle_return_preferences WHERE user_id=$1",
          [user.id],
        )
      ).rows[0].current_cast_id,
    ).toBeNull();
    const temporary = await cast(user.auth, true);
    await journey(temporary, { action: "Keep this temporary" });
    expect((await pref(temporary.id)).statusCode).toBe(404);
    const expired = await cast(user.auth);
    await journey(expired, {
      action: "Try before expiry",
      followUpEnabled: true,
    });
    await pool.query(
      "UPDATE oracle_casts SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [expired.id],
    );
    expect((await pref(expired.id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/oracle/return-preferences",
          payload: { currentCastId: null },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/account",
          headers: user.auth,
          payload: { password: "password123", confirm: "DELETE" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT user_id FROM oracle_return_preferences WHERE user_id=$1",
          [user.id],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("gives guests a cached personal reflection without an order, recast or memory opt-in", async () => {
    const c = await cast();
    vi.mocked(generateJson).mockResolvedValue({
      data: ai,
      provider: "test",
      model: "test-model",
    });
    const before = (
      await pool.query(
        "SELECT rounds,basis_json FROM oracle_casts WHERE id=$1",
        [c.id],
      )
    ).rows[0];
    const results = await Promise.all([glimpse(c), glimpse(c)]);
    for (const result of results) {
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().cast.glimpse).toMatchObject({
        aiGenerated: true,
        generator: "test:test-model",
        language: "en-US",
        doors: [{ id: "a" }, { id: "b" }],
      });
      expect(result.json().cast.order).toBeNull();
      expect(result.json().cast.premiumStatus).toBe("free");
    }
    expect(generateJson).toHaveBeenCalledTimes(1);
    await glimpse(c, "zh-Hans");
    expect(generateJson).toHaveBeenCalledTimes(1); // Saved content retains its language.
    const after = (
      await pool.query(
        "SELECT rounds,basis_json FROM oracle_casts WHERE id=$1",
        [c.id],
      )
    ).rows[0];
    expect(after).toEqual(before);
    const request = vi.mocked(generateJson).mock.calls[0][1];
    expect(request.messages[0].content).toContain(
      "Neither offer has been accepted.",
    );
    expect(request.system).toContain("never infer unstated");
  });
  it.each(["en-US", "en-GB", "zh-Hans", "zh-Hant"])(
    "labels an editorial fallback in %s and allows a real retry",
    async (language) => {
      const c = await cast();
      const fallback = await glimpse(c, language);
      expect(fallback.statusCode, fallback.body).toBe(200);
      expect(fallback.json()).toMatchObject({
        unavailable: true,
        cast: {
          glimpse: { language, aiGenerated: false, generator: "editorial" },
        },
      });
      expect(
        (
          await pool.query(
            "SELECT glimpse_json FROM oracle_casts WHERE id=$1",
            [c.id],
          )
        ).rows[0].glimpse_json,
      ).toBeNull();
      vi.mocked(generateJson).mockResolvedValueOnce({
        data: ai,
        provider: "test",
        model: "test",
      });
      expect((await glimpse(c, language)).json().cast.glimpse.aiGenerated).toBe(
        true,
      );
      expect(vi.mocked(generateJson).mock.calls.at(-1)![1].system).toContain(
        language === "zh-Hant"
          ? "Traditional Chinese"
          : language === "zh-Hans"
            ? "Simplified Chinese"
            : language === "en-GB"
              ? "British English"
              : "American English",
      );
    },
  );
  it("uses the labelled fallback after malformed or unsafe AI output", async () => {
    const c = await cast();
    vi.mocked(generateJson).mockResolvedValueOnce({
      data: { ...ai, doors: [ai.doors[0]] },
      provider: "test",
      model: "test",
    });
    expect((await glimpse(c)).json().cast.glimpse.aiGenerated).toBe(false);
    vi.mocked(generateJson).mockResolvedValueOnce({
      data: {
        ...ai,
        reflection: "You will get rich. This choice guarantees success.",
      },
      provider: "test",
      model: "test",
    });
    expect((await glimpse(c)).json().cast.glimpse.aiGenerated).toBe(false);
    vi.mocked(generateJson).mockRejectedValueOnce(
      new Error("upstream secret should never appear"),
    );
    const result = await glimpse(c);
    expect(result.body).not.toContain("upstream secret");
    expect(result.json().unavailable).toBe(true);
  });
  it("bounds concurrent free generation so regular API work retains database capacity", async () => {
    const casts = await Promise.all(Array.from({ length: 4 }, () => cast()));
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(generateJson).mockImplementation(async () => {
      started++;
      await gate;
      return { data: ai, provider: "test", model: "test" } as any;
    });
    const requests = casts.slice(0, 3).map((c) => glimpse(c));
    try {
      await vi.waitFor(() => expect(started).toBe(3));
      expect((await glimpse(casts[3])).statusCode).toBe(409);
      expect(
        (await app.inject({ method: "GET", url: "/health" })).statusCode,
      ).toBe(200);
    } finally {
      release();
    }
    expect(
      (await Promise.all(requests)).every((r) => r.statusCode === 200),
    ).toBe(true);
  });
  it("requires ownership, complete coins, valid language and unexpired access", async () => {
    const c = await cast({}, false, false);
    expect((await glimpse(c)).statusCode).toBe(400);
    expect(
      (await journey(c, { action: "Ask one concrete question" })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/oracle/casts/${c.id}/glimpse`,
          payload: { language: "en-US" },
        })
      ).statusCode,
    ).toBe(404);
    expect((await glimpse(c, "xx")).statusCode).toBe(400);
    await pool.query(
      "UPDATE oracle_casts SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [c.id],
    );
    expect((await glimpse(c)).statusCode).toBe(404);
    expect((await journey(c, { action: "Ask one question" })).statusCode).toBe(
      404,
    );
  });
  it("preserves guest choices, custom actions and idempotent updates without silently saving an account", async () => {
    const c = await cast();
    expect(
      (
        await journey(c, {
          selectedDoor: "b",
          feedback: "misses",
          action: "Ask what the onboarding really involves",
        })
      ).statusCode,
    ).toBe(200);
    const update = {
      id: randomUUID(),
      text: "I asked and learned that mentoring is not confirmed.",
      status: "waiting",
    };
    const responses = await Promise.all([
      journey(c, { update }),
      journey(c, { update }),
    ]);
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect((await journey(c, { selectedDoor: null })).statusCode).toBe(409);
    const result = (await journey(c, { selectedDoor: "b" })).json().cast;
    expect(result.journey).toMatchObject({
      selectedDoor: "b",
      feedback: "misses",
      action: "Ask what the onboarding really involves",
      followUpEnabled: false,
      status: "waiting",
      updates: [update],
    });
    expect(result.journey.updates).toHaveLength(1);
    expect(result.saved).toBe(false);
    expect(result.expiresAt).not.toBeNull();
    expect(
      (await journey(c, { update: { ...update, text: "Different retry" } }))
        .statusCode,
    ).toBe(409);
    expect((await journey(c, { action: "x".repeat(401) })).statusCode).toBe(
      400,
    );
    expect((await journey(c, { followUpEnabled: true })).statusCode).toBe(400);
  });
  it("claims only with explicit signed-in following, supports pause, exports and deletes the new content", async () => {
    const user = await newUser(app);
    const other = await newUser(app);
    const c = await cast();
    const signed = { ...c, headers: { ...c.headers, ...user.auth } };
    expect(
      (
        await journey(signed, { action: "Ask about one mentoring session" })
      ).json().cast.saved,
    ).toBe(false);
    expect(
      (await journey(signed, { followUpEnabled: true })).json().cast,
    ).toMatchObject({
      saved: true,
      expiresAt: null,
      journey: { followUpEnabled: true },
    });
    expect((await journey(c, { feedback: "fits" })).statusCode).toBe(404);
    expect(
      (
        await journey(
          { ...c, headers: { ...c.headers, ...other.auth } },
          { feedback: "fits" },
        )
      ).statusCode,
    ).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: "/oracle/journal",
      headers: user.auth,
    });
    expect(
      list.json().casts.find((r: any) => r.id === c.id).journey.action,
    ).toBe("Ask about one mentoring session");
    expect(
      (
        await journey(signed, { followUpEnabled: false, status: "paused" })
      ).json().cast.journey,
    ).toMatchObject({ followUpEnabled: false, status: "paused" });
    const exported = await exportUserData(user.id);
    expect(
      exported.oracleReadings.find((r: any) => r.id === c.id).journey_json
        .action,
    ).toContain("mentoring");
    expect(
      (
        await pool.query("SELECT memory_enabled FROM users WHERE id=$1", [
          user.id,
        ])
      ).rows[0].memory_enabled,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/oracle/casts/${c.id}`,
          headers: user.auth,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await pool.query("SELECT id FROM oracle_casts WHERE id=$1", [c.id]))
        .rowCount,
    ).toBe(0);
  });
  it("keeps temporary stories temporary even for signed-in users", async () => {
    const user = await newUser(app);
    const c = await cast(user.auth, true);
    expect(
      (
        await journey(c, {
          action: "Write one sentence",
          followUpEnabled: true,
        })
      ).statusCode,
    ).toBe(400);
    const result = await journey(c, { action: "Write one sentence" });
    expect(result.statusCode).toBe(200);
    expect(result.json().cast.saved).toBe(false);
    expect(result.json().cast.expiresAt).not.toBeNull();
  });
});
