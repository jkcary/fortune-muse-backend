import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { newUser, setup } from "./helpers.js";
import { GARDEN_LEVELS } from "../src/modules/garden/engine.js";
import { exportUserData, deleteUser } from "../src/modules/account/routes.js";
let app: FastifyInstance;
beforeAll(async () => {
  app = await setup();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
const solve = (level: number) => ({
  level,
  rotations: GARDEN_LEVELS[level - 1].tiles.map(() => 0),
});
describe("account garden", () => {
  it("requires sign-in, validates solutions and locks, and awards one completion under retries", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/garden" })).statusCode,
    ).toBe(401);
    const u = await newUser(app);
    const before = (
      await app.inject({ method: "GET", url: "/garden", headers: u.auth })
    ).json();
    expect(before.completed).toEqual([]);
    const post = (body: object) =>
      app.inject({
        method: "POST",
        url: "/garden/complete",
        headers: u.auth,
        payload: body,
      });
    expect(
      (await post({ level: 1, rotations: GARDEN_LEVELS[0].initial }))
        .statusCode,
    ).toBe(400);
    expect((await post(solve(2))).statusCode).toBe(400);
    expect((await post({ level: 1, rotations: [0] })).statusCode).toBe(400);
    const results = await Promise.all([post(solve(1)), post(solve(1))]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results[1].json().completed).toEqual([1]);
    expect((await post(solve(2))).json().completed).toEqual([1, 2]);
    const other = await newUser(app);
    expect(
      (
        await app.inject({ method: "GET", url: "/garden", headers: other.auth })
      ).json().completed,
    ).toEqual([]);
  });
  it("only displays earned decorations and preserves distinct choices under account ownership", async () => {
    const u = await newUser(app);
    const decor = (items: string[]) =>
      app.inject({
        method: "PATCH",
        url: "/garden/decor",
        headers: u.auth,
        payload: { decor: items },
      });
    expect((await decor(["moon-lamp"])).statusCode).toBe(400);
    await app.inject({
      method: "POST",
      url: "/garden/complete",
      headers: u.auth,
      payload: solve(1),
    });
    expect((await decor(["moon-lamp", "moon-lamp"])).json().decor).toEqual([
      "moon-lamp",
    ]);
    expect((await decor(["moon-bridge"])).statusCode).toBe(400);
    expect((await decor([])).json().decor).toEqual([]);
  });
  it("keeps one moment per local day, stores no draft text, exports and deletes garden data", async () => {
    const u = await newUser(app);
    const headers = { ...u.auth, "x-timezone": "America/Los_Angeles" };
    const posts = await Promise.all(
      ["joy", "question"].map((kind) =>
        app.inject({
          method: "POST",
          url: "/garden/moment",
          headers,
          payload: { kind },
        }),
      ),
    );
    expect(posts.every((r) => r.statusCode === 200)).toBe(true);
    expect(posts[1].json().momentCount).toBe(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/garden/moment",
          headers,
          payload: { kind: "joy", text: "not saved" },
        })
      ).statusCode,
    ).toBe(400);
    await app.inject({
      method: "POST",
      url: "/garden/complete",
      headers,
      payload: solve(1),
    });
    const data = await exportUserData(u.id);
    expect(data.gardenProgress[0].completed).toEqual([1]);
    expect(data.gardenMoments).toHaveLength(1);
    await deleteUser(u.id);
    expect(
      (
        await pool.query("SELECT * FROM garden_progress WHERE user_id=$1", [
          u.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT * FROM garden_moments WHERE user_id=$1", [
          u.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("persists bounded door choices with story ownership and leaves the hexagram untouched", async () => {
    const u = await newUser(app),
      other = await newUser(app),
      id = randomUUID(),
      token = randomUUID() + randomUUID();
    await app.inject({
      method: "POST",
      url: "/oracle/casts",
      headers: u.auth,
      payload: {
        id,
        token,
        topic: "wealth",
        question: "How can I explore a new role?",
        context: "Nothing agreed.",
        ageConfirmed: true,
        informationConfirmed: true,
      },
    });
    const finished = await app.inject({
      method: "POST",
      url: `/oracle/casts/${id}/rounds`,
      headers: u.auth,
      payload: { complete: true },
    });
    const basis = finished.json().cast.basis;
    const body = {
      doorExercise: { door: "a", priority: "growth", cost: "time" },
    };
    const update = await app.inject({
      method: "PATCH",
      url: `/oracle/casts/${id}/journey`,
      headers: u.auth,
      payload: body,
    });
    expect(update.statusCode, update.body).toBe(200);
    expect(update.json().cast.journey.doorExercise).toEqual(body.doorExercise);
    expect(update.json().cast.basis).toEqual(basis);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/oracle/casts/${id}/journey`,
          headers: other.auth,
          payload: body,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/oracle/casts/${id}/journey`,
          headers: u.auth,
          payload: { doorExercise: { ...body.doorExercise, cost: "money" } },
        })
      ).statusCode,
    ).toBe(400);
  });
});
