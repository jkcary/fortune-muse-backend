import type { Lang } from '../../lib/i18n.js';
import { daysBetween, localDate } from '../../lib/time.js';

export interface MemoryRow { content: string; mood_tag: string | null; created_at: Date }

type Moods = 'low' | 'happy' | 'calm' | 'surprised' | 'hopeful';

/** Fixed template text per language. Only the user's own quote is ever inserted. */
interface Templates {
  locale: string;
  yesterday: string;
  onDay: (weekday: string) => string;
  daysAgo: (n: number) => string;
  told: (lead: string, quote: string) => string;
  felt: (lead: string, mood: string) => string;
  mood: Record<Moods, string>;
  followUp: Record<Moods, string>;
  howAreThings: string;
  freshFortune: string;
}

const EN: Templates = {
  locale: 'en-US',
  yesterday: 'Yesterday',
  onDay: (d) => `On ${d}`,
  daysAgo: (n) => `${n} days ago`,
  told: (lead, q) => `${lead} you told me: “${q}”`,
  felt: (lead, m) => `${lead} you said you were feeling ${m}.`,
  mood: { low: 'a little low', happy: 'happy', calm: 'calm', surprised: 'surprised', hopeful: 'hopeful' },
  followUp: {
    low: 'Are you feeling any lighter today?',
    happy: 'I hope some of that good feeling stuck around.',
    calm: 'I hope today feels just as steady.',
    surprised: 'Did anything else unexpected happen since?',
    hopeful: 'Let us see if today brings you a step closer.',
  },
  howAreThings: 'How are things today?',
  freshFortune: 'Come, let us draw a fresh fortune.',
};

const TEMPLATES: Record<Lang, Templates> = {
  'en-US': EN,
  'en-GB': { ...EN, locale: 'en-GB' },
  'zh-Hans': {
    locale: 'zh-Hans',
    yesterday: '昨天',
    onDay: (d) => d,
    daysAgo: (n) => `${n} 天前`,
    told: (lead, q) => `${lead}你跟我说：“${q}”`,
    felt: (lead, m) => `${lead}你说你感觉${m}。`,
    mood: { low: '有点低落', happy: '很开心', calm: '很平静', surprised: '很意外', hopeful: '充满希望' },
    followUp: {
      low: '今天心情有没有轻松一些？',
      happy: '希望那份好心情还在。',
      calm: '希望今天也一样安稳。',
      surprised: '之后还有什么意想不到的事吗？',
      hopeful: '看看今天能不能让你更近一步。',
    },
    howAreThings: '今天过得怎么样？',
    freshFortune: '来，我们抽一支新签吧。',
  },
  'zh-Hant': {
    locale: 'zh-Hant',
    yesterday: '昨天',
    onDay: (d) => d,
    daysAgo: (n) => `${n} 天前`,
    told: (lead, q) => `${lead}你跟我說：「${q}」`,
    felt: (lead, m) => `${lead}你說你感覺${m}。`,
    mood: { low: '有點低落', happy: '很開心', calm: '很平靜', surprised: '很意外', hopeful: '充滿希望' },
    followUp: {
      low: '今天心情有沒有輕鬆一些？',
      happy: '希望那份好心情還在。',
      calm: '希望今天也一樣安穩。',
      surprised: '之後還有什麼意想不到的事嗎？',
      hopeful: '看看今天能不能讓你更近一步。',
    },
    howAreThings: '今天過得怎麼樣？',
    freshFortune: '來，我們抽一支新籤吧。',
  },
};

function when(t: Templates, days: number, at: Date, tz: string): string {
  if (days === 1) return t.yesterday;
  if (days < 7) return t.onDay(new Intl.DateTimeFormat(t.locale, { weekday: 'long', timeZone: tz }).format(at));
  return t.daysAgo(days);
}

function quote(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

/**
 * Builds the deity's greeting. It may only reference what the user wrote in a feedback entry
 * (plan §M5): the quote is the user's own words, and the rest is fixed template text, so
 * nothing about the user can be invented. With no memory (or memory off) it is the plain welcome,
 * which the app translates itself (memoryRef null).
 */
export function buildGreeting(opts: { deityGreeting: string; memory: MemoryRow | null; tz: string; now?: Date; lang?: Lang }) {
  const { deityGreeting, memory, tz } = opts;
  const t = TEMPLATES[opts.lang ?? 'en-US'];
  if (!memory) return { text: deityGreeting, memoryRef: null };
  const days = daysBetween(localDate(tz, memory.created_at), localDate(tz, opts.now));
  if (days < 1 || days > 7) return { text: deityGreeting, memoryRef: null };

  const parts: string[] = [];
  const lead = when(t, days, memory.created_at, tz);
  const mood = memory.mood_tag as Moods | null;
  if (memory.content) {
    parts.push(t.told(lead, quote(memory.content)));
  } else if (mood && t.mood[mood]) {
    parts.push(t.felt(lead, t.mood[mood]));
  }
  parts.push((mood && t.followUp[mood]) || t.howAreThings);
  parts.push(t.freshFortune);
  const sep = opts.lang === 'zh-Hans' || opts.lang === 'zh-Hant' ? '' : ' ';
  return { text: parts.join(sep), memoryRef: { createdAt: memory.created_at, source: 'feedback' as const } };
}
