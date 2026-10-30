/**
 * Safety checks for user questions and chat (plan §M3 / §M7).
 * Keyword screening is the first line; the AI prompt carries its own safety rules,
 * and the generated result is screened again before it is stored.
 */

const CRISIS_PATTERNS = [
  /\bkill(ing)? my ?self\b/i, /\bsuicid/i, /\bend (it all|my life)\b/i, /\bwant to die\b/i,
  /\bself[- ]?harm/i, /\bcut(ting)? myself\b/i, /\bno reason to live\b/i, /\bhurt myself\b/i,
  /\boverdose\b/i,
];
const VIOLENCE_PATTERNS = [
  /\bkill (him|her|them|someone|my (ex|boss|wife|husband|partner))\b/i, /\bhurt (him|her|them|someone)\b/i,
  /\bshoot(ing)? (up|someone)\b/i, /\bpoison (him|her|them)\b/i, /\brevenge\b.*\b(hurt|kill)\b/i,
];

export type SafetyVerdict = { ok: true } | { ok: false; kind: 'crisis' | 'violence' };

export function screenQuestion(text: string): SafetyVerdict {
  if (CRISIS_PATTERNS.some((p) => p.test(text))) return { ok: false, kind: 'crisis' };
  if (VIOLENCE_PATTERNS.some((p) => p.test(text))) return { ok: false, kind: 'violence' };
  return { ok: true };
}

/** US help resources shown instead of a reading. */
export const HELP_RESOURCES = {
  crisis: {
    message:
      "It sounds like you're carrying something heavy right now. Fortune Muse is just for fun, so we won't give a reading on this — but you don't have to go through it alone. Please reach out to someone who can help right now.",
    resources: [
      { name: '988 Suicide & Crisis Lifeline', detail: 'Call or text 988 (24/7, free, confidential)', url: 'https://988lifeline.org' },
      { name: 'Crisis Text Line', detail: 'Text HOME to 741741', url: 'https://www.crisistextline.org' },
      { name: 'Emergency', detail: 'If you are in immediate danger, call 911', url: 'tel:911' },
    ],
  },
  violence: {
    message:
      "We can't give a reading on this. If you or someone else is in danger, please contact emergency services or a support line now.",
    resources: [
      { name: 'Emergency', detail: 'Call 911', url: 'tel:911' },
      { name: 'National Domestic Violence Hotline', detail: 'Call 1-800-799-7233 or text START to 88788', url: 'https://www.thehotline.org' },
      { name: '988 Suicide & Crisis Lifeline', detail: 'Call or text 988', url: 'https://988lifeline.org' },
    ],
  },
} as const;

// --- Chat moderation -------------------------------------------------------

// A short starter list; the production list lives in the admin content tools.
const BLOCKED_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'retard', 'whore', 'slut'];
const CONTACT_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/, // emails
  /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/, // US phone numbers
  /\b(venmo|cashapp|cash app|zelle|paypal\.me|onlyfans)\b/i,
  /https?:\/\//i, // links
];

export function moderateChat(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > 500) return { ok: false, reason: 'too_long' };
  if (CONTACT_PATTERNS.some((p) => p.test(trimmed))) return { ok: false, reason: 'contact_info' };
  if (screenQuestion(trimmed).ok === false) return { ok: false, reason: 'safety' };
  let masked = trimmed;
  for (const w of BLOCKED_WORDS) masked = masked.replace(new RegExp(`\\b${w}\\w*`, 'gi'), (m) => '*'.repeat(m.length));
  return { ok: true, text: masked };
}

const ALCOHOL = /\b(beer|wine|champagne|prosecco|whisk(e)?y|vodka|rum|gin|tequila|sake|soju|cocktail|margarita|mojito|sangria|mimosa|liquor|baijiu|bourbon|brandy|cider|ale|lager|spritz)\b/i;
export const mentionsAlcohol = (s: string) => ALCOHOL.test(s);

const GUARANTEES = /\b(guarantee[sd]?|definitely will|will certainly|100% (sure|certain)|for sure you will|you will (get rich|win|be rich))\b/i;
export const makesGuarantee = (s: string) => GUARANTEES.test(s);
