import { z } from 'zod';
import type { Lang } from '../../lib/i18n.js';
import { makesGuarantee, mentionsAlcohol, screenQuestion } from '../safety/safety.js';
import type { Topic } from './catalog.js';
import { generateJson } from '../ai/llm.js';

/**
 * The conversation before a reading: the deity asks a few short questions to understand
 * what the user wants to know, then hands a summary to the reading generator. Chatting is free;
 * only the reading is charged. The transcript is stored with the reading.
 */

/** User answers after which the deity stops asking and the reading can start. */
export const MAX_ANSWERS = 4;
export const USER_MAX = 200;

export const Turn = z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(600) });
export type Turn = z.infer<typeof Turn>;

export const Summary = z.object({
  question: z.string().max(USER_MAX),
  context: z.string().max(400),
  timeframe: z.string().max(120),
  goal: z.string().max(240),
});
export type Summary = z.infer<typeof Summary>;

const ModelTurn = z.object({ reply: z.string().min(1).max(400), ready: z.boolean(), summary: Summary });
export type IntakeReply = z.infer<typeof ModelTurn> & { generator: string };

export const INTAKE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'ready', 'summary'],
  properties: {
    reply: { type: 'string' },
    ready: { type: 'boolean' },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'context', 'timeframe', 'goal'],
      properties: {
        question: { type: 'string' },
        context: { type: 'string' },
        timeframe: { type: 'string' },
        goal: { type: 'string' },
      },
    },
  },
};

export const INTAKE_LANGUAGE: Record<Lang, string> = {
  'en-US': 'Write reply and summary in warm, plain American English.',
  'en-GB': 'Write reply and summary in warm, plain British English (British spelling).',
  'zh-Hans': 'Write reply and summary in natural Simplified Chinese (简体中文).',
  'zh-Hant': 'Write reply and summary in natural Traditional Chinese (繁體中文, Taiwan usage).',
};

const TOPIC_NAME: Record<Topic, string> = { wealth: 'wealth and money', love: 'love and relationships' };

export function buildIntakeSystem(persona: string, topic: Topic, lang: Lang): string {
  return `${persona}

You are opening a ${TOPIC_NAME[topic]} reading in Fortune Muse, an entertainment app for adults in the US. Before the reading, have a short, warm conversation to understand what the user wants to know. The reading itself comes later: do not give the fortune, advice or predictions now.

Find out, one short question per turn:
1. The core question: what exactly they want to know.
2. Their situation: what is going on right now.
3. Timeframe: when this matters (today, this week, this month, further out).
4. What they hope for, or what they have tried or are weighing.
5. How they feel about it (only if it comes up naturally).

Rules:
- Ask ONE short question per turn (under 30 words), in your own voice. Briefly acknowledge what they just said first.
- Do not ask for anything they already told you. Skip what does not apply.
- Never ask for names, contact details, addresses, birth dates, account numbers or other identifying or financial account details.
- No predictions, no guarantees, no investment, medical or legal advice. If they ask for that, kindly say the reading is for fun and that a qualified professional can help with real decisions.
- Set ready=true when you know the core question and enough context, after ${MAX_ANSWERS} answers from the user, or when the user asks to start. When ready, reply with one short line inviting them to choose their reading.
- summary.question: the user's question as one sentence in their own terms (max ${USER_MAX} characters). summary.context, summary.timeframe, summary.goal: short notes taken only from what they said, or "" if unknown. Never invent details. While not ready, fill what you know so far.
${INTAKE_LANGUAGE[lang]}`;
}

/** Note appended when the user taps "Start the reading now". */
export const START_NOTE = '(The user tapped "Start the reading now". Set ready=true and summarize what you have.)';

/** Claude messages from the transcript. The first deity line is UI-only, so the transcript starts with the user. */
export function buildIntakeMessages(turns: Turn[], start: boolean) {
  const messages = turns.map((t) => ({ role: t.role, content: t.text }));
  if (start) {
    const last = messages.at(-1);
    if (last?.role === 'user') last.content = `${last.content}\n\n${START_NOTE}`;
    else messages.push({ role: 'user', content: START_NOTE });
  }
  return messages;
}

// --- Offline mock (no API key): a fixed script in every language ------------------

export const MOCK_SCRIPT: Record<Lang, { ask: [string, string, string]; ready: string }> = {
  'en-US': {
    ask: [
      'Thank you for telling me. What is going on around this right now?',
      'I see. When does this matter most: today, this week, or further out?',
      'And what would a good outcome look like for you?',
    ],
    ready: 'I have what I need. Choose your reading and I will draw your fortune.',
  },
  'en-GB': {
    ask: [
      'Thank you for telling me. What is going on around this at the moment?',
      'I see. When does this matter most: today, this week, or further out?',
      'And what would a good outcome look like for you?',
    ],
    ready: 'I have what I need. Choose your reading and I will draw your fortune.',
  },
  'zh-Hans': {
    ask: ['谢谢你告诉我。现在这件事的情况是怎样的？', '明白了。这件事什么时候最要紧：今天、这周，还是更久以后？', '那你心里最希望的结果是什么？'],
    ready: '我都了解了。选好签的类型，我就为你抽签。',
  },
  'zh-Hant': {
    ask: ['謝謝你告訴我。現在這件事的情況是怎樣的？', '明白了。這件事什麼時候最要緊：今天、這週，還是更久以後？', '那你心裡最希望的結果是什麼？'],
    ready: '我都了解了。選好籤的類型，我就為你抽籤。',
  },
};

export function mockIntake(turns: Turn[], lang: Lang, start: boolean): IntakeReply {
  const answers = turns.filter((t) => t.role === 'user').map((t) => t.text);
  const [question = '', context = '', timeframe = '', goal = ''] = answers;
  const summary = { question: question.slice(0, USER_MAX), context: context.slice(0, 400), timeframe: timeframe.slice(0, 120), goal: goal.slice(0, 240) };
  const script = MOCK_SCRIPT[lang];
  const ready = start || answers.length > script.ask.length;
  return { reply: ready ? script.ready : script.ask[answers.length - 1], ready, summary, generator: 'mock' };
}

// --- Entry point -------------------------------------------------------------

export type IntakeResult = IntakeReply | { safety: 'crisis' | 'violence' };

export async function runIntake(opts: {
  deity: { persona_prompt: string }; topic: Topic; lang: Lang; turns: Turn[]; start: boolean;
}): Promise<IntakeResult> {
  for (const t of opts.turns) {
    if (t.role !== 'user') continue;
    const verdict = screenQuestion(t.text);
    if (!verdict.ok) return { safety: verdict.kind };
  }
  const answers = opts.turns.filter((t) => t.role === 'user').length;
  const start = opts.start || answers >= MAX_ANSWERS;

  try {
    const res = await generateJson('intake', {
      system: buildIntakeSystem(opts.deity.persona_prompt, opts.topic, opts.lang),
      messages: buildIntakeMessages(opts.turns, start),
      schema: INTAKE_JSON_SCHEMA,
      maxTokens: 1500,
      validate: (d) => ModelTurn.parse(d),
    });
    if (!res) return mockIntake(opts.turns, opts.lang, start);
    const out = res.data;
    if (makesGuarantee(out.reply) || mentionsAlcohol(out.reply) || !screenQuestion(out.reply).ok) throw new Error('content_check_failed');
    // The first answer is always the core question; keep it if the model returned none.
    const first = opts.turns.find((t) => t.role === 'user')?.text ?? '';
    const question = (out.summary.question.trim() || first).slice(0, USER_MAX);
    return { ...out, ready: out.ready || start, summary: { ...out.summary, question }, generator: `${res.provider}:${res.model}` };
  } catch {
    // Keep the conversation going with the scripted question rather than failing the screen.
    return mockIntake(opts.turns, opts.lang, start);
  }
}
