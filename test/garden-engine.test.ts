import { describe, expect, it } from "vitest";
import {
  GARDEN_LEVELS,
  lightState,
  rotateMask,
  hintTile,
} from "../src/modules/garden/engine.js";
import { chapterSteps } from "../../frontend/src/lib/storyReturn";
import type { OracleCast } from "../src/modules/oracle/contracts.js";

describe("light-path puzzles", () => {
  it.each(GARDEN_LEVELS)(
    "lantern $id starts unsolved and has a reachable solution",
    (level) => {
      expect(lightState(level, level.initial).solved).toBe(false);
      const rotations = [...level.initial];
      for (let n = 0; n < 30 && !lightState(level, rotations).solved; n++) {
        const hint = hintTile(level, rotations);
        expect(hint).toBeGreaterThanOrEqual(0);
        rotations[hint] = 0;
      }
      const result = lightState(level, rotations);
      expect(result.solved).toBe(true);
      expect(result.stars).toBe(level.tiles.filter((t) => t.star).length);
    },
  );
  it("requires side stars, rejects fixed tile changes, and handles rotations", () => {
    const level = GARDEN_LEVELS[7],
      solution = level.tiles.map(() => 0);
    expect(level.tiles.some((t) => [7, 11, 13, 14].includes(t.mask))).toBe(
      true,
    );
    const tip = level.tiles.findIndex(
      (t) => t.star && [1, 2, 4, 8].includes(t.mask),
    );
    expect(tip).toBeGreaterThanOrEqual(0);
    solution[tip] = 1;
    expect(lightState(level, solution).lit).toContain(level.goal);
    expect(lightState(level, solution).solved).toBe(false);
    solution[tip] = 0;
    solution[level.source] = 1;
    expect(lightState(level, solution).solved).toBe(false);
    expect(rotateMask(3, 1)).toBe(6);
    expect(rotateMask(3, 4)).toBe(3);
  });
  it("never joins the right edge to the next row", () => {
    const level = {
      id: 1,
      size: 2,
      source: 1,
      goal: 2,
      theme: "Water",
      initial: [0, 0, 0, 0],
      tiles: [
        { mask: 0, fixed: true, star: false },
        { mask: 2, fixed: true, star: false },
        { mask: 8, fixed: true, star: false },
        { mask: 0, fixed: true, star: false },
      ],
    };
    expect(lightState(level, level.initial).lit).toEqual([1]);
    expect(lightState(level, [0, 0]).solved).toBe(false);
  });
});
describe("story chapter milestones", () => {
  it("counts actual choices and a waiting or paused update without requiring success", () => {
    const cast = { journey: null } as OracleCast;
    expect(chapterSteps(cast)).toEqual([false, false, false]);
    cast.journey = {
      selectedDoor: null,
      feedback: null,
      action: "Ask a question",
      followUpEnabled: false,
      status: "paused",
      updates: [
        {
          id: "u",
          text: "",
          status: "paused",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(chapterSteps(cast)).toEqual([true, true, true]);
    cast.journey.action = "";
    expect(chapterSteps(cast)).toEqual([false, false, false]);
    cast.journey.feedback = "misses";
    expect(chapterSteps(cast)).toEqual([true, false, false]);
  });
});
