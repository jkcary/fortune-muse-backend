import { z } from "zod";
import { config } from "../../config.js";
import { one, pool } from "../../db/pool.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { asLang, type Lang } from "../../lib/i18n.js";
import { generateJson } from "../ai/llm.js";
import { makesGuarantee, screenQuestion } from "../safety/safety.js";
import {
  ACTION_FIELD_RULES,
  ACTION_GUIDE_VERSION,
  ACTION_STYLE,
  ActionText,
  sampleAction,
} from "./actionStyle.js";
import { ORACLE_LANGUAGE, ORACLE_RULES } from "./generation.js";

const flights = new Map<string, Promise<any>>();
const Output = z.object({ action: ActionText });

/** The caller must enforce cast access first. Refines one existing action; never charges or recasts. */
export async function refineActionGuide(row: any, accountLanguage?: unknown) {
  if (row.premium_json?.actionGuideVersion === ACTION_GUIDE_VERSION) return row;
  const language = asLang(row.premium_json?.language ?? accountLanguage);
  const key = `${row.id}:${language}`;
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = refine(row, language).finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
}

async function refine(row: any, language: Lang) {
  let action: string, aiGenerated: boolean;
  try {
    const result = await generateJson("reading", {
      system:
        ORACLE_RULES +
        "\n" +
        ACTION_STYLE +
        "\n" +
        ACTION_FIELD_RULES +
        "\nRefine only the action of this existing reading. Preserve the supplied question, facts and immutable hexagram. Do not change the interpretation or add a new prediction.\n" +
        ORACLE_LANGUAGE[language],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            topic: row.topic,
            question: row.question,
            context: row.context,
            cast: row.basis_json,
            reading: row.premium_json,
          }),
        },
      ],
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: { action: { type: "string" } },
      },
      maxTokens: 1800,
      validate: (value) => Output.parse(value),
    });
    if (!result && config.NODE_ENV === "production")
      throw new Error("production_model_required");
    action = result
      ? Output.parse(result.data).action
      : sampleAction(row.topic, language);
    aiGenerated = Boolean(result);
    if (makesGuarantee(action) || !screenQuestion(action).ok)
      throw new Error("content_check_failed");
  } catch {
    throw new HttpError(
      503,
      "action_guide_unavailable",
      "Your action guide could not be refined right now. Your original reading is safe. Please try again.",
    );
  }
  const updated = await one(
    pool,
    `UPDATE oracle_casts SET premium_json=premium_json || $2::jsonb,updated_at=now() WHERE id=$1 AND premium_status='ready' AND premium_json IS NOT NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING *`,
    [
      row.id,
      JSON.stringify({
        action,
        actionGuideVersion: ACTION_GUIDE_VERSION,
        actionGuideAiGenerated: aiGenerated,
      }),
    ],
  );
  if (!updated) throw notFound("Reading not found or expired.");
  return updated;
}
