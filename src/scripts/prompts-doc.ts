/**
 * Writes docs/PROMPTS.md from the code, so the reviewed text is exactly what the API sends.
 * Run: npm run prompts:doc
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEITIES } from '../db/seedData.js';
import { LANGUAGES } from '../lib/i18n.js';
import { buildGreeting, TEMPLATES } from '../modules/memory/greeting.js';
import { _prompts, LANGUAGE_RULE } from '../modules/readings/generator.js';
import {
  buildIntakeSystem, INTAKE_JSON_SCHEMA, INTAKE_LANGUAGE, MAX_ANSWERS, MOCK_SCRIPT, START_NOTE, USER_MAX,
} from '../modules/readings/intake.js';

const fence = (s: string, lang = '') => `\`\`\`${lang}\n${s}\n\`\`\``;
const json = (o: unknown) => fence(JSON.stringify(o, null, 2), 'json');
const bao = DEITIES[0];

const exampleLibrary = {
  songs: [{ title: 'Lovely Day', artist: 'Bill Withers' }], drinks: ['Matcha latte'], foods: ['Pan-fried dumplings'],
  outfits: [{ style: 'Tailored blazer', color: 'navy' }], shoes: [{ style: 'Loafers', color: 'brown' }], colors: ['olive'],
  actions: ['Before noon today, write down your three largest expenses from last week on one sheet of paper.'],
};
const example = _prompts.buildPrompt({
  deity: bao, topic: 'wealth', tier: 'deep', question: 'Is this a good week to ask for a raise?', library: exampleLibrary,
  memories: ['I finally finished the big project!'], localDate: '2026-11-02', language: 'zh-Hans',
  intake: { context: 'Annual review is on Friday; I led the Q3 launch', timeframe: 'This week', goal: 'A 5% raise' },
});

const memory = { content: 'I finally finished the big project!', mood_tag: 'happy', created_at: new Date('2026-11-01T15:00:00Z') };
const now = new Date('2026-11-02T15:00:00Z');

const doc = `# Fortune Muse: AI prompts

Generated from the code by \`npm run prompts:doc\`. Do not edit by hand; change the code and regenerate.

Model: \`ANTHROPIC_MODEL\` (default \`claude-opus-5-5\`), effort \`ANTHROPIC_EFFORT\` (default \`low\`), structured JSON output, server-side fallback enabled.
Without \`ANTHROPIC_API_KEY\` the app uses the scripted mock replies listed below.

There are three places where text is produced for the user:

1. **Intake conversation**: the spirit asks a few questions before the reading (free).
2. **Reading generation**: the fortune itself (charged).
3. **Memory greeting**: fixed templates, no AI; shown on Home when the user shared something in the last 7 days.

Every user message is screened for crisis and violence wording (English and Chinese) before any AI call; a match returns help resources (988, Crisis Text Line, 911, Domestic Violence Hotline) instead of a reply. Model output is screened again for guarantees, alcohol and unsafe content.

---

## 1. Intake conversation (\`POST /readings/intake\`)

The app shows the spirit's greeting and an opening line, the user types or speaks, and each turn is sent with the whole transcript.
Limits: user messages up to ${USER_MAX} characters; after ${MAX_ANSWERS} user answers the spirit stops asking and the reading can start. The user can tap "Start the reading now" at any time.

### System prompt (example: ${bao.name}, wealth, Simplified Chinese)

The first paragraph is the spirit's persona from the database; the language line at the end changes with the app language.

${fence(buildIntakeSystem(bao.persona_prompt, 'wealth', 'zh-Hans'))}

Language line per app language:

${LANGUAGES.map((l) => `- \`${l}\`: ${INTAKE_LANGUAGE[l]}`).join('\n')}

Topic wording: wealth → "wealth and money", love → "love and relationships".

### Messages

The transcript is sent as alternating user/assistant messages, starting with the user's first message. When the user taps "Start the reading now", this is added as (or appended to) the last user message:

${fence(START_NOTE)}

### Output schema

${json(INTAKE_JSON_SCHEMA)}

The summary (\`question\`, \`context\`, \`timeframe\`, \`goal\`) becomes the reading's question and the "What the user shared" block below.

### Mock replies (no API key)

Asked in order after the user's 1st, 2nd and 3rd message; after the 4th (or "Start now") the ready line is shown. The summary is the user's answers in order: question, context, timeframe, goal.

${LANGUAGES.map((l) => `**${l}**\n\n${MOCK_SCRIPT[l].ask.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nReady: ${MOCK_SCRIPT[l].ready}`).join('\n\n')}

---

## 2. Reading generation (after payment)

### System prompt

Persona + framing + content rules + language rule:

${fence([bao.persona_prompt, 'You give one-day fortune readings inside Fortune Muse, an entertainment app for adults in the US. Your output is rendered as a card, so return only the JSON object.', _prompts.CONTENT_RULES, '<language rule, see below>'].join('\n\n'))}

Language rule per app language:

${LANGUAGES.map((l) => `- \`${l}\`: ${LANGUAGE_RULE[l]}`).join('\n')}

### User message (example: deep tier, Simplified Chinese, with memory and intake)

The library lists are a random slice of the content library (outfits, shoes, colors, songs, drinks, foods, example actions); the model answers with indexes so every pick comes from vetted content.

${fence(example.user)}

When memory is off or empty, the memory block reads: \`What the user told you before: nothing. Do not refer to any past conversation.\`
Without an intake conversation: \`What the user shared before the reading: nothing beyond the question.\`

### Output schema

${json(_prompts.OUTPUT_JSON_SCHEMA)}

### Checks after generation

- Guarantees ("guaranteed", "you will get rich", 稳赚, 保证会…), alcohol, and crisis/violence wording: the reading is regenerated once, then refunded.
- The lucky action must be concrete and doable today (English: no "try to / a bit / maybe", must say today/before/by; Chinese: no 试着/尽量/也许…, must say 今天/今晚/之前…). Otherwise a vetted library action is used.
- The card always shows "For entertainment purposes only. Not financial, medical, or legal advice." and an AI-generated label.

---

## 3. Memory greeting (no AI)

Only the user's own words are quoted; everything else is fixed text. Example (yesterday, mood "happy"):

${LANGUAGES.map((l) => `- \`${l}\`: ${buildGreeting({ deityGreeting: '', memory, tz: 'UTC', now, lang: l }).text}`).join('\n')}

Follow-up line by mood (en-US / zh-Hans):

${(['low', 'happy', 'calm', 'surprised', 'hopeful'] as const).map((m) => `- ${m}: ${TEMPLATES['en-US'].followUp[m]} / ${TEMPLATES['zh-Hans'].followUp[m]}`).join('\n')}

---

## Spirit personas (database, editable in the admin console)

${DEITIES.map((d) => `**${d.name}** (${d.id}). Greeting: "${d.greeting}"\n\n${fence(d.persona_prompt)}`).join('\n\n')}
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'PROMPTS.md');
writeFileSync(out, doc);
console.log(`wrote ${out}`);
