import { describe, expect, it } from "vitest";
import {
  isKeptStory,
  mergeStory,
  selectReturnStory,
} from "../../frontend/src/lib/storyReturn";
import type { OracleCast } from "../../frontend/src/lib/oracle-contract";

const story = (
  id: string,
  createdAt: string,
  patch: Partial<OracleCast> = {},
) =>
  ({
    id,
    createdAt,
    saved: true,
    privateMode: false,
    basis: {},
    expiresAt: null,
    journey: {
      action: "A small step",
      followUpEnabled: true,
      status: "planned",
      updates: [],
    },
    ...patch,
  }) as OracleCast;
describe("return invitations", () => {
  const old = story("old", "2026-10-01T00:00:00Z");
  const recent = story("recent", "2026-10-02T00:00:00Z");
  it("prefers a chosen active story, otherwise the least recently updated", () => {
    expect(selectReturnStory([recent, old], null)?.id).toBe("old");
    expect(selectReturnStory([recent, old], "recent")?.id).toBe("recent");
    const updated = {
      ...old,
      journey: {
        ...old.journey!,
        updates: [
          {
            id: "u",
            status: "tried" as const,
            text: "",
            createdAt: "2026-10-03T00:00:00Z",
          },
        ],
      },
    };
    expect(selectReturnStory([updated, recent], null)?.id).toBe("recent");
    expect(selectReturnStory([old, recent], "old", ["old"])?.id).toBe("recent");
  });
  it("excludes private, expired, guest, incomplete and paused stories from invitations", () => {
    const invalid = [
      { ...old, privateMode: true },
      { ...old, saved: false },
      { ...old, basis: null },
      { ...old, expiresAt: "2000-01-01T00:00:00Z" },
      { ...old, journey: { ...old.journey!, status: "paused" as const } },
      { ...old, journey: { ...old.journey!, followUpEnabled: false } },
    ];
    for (const candidate of invalid)
      expect(selectReturnStory([candidate, recent], "old")?.id).toBe("recent");
    expect(
      isKeptStory({ ...old, journey: { ...old.journey!, status: "paused" } }),
    ).toBe(true);
    expect(selectReturnStory(invalid, null)).toBeNull();
  });
  it("preserves a newer chapter if a stale response arrives later", () => {
    const newer = { ...old, updatedAt: "2026-10-03T00:00:00Z" };
    expect(mergeStory(newer, old)).toBe(newer);
  });
});
