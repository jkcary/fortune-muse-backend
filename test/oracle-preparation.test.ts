import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/modules/ai/llm.js", () => ({ generateJson: vi.fn() }));
import { generateJson } from "../src/modules/ai/llm.js";
import {
  PreparationBody,
  prepareReading,
} from "../src/modules/oracle/preparation.js";

const input = () =>
  PreparationBody.parse({
    topic: "love",
    language: "zh-Hant",
    ageConfirmed: true,
    turns: [
      {
        role: "user",
        text: "最近约会时，我总是很紧张，想了解自己的相处模式。",
      },
    ],
  });
beforeEach(() => vi.resetAllMocks());
describe("oracle guide generation", () => {
  it("returns a genuine model reply with explicit AI attribution", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      data: {
        reply:
          "謝謝你分享這份緊張。通常在約會的哪個時刻，你會最明顯地感到不自在？",
        ready: false,
      },
      provider: "test",
      model: "test",
    });
    expect(await prepareReading(input())).toMatchObject({
      aiGenerated: true,
      ready: false,
      reply: expect.stringContaining("緊張"),
    });
    const request = vi.mocked(generateJson).mock.calls[0];
    expect(request[0]).toBe("intake");
    expect(request[1].system).toContain("Traditional Chinese");
    expect(
      JSON.parse(request[1].messages[0].content).transcript[0].text,
    ).toContain("相处模式");
  });
  it("reports a provider failure without fabricating a personal reply", async () => {
    vi.mocked(generateJson).mockRejectedValue(new Error("provider failed"));
    await expect(prepareReading(input())).rejects.toMatchObject({
      status: 503,
      code: "guide_unavailable",
    });
  });
  it("rejects a model guarantee instead of presenting it to the user", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      data: { reply: "You are guaranteed to become rich.", ready: true },
      provider: "test",
      model: "test",
    });
    await expect(prepareReading(input())).rejects.toMatchObject({
      status: 503,
      code: "guide_unavailable",
    });
  });
});
