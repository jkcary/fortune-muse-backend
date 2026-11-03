import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/modules/ai/llm.js", () => ({ generateJson: vi.fn() }));
vi.mock("../src/db/pool.js", () => ({ one: vi.fn(), many: vi.fn(), pool: {} }));
import { generateJson } from "../src/modules/ai/llm.js";
import { one } from "../src/db/pool.js";
import { refineActionGuide } from "../src/modules/oracle/actionGuide.js";
import {
  ACTION_GUIDE_VERSION,
  ActionText,
  sampleAction,
} from "../src/modules/oracle/actionStyle.js";
const row = () => ({
  id: "test-action",
  topic: "wealth",
  question: "How can I clarify a project payment discussion?",
  context: "The payment schedule is only a proposal; my client has not agreed.",
  premium_status: "ready",
  basis_json: { primary: { number: 46 } },
  premium_json: {
    language: "en-US",
    interpretation: "Original interpretation",
    action: "Original action",
  },
});
beforeEach(() => vi.resetAllMocks());
describe("clear action guides", () => {
  it.each(["en-US", "en-GB", "zh-Hans", "zh-Hant"] as const)(
    "has four actionable parts in editorial fallback: %s",
    (lang) => {
      for (const topic of ["wealth", "love"] as const)
        expect(ActionText.parse(sampleAction(topic, lang))).toContain("10");
      expect(() =>
        ActionText.parse("Just be positive and trust the process."),
      ).toThrow();
    },
  );
  it("uses original context and saves only the action and its attribution", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      data: { action: sampleAction("wealth", "en-US") },
      provider: "test",
      model: "test",
    });
    vi.mocked(one).mockResolvedValue({ id: "test-action" });
    const original = row();
    await refineActionGuide(original, "zh-Hans");
    const request = vi.mocked(generateJson).mock.calls[0][1];
    expect(request.system).toContain("American English");
    expect(request.system).toContain(
      "Distinguish what the user actually reported",
    );
    expect(request.system).toContain("exact sentence");
    expect(JSON.parse(request.messages[0].content).context).toContain(
      "only a proposal",
    );
    const stored = JSON.parse((vi.mocked(one).mock.calls[0][2] as any[])[1]);
    expect(Object.keys(stored).sort()).toEqual([
      "action",
      "actionGuideAiGenerated",
      "actionGuideVersion",
    ]);
    expect(stored).toMatchObject({
      actionGuideVersion: ACTION_GUIDE_VERSION,
      actionGuideAiGenerated: true,
    });
    expect(original.premium_json.interpretation).toBe(
      "Original interpretation",
    );
  });
  it("returns cached content and coalesces concurrent refinements", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      data: { action: sampleAction("wealth", "en-US") },
      provider: "test",
      model: "test",
    });
    vi.mocked(one).mockResolvedValue({ id: "test-action" });
    await Promise.all([refineActionGuide(row()), refineActionGuide(row())]);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenCalledTimes(1);
    const cached = {
      ...row(),
      premium_json: {
        ...row().premium_json,
        actionGuideVersion: ACTION_GUIDE_VERSION,
      },
    };
    expect(await refineActionGuide(cached)).toBe(cached);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
  it("preserves the old action on provider failure or unsafe output and allows a retry", async () => {
    vi.mocked(generateJson).mockRejectedValueOnce(new Error("offline"));
    await expect(refineActionGuide(row())).rejects.toMatchObject({
      status: 503,
      code: "action_guide_unavailable",
    });
    vi.mocked(generateJson).mockResolvedValue({
      data: {
        action:
          sampleAction("wealth", "en-US") +
          " You are guaranteed to become rich.",
      },
      provider: "test",
      model: "test",
    });
    await expect(refineActionGuide(row())).rejects.toMatchObject({
      status: 503,
    });
    expect(one).not.toHaveBeenCalled();
    vi.mocked(generateJson).mockResolvedValue({
      data: { action: sampleAction("wealth", "en-US") },
      provider: "test",
      model: "test",
    });
    vi.mocked(one).mockResolvedValue({ id: "test-action" });
    await expect(refineActionGuide(row())).resolves.toMatchObject({
      id: "test-action",
    });
  });
  it("labels offline editorial content accurately", async () => {
    vi.mocked(generateJson).mockResolvedValue(null);
    vi.mocked(one).mockResolvedValue({ id: "test-action" });
    await refineActionGuide(row());
    expect(
      JSON.parse((vi.mocked(one).mock.calls[0][2] as any[])[1])
        .actionGuideAiGenerated,
    ).toBe(false);
  });
});
