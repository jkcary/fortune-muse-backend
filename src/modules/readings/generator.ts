import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { isChinese, type Lang } from '../../lib/i18n.js';
import { generateJson } from '../ai/llm.js';
import { makesGuarantee, mentionsAlcohol, screenQuestion } from '../safety/safety.js';
import { DIRECTIONS, type Tier, type Topic } from './catalog.js';
import { musicLinks, type Library } from './library.js';

export const DISCLAIMER = 'For entertainment purposes only. Not financial, medical, or legal advice.';

/** What the model returns. Picks are indexes into the library slice it was shown. */
const ModelOutput = z.object({
  direction: z.enum(DIRECTIONS),
  direction_note: z.string().min(1).max(200),
  answer: z.string().min(1).max(1500),
  outfit_index: z.number().int(),
  shoes_index: z.number().int(),
  avoid_color_index: z.number().int(),
  song_index: z.number().int(),
  drink_index: z.number().int(),
  food_index: z.number().int(),
  lucky_action: z.string().min(1).max(260),
  gentle_reminder: z.string().min(1).max(240),
  dos: z.array(z.string().max(120)).min(1).max(4),
  donts: z.array(z.string().max(120)).min(1).max(4),
  lucky_hour: z.string().max(60),
  reflections: z.array(z.string().max(200)).max(3),
  deity_message: z.string().min(1).max(300),
});
type ModelOutput = z.infer<typeof ModelOutput>;

const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(ModelOutput.shape),
  properties: {
    direction: { type: 'string', enum: [...DIRECTIONS] },
    direction_note: { type: 'string' },
    answer: { type: 'string' },
    outfit_index: { type: 'integer' },
    shoes_index: { type: 'integer' },
    avoid_color_index: { type: 'integer' },
    song_index: { type: 'integer' },
    drink_index: { type: 'integer' },
    food_index: { type: 'integer' },
    lucky_action: { type: 'string' },
    gentle_reminder: { type: 'string' },
    dos: { type: 'array', items: { type: 'string' } },
    donts: { type: 'array', items: { type: 'string' } },
    lucky_hour: { type: 'string' },
    reflections: { type: 'array', items: { type: 'string' } },
    deity_message: { type: 'string' },
  },
};

/** The stored, rendered result (plan §M4). */
export const ReadingResult = z.object({
  deityMessage: z.string(),
  answer: z.string(),
  direction: z.object({ value: z.string(), note: z.string() }),
  outfit: z.object({ style: z.string(), color: z.string() }),
  shoes: z.object({ style: z.string(), color: z.string() }),
  avoidColor: z.string(),
  song: z.object({ title: z.string(), artist: z.string(), spotifyUrl: z.string(), appleMusicUrl: z.string() }),
  drink: z.string(),
  food: z.string(),
  luckyAction: z.string(),
  gentleReminder: z.string(),
  dos: z.array(z.string()),
  donts: z.array(z.string()),
  luckyHour: z.string().optional(),
  reflections: z.array(z.string()).optional(),
  disclaimer: z.string(),
  aiGenerated: z.boolean(),
  generator: z.string(),
});
export type ReadingResult = z.infer<typeof ReadingResult>;

export interface GenerateInput {
  deity: { name: string; persona_prompt: string };
  topic: Topic;
  tier: Tier;
  question: string;
  library: Library;
  /** User's own feedback text, newest first. Empty when memory is off. */
  memories: string[];
  localDate: string;
  /** The user's app language; the reading text is written in it. */
  language: Lang;
  /** What the user told the deity in the conversation before the reading (see intake.ts). */
  intake?: { context: string; timeframe: string; goal: string } | null;
}

// --- Content rules (Appendix A) --------------------------------------------

const VAGUE = /\b(try to|try and|a bit|a little more|more often|as much as|feel the|feel your|somehow|maybe|perhaps|if possible|when you can|sometime)\b/i;

const VAGUE_ZH = /试着|試著|尝试|嘗試|一点点|一點點|多一些|也许|也許|或许|或許|尽量|盡量|有空的时候|有空的時候|感受/;

/** A lucky action must be one concrete, verifiable action doable today. */
export function isPreciseAction(s: string, lang: Lang = 'en-US'): boolean {
  if (isChinese(lang)) {
    if (VAGUE_ZH.test(s)) return false;
    if (!/今天|今日|今晚|之前|以前|前/.test(s)) return false;
    return s.length <= 120;
  }
  if (VAGUE.test(s)) return false;
  if (!/\b(today|tonight|before|by)\b/i.test(s)) return false;
  return s.length <= 260;
}

function checkOutput(o: ModelOutput): string | null {
  const text = [o.answer, o.lucky_action, o.gentle_reminder, o.deity_message, o.direction_note, ...o.dos, ...o.donts, ...o.reflections].join('\n');
  if (makesGuarantee(text)) return 'guarantee';
  if (mentionsAlcohol(text)) return 'alcohol';
  if (!screenQuestion(text).ok) return 'unsafe';
  return null;
}

const at = <T>(xs: T[], i: number) => xs[Math.min(Math.max(0, i), xs.length - 1)];

function assemble(o: ModelOutput, input: GenerateInput, generator: string): ReadingResult {
  const lib = input.library;
  return {
    deityMessage: o.deity_message,
    answer: o.answer,
    direction: { value: o.direction, note: o.direction_note },
    outfit: at(lib.outfits, o.outfit_index),
    shoes: at(lib.shoes, o.shoes_index),
    avoidColor: at(lib.colors, o.avoid_color_index),
    song: musicLinks(at(lib.songs, o.song_index)),
    drink: at(lib.drinks, o.drink_index),
    food: at(lib.foods, o.food_index),
    // Fall back to a vetted template if the model's action is not precise enough.
    luckyAction: isPreciseAction(o.lucky_action, input.language) ? o.lucky_action : lib.actions[0],
    gentleReminder: o.gentle_reminder,
    dos: o.dos,
    donts: o.donts,
    ...(input.tier !== 'standard' && o.lucky_hour ? { luckyHour: o.lucky_hour } : {}),
    ...(input.tier === 'deep' ? { reflections: o.reflections.slice(0, 3) } : {}),
    disclaimer: DISCLAIMER,
    aiGenerated: true,
    generator,
  };
}

// --- Claude ----------------------------------------------------------------

const CONTENT_RULES = `Content rules:
- This is light entertainment. Never promise outcomes ("you will get rich", "guaranteed"). Use hopeful, open language.
- Never give investment, medical, or legal advice. If the question asks for it, answer the feelings behind it and suggest talking to a qualified professional.
- No alcohol, gambling, or anything unsafe or illegal in any suggestion.
- lucky_action: ONE concrete action the user can finish today. Name an exact object, number, place, or time so it can be checked. No vague words such as "try to", "a bit", "more often", "feel", "maybe". Model it on the examples in the library.
- Only mention past conversations if they appear under "What the user told you before", and only quote them. Never invent anything the user did, said, or felt.
- dos and donts: 2–3 short items each, specific to today.
- Keep the answer to the user's question under 120 words for standard, 220 for detailed and deep.
- lucky_hour: a one-hour window like "2–3 p.m." (return "" for standard).
- reflections: three short questions for the deep tier; [] otherwise.`;

/** How the free-text fields are written. Library picks are indexes; the app translates those itself. */
export const LANGUAGE_RULE: Record<Lang, string> = {
  'en-US': "Write every text field in warm, plain American English, in the deity's voice.",
  'en-GB': "Write every text field in warm, plain British English (British spelling such as \"colour\" and \"favourite\"), in the deity's voice.",
  'zh-Hans': 'Write every text field (deity_message, answer, direction_note, lucky_action, gentle_reminder, dos, donts, lucky_hour, reflections) ' +
    "in natural Simplified Chinese (简体中文), warm and plain, in the deity's voice. Keep \"direction\" as one of its English enum values. " +
    'lucky_action must say when today it is done, for example "今天下午三点前".',
  'zh-Hant': 'Write every text field (deity_message, answer, direction_note, lucky_action, gentle_reminder, dos, donts, lucky_hour, reflections) ' +
    "in natural Traditional Chinese (繁體中文, Taiwan usage), warm and plain, in the deity's voice. Keep \"direction\" as one of its English enum values. " +
    'lucky_action must say when today it is done, for example "今天下午三點前".',
};

function intakeBlock(intake: GenerateInput['intake']): string {
  const lines = intake ? ([['Situation', intake.context], ['Timeframe', intake.timeframe], ['Hoping for', intake.goal]] as const).filter(([, v]) => v.trim()) : [];
  if (!lines.length) return 'What the user shared before the reading: nothing beyond the question.';
  return `What the user shared before the reading (summarized from their own words):\n${lines.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n` +
    'Use this to make the answer, dos/donts and lucky action specific to them. Do not add details they did not give.';
}

function buildPrompt(input: GenerateInput) {
  const l = input.library;
  const list = (xs: string[]) => xs.map((x, i) => `  ${i}. ${x}`).join('\n');
  const system = [
    input.deity.persona_prompt,
    'You give one-day fortune readings inside Fortune Muse, an entertainment app for adults in the US. Your output is rendered as a card, so return only the JSON object.',
    CONTENT_RULES,
    LANGUAGE_RULE[input.language],
  ].join('\n\n');

  const memoryBlock = input.memories.length
    ? `What the user told you before (their own words, newest first):\n${input.memories.map((m) => `- "${m}"`).join('\n')}`
    : 'What the user told you before: nothing. Do not refer to any past conversation.';

  const user = `Today is ${input.localDate}. Topic: ${input.topic}. Tier: ${input.tier}.

Library to pick from (answer with the index):
Outfits:
${list(l.outfits.map((o) => `${o.color} ${o.style}`))}
Shoes:
${list(l.shoes.map((o) => `${o.color} ${o.style}`))}
Colors (pick one to avoid today):
${list(l.colors)}
Songs:
${list(l.songs.map((s) => `${s.title} — ${s.artist}`))}
Drinks:
${list(l.drinks)}
Foods:
${list(l.foods)}
Example lucky actions (write a new one in this style, fitted to the question):
${list(l.actions)}

${memoryBlock}

${intakeBlock(input.intake)}

The user's question:
<question>
${input.question}
</question>`;
  return { system, user };
}

/** The reading from the model chosen in the admin console; null when that is the offline mock. */
async function generateWithModel(input: GenerateInput): Promise<ReadingResult | null> {
  const { system, user } = buildPrompt(input);
  const out = await generateJson('reading', {
    system, messages: [{ role: 'user', content: user }], schema: OUTPUT_JSON_SCHEMA, maxTokens: 8000, validate: (d) => ModelOutput.parse(d),
  });
  if (!out) return null;
  const problem = checkOutput(out.data);
  if (problem) throw new Error(`content_check_failed:${problem}`);
  return assemble(out.data, input, `${out.provider}:${out.model}`);
}

// --- Offline mock (no API key) ----------------------------------------------

function generateMock(input: GenerateInput): ReadingResult {
  const r = (n: number) => randomInt(Math.max(n, 1));
  const love = input.topic === 'love';
  const o: ModelOutput = {
    direction: DIRECTIONS[r(DIRECTIONS.length)],
    direction_note: love ? 'Sit facing this way when you send an important message.' : 'Face this way when you plan your day.',
    answer: love
      ? `The cards lean warm on this one. Small, honest gestures are favored today more than grand ones. Let your question — “${input.question.slice(0, 80)}” — guide one kind step, and notice how it is received.`
      : `The ledger shows steady ground. Today rewards preparation over bold leaps. Write down what you want from “${input.question.slice(0, 80)}” and take one small, practical step toward it.`,
    outfit_index: r(input.library.outfits.length),
    shoes_index: r(input.library.shoes.length),
    avoid_color_index: r(input.library.colors.length),
    song_index: r(input.library.songs.length),
    drink_index: r(input.library.drinks.length),
    food_index: r(input.library.foods.length),
    lucky_action: input.library.actions[0] ?? 'Before noon today, write one goal on a sticky note and put it on your laptop.',
    gentle_reminder: 'Luck likes a rested mind. Drink some water and be kind to yourself today.',
    dos: love ? ['Say thank you out loud once', 'Reply to one message warmly'] : ['Tidy one small workspace', 'Review one bill or receipt'],
    donts: love ? ['Overthink a single text', 'Compare your story to others'] : ['Make an impulse purchase', 'Skip lunch'],
    lucky_hour: '2–3 p.m.',
    reflections: ['What would make today feel like a win?', 'Who could you thank this week?', 'What is one thing you can let go of?'],
    deity_message: `${input.deity.name} smiles: a good day starts with one good step.`,
  };
  return assemble(o, input, 'mock');
}

export async function generateReading(input: GenerateInput): Promise<ReadingResult> {
  return (await generateWithModel(input)) ?? generateMock(input);
}

export const _test = { buildPrompt, checkOutput, generateMock };
/** For docs/PROMPTS.md (npm run prompts:doc). */
export const _prompts = { CONTENT_RULES, OUTPUT_JSON_SCHEMA, buildPrompt };
