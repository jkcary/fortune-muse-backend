import { z } from "zod";
import { one, pool } from "../../db/pool.js";
import { conflict, notFound } from "../../lib/errors.js";
import type { Lang } from "../../lib/i18n.js";
import { generateJson } from "../ai/llm.js";
import { makesGuarantee, screenQuestion } from "../safety/safety.js";
import { ORACLE_LANGUAGE, ORACLE_RULES } from "./generation.js";
import type { OracleGlimpse } from "./contracts.js";

const Door = z
  .object({
    title: z.string().trim().min(2).max(90),
    perspective: z.string().trim().min(5).max(350),
    tradeoff: z.string().trim().min(5).max(240),
    experiment: z.string().trim().min(5).max(300),
  })
  .strict();
const Output = z
  .object({
    reflection: z.string().trim().min(10).max(500),
    question: z.string().trim().min(5).max(200),
    doors: z.tuple([Door, Door]),
  })
  .strict();
const doorSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(Door.shape),
  properties: Object.fromEntries(
    Object.keys(Door.shape).map((k) => [k, { type: "string" }]),
  ),
};

/** A clearly attributed, usable editorial fallback. Never presented as personal AI insight. */
export function editorialGlimpse(language: Lang, love: boolean): OracleGlimpse {
  const zh = language.startsWith("zh");
  const traditional = language === "zh-Hant";
  const values = !zh
    ? {
        reflection:
          "Keep your question in view. Separate what you have observed from what you still need to find out; these two paths are prompts for exploring it.",
        question: "Which small step would give you useful new information?",
        doors: [
          {
            title: love ? "Make room to listen" : "Learn a little more",
            perspective: love
              ? "Explore what matters to each of you through a conversation you both want to have."
              : "Explore the choice by gathering one missing piece of information.",
            tradeoff: "This takes time, and the answer may still be uncertain.",
            experiment: love
              ? "Write one open question you could ask in a welcome, unhurried conversation."
              : "Write down one unknown about your choice and one person you could ask about it.",
          },
          {
            title: love ? "Name your own needs" : "Try a smaller version",
            perspective: love
              ? "Explore what you need and what boundaries you want to communicate."
              : "Explore what you can learn through a small, reversible step.",
            tradeoff:
              "A small experiment will not answer every part of the question.",
            experiment: love
              ? "Write one sentence beginning: I would feel more comfortable if…"
              : "Choose a ten-minute experiment that costs nothing and creates no commitment.",
          },
        ],
      }
    : traditional
      ? {
          reflection:
            "帶著你的問題，先分清已觀察到的事實與仍待了解的部分。這兩條路提供不同的探索角度。",
          question: "哪個小行動，能讓你得到一點新的資訊？",
          doors: [
            {
              title: love ? "留一點空間傾聽" : "先多了解一點",
              perspective: love
                ? "透過雙方都願意的對話，了解彼此在乎什麼。"
                : "先找出一項缺少的資訊，再重新看待選擇。",
              tradeoff: "這需要時間，也可能暫時得不到明確答案。",
              experiment: love
                ? "寫下一個可以在合適時機提出的開放式問題。"
                : "寫下一項尚未確認的資訊，以及可以向誰了解。",
            },
            {
              title: love ? "說清自己的需要" : "先試一小步",
              perspective: love
                ? "探索自己的需要，以及希望表達的界線。"
                : "用一個可撤回的小嘗試，了解自己的真實感受。",
              tradeoff: "一個小嘗試，無法回答問題的所有部分。",
              experiment: love
                ? "補完這句話：如果能夠……，我會感到更自在。"
                : "選一個十分鐘內能完成、不花錢也不作承諾的小嘗試。",
            },
          ],
        }
      : {
          reflection:
            "带着你的问题，先分清已观察到的事实与仍待了解的部分。这两条路提供不同的探索角度。",
          question: "哪个小行动，能让你得到一点新的信息？",
          doors: [
            {
              title: love ? "留一点空间倾听" : "先多了解一点",
              perspective: love
                ? "通过双方都愿意的对话，了解彼此在乎什么。"
                : "先找出一项缺少的信息，再重新看待选择。",
              tradeoff: "这需要时间，也可能暂时得不到明确答案。",
              experiment: love
                ? "写下一个可以在合适时机提出的开放式问题。"
                : "写下一项尚未确认的信息，以及可以向谁了解。",
            },
            {
              title: love ? "说清自己的需要" : "先试一小步",
              perspective: love
                ? "探索自己的需要，以及希望表达的边界。"
                : "用一个可撤回的小尝试，了解自己的真实感受。",
              tradeoff: "一个小尝试，无法回答问题的所有部分。",
              experiment: love
                ? "补完这句话：如果能够……，我会感到更自在。"
                : "选一个十分钟内能完成、不花钱也不作承诺的小尝试。",
            },
          ],
        };
  return {
    ...values,
    language,
    doors: values.doors.map((d, i) => ({
      ...d,
      id: i ? "b" : "a",
    })) as OracleGlimpse["doors"],
    aiGenerated: false,
    generator: "editorial",
  };
}

const flights = new Map<string, Promise<any>>();
/** Access is checked by the route. One cached glimpse per cast; no payment or reroll. */
export function createGlimpse(row: any, language: Lang): Promise<any> {
  if (row.glimpse_json) return Promise.resolve({ row, unavailable: false });
  const flight = flights.get(row.id);
  if (flight) return flight;
  // Leave pool capacity for auth, model settings, paid delivery and ordinary requests.
  if (flights.size >= 3)
    return Promise.reject(
      conflict(
        "glimpse_busy",
        "The guide is busy. Try your reflection again in a moment.",
      ),
    );
  const next = generate(row, language).finally(() => flights.delete(row.id));
  flights.set(row.id, next);
  return next;
}
async function generate(original: any, language: Lang) {
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (
      await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
        `glimpse:${original.id}`,
      ])
    ).rows[0].locked;
    if (!locked)
      throw conflict(
        "glimpse_in_progress",
        "Your reflection is being prepared. Try again in a moment.",
      );
    const row = await one(
      c,
      "SELECT * FROM oracle_casts WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())",
      [original.id],
    );
    if (!row) throw notFound("Reading not found or expired.");
    if (row.glimpse_json) return { row, unavailable: false };
    let glimpse: OracleGlimpse;
    try {
      const result = await generateJson("intake", {
        system:
          ORACLE_RULES +
          `
Create a FREE short personal reflection and TWO EXPLORABLE PATHS. Respond directly to at least one specific detail in the supplied question/context. Reflect a possible tension tentatively; never infer unstated emotions or facts. The user can disagree. Use the exact supplied hexagram only as a symbolic lens.
The reflection is 1-2 short sentences. The question is one useful, concrete question. Each door has a brief title, a perspective (what it explores), a tradeoff (what remains uncertain or costs effort), and an experiment (one specific, safe, reversible action that takes under ten minutes). The two doors must be meaningfully different approaches to the user's actual question, not good/bad outcomes, a verdict, a factual prediction, or pressure to choose. They are thought experiments. Do not tell users to buy, invest, break up, resign or make irreversible decisions. Do not force a binary if the question has more possibilities. Keep the WHOLE answer under 260 English words or 500 Chinese characters. No markdown.\n` +
          ORACLE_LANGUAGE[language],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              topic: row.topic,
              question: row.question,
              context: row.context,
              cast: row.basis_json,
            }),
          },
        ],
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["reflection", "question", "doors"],
          properties: {
            reflection: { type: "string" },
            question: { type: "string" },
            doors: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: doorSchema,
            },
          },
        },
        maxTokens: 1800,
        validate: (value) => Output.parse(value),
      });
      if (!result)
        return {
          row: {
            ...row,
            glimpse_json: editorialGlimpse(language, row.topic === "love"),
          },
          unavailable: true,
        };
      const data = Output.parse(result.data);
      if (
        makesGuarantee(JSON.stringify(data)) ||
        !screenQuestion(JSON.stringify(data)).ok
      )
        throw new Error("content_check_failed");
      glimpse = {
        ...data,
        language,
        doors: data.doors.map((d, i) => ({
          ...d,
          id: i ? "b" : "a",
        })) as OracleGlimpse["doors"],
        aiGenerated: true,
        generator: `${result.provider}:${result.model}`,
      };
    } catch {
      // Keep casting usable; a later explicit retry can request the real AI again.
      const live = await one(
        c,
        "SELECT * FROM oracle_casts WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())",
        [row.id],
      );
      if (!live) throw notFound("Reading not found or expired.");
      return {
        row: {
          ...live,
          glimpse_json: editorialGlimpse(language, row.topic === "love"),
        },
        unavailable: true,
      };
    }
    const updated = await one(
      c,
      "UPDATE oracle_casts SET glimpse_json=$2,updated_at=now() WHERE id=$1 AND (expires_at IS NULL OR expires_at>now()) RETURNING *",
      [row.id, glimpse],
    );
    if (!updated) throw notFound("Reading not found or expired.");
    return { row: updated, unavailable: false };
  } finally {
    try {
      if (locked)
        await c.query("SELECT pg_advisory_unlock(hashtext($1))", [
          `glimpse:${original.id}`,
        ]);
      c.release();
    } catch (error) {
      c.release(error as Error);
      throw error;
    }
  }
}
