import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/modules/ai/llm.js", () => ({ generateJson: vi.fn() }));
import { generateJson } from "../src/modules/ai/llm.js";
import { ReviewBody, organizeReview } from "../src/modules/oracle/review.js";

const input = (language = "zh-Hans") =>
  ReviewBody.parse({
    topic: "wealth",
    language,
    ageConfirmed: true,
    question: "怎样安排项目付款，才能更容易拿到预付款？",
    context:
      "客户有时不愿付预付款。我希望签约时先收预付款，再按进度提前收款。这只是我的设想，还没确定。",
  });
const fields = {
  situation: "客户有时不愿付预付款。",
  focus: "如何安排项目付款。",
  goal: "签约时收取预付款，再按进度提前收款。",
  timeframe: "",
  notes: "只是设想，尚未确定。",
  additionalInformation: "",
};
beforeEach(() => vi.resetAllMocks());
describe("structured review extraction", () => {
  it.each(["en-US", "en-GB", "zh-Hans", "zh-Hant"])(
    "extracts fixed keys in the requested locale: %s",
    async (lang) => {
      vi.mocked(generateJson).mockResolvedValue({
        data: fields,
        provider: "test",
        model: "test",
      });
      expect(await organizeReview(input(lang))).toEqual({
        fields,
        aiGenerated: true,
      });
      const [task, request] = vi.mocked(generateJson).mock.calls[0];
      expect(task).toBe("intake");
      expect(request.system).toContain("untrusted DATA");
      expect(request.system).toContain(
        "Missing information must be an empty string",
      );
      expect(request.system).toContain(
        "proposed plans versus existing arrangements",
      );
      expect(request.system).toContain(
        (
          {
            "en-US": "American English",
            "en-GB": "British English",
            "zh-Hans": "Simplified Chinese",
            "zh-Hant": "Traditional Chinese",
          } as Record<string, string>
        )[lang],
      );
      expect(JSON.parse(request.messages[0].content)).toEqual({
        topic: "wealth",
        question: input().question,
        context: input().context,
      });
      expect(request.schema.required).toEqual(Object.keys(fields));
    },
  );
  it("requires notes and additional information, and rejects oversized or non-string output", async () => {
    vi.mocked(generateJson).mockResolvedValue({
      data: fields,
      provider: "test",
      model: "test",
    });
    await organizeReview(input());
    const validate = vi.mocked(generateJson).mock.calls[0][1].validate;
    expect(() => validate({ ...fields, notes: undefined })).toThrow();
    expect(() => validate({ ...fields, additionalInformation: [] })).toThrow();
    expect(() =>
      validate({ ...fields, situation: "x".repeat(1000) }),
    ).toThrow();
    expect(
      validate({
        ...fields,
        timeframe: "",
        notes: "",
        additionalInformation: "",
      }),
    ).toMatchObject({ timeframe: "", notes: "", additionalInformation: "" });
  });
  it("does not pretend to have used AI when a provider is not configured", async () => {
    vi.mocked(generateJson).mockResolvedValue(null);
    expect(await organizeReview(input())).toEqual({
      fields: null,
      aiGenerated: false,
    });
  });
  it("returns a recoverable error for a failed provider or malformed result", async () => {
    vi.mocked(generateJson).mockRejectedValueOnce(new Error("provider failed"));
    await expect(organizeReview(input())).rejects.toMatchObject({
      status: 503,
      code: "review_unavailable",
    });
    vi.mocked(generateJson).mockResolvedValue({
      data: { ...fields, notes: null },
      provider: "test",
      model: "test",
    });
    await expect(organizeReview(input())).rejects.toMatchObject({
      status: 503,
      code: "review_unavailable",
    });
  });
});
