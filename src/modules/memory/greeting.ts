import { daysBetween, localDate } from '../../lib/time.js';

export interface MemoryRow { content: string; mood_tag: string | null; created_at: Date }

const MOOD_FOLLOW_UP: Record<string, string> = {
  low: 'Are you feeling any lighter today?',
  happy: 'I hope some of that good feeling stuck around.',
  calm: 'I hope today feels just as steady.',
  surprised: 'Did anything else unexpected happen since?',
  hopeful: 'Let us see if today brings you a step closer.',
};

function when(days: number, at: Date, tz: string): string {
  if (days === 1) return 'Yesterday';
  if (days < 7) return `On ${new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(at)}`;
  return `${days} days ago`;
}

function quote(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

/**
 * Builds the deity's greeting. It may only reference what the user wrote in a feedback entry
 * (plan §M5): the quote is the user's own words, and the rest is fixed template text, so
 * nothing about the user can be invented. With no memory (or memory off) it is the plain welcome.
 */
export function buildGreeting(opts: { deityGreeting: string; memory: MemoryRow | null; tz: string; now?: Date }) {
  const { deityGreeting, memory, tz } = opts;
  if (!memory) return { text: deityGreeting, memoryRef: null };
  const days = daysBetween(localDate(tz, memory.created_at), localDate(tz, opts.now));
  if (days < 1 || days > 7) return { text: deityGreeting, memoryRef: null };

  const parts: string[] = [];
  const lead = when(days, memory.created_at, tz);
  if (memory.content) {
    parts.push(`${lead} you told me: “${quote(memory.content)}”`);
  } else if (memory.mood_tag) {
    parts.push(`${lead} you said you were feeling ${memory.mood_tag === 'low' ? 'a little low' : memory.mood_tag}.`);
  }
  parts.push(MOOD_FOLLOW_UP[memory.mood_tag ?? ''] ?? 'How are things today?');
  parts.push('Come, let us draw a fresh fortune.');
  return { text: parts.join(' '), memoryRef: { createdAt: memory.created_at, source: 'feedback' as const } };
}
