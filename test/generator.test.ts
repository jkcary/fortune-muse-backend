import { describe, expect, it } from 'vitest';
import { _test, isPreciseAction } from '../src/modules/readings/generator.js';
import { buildGreeting } from '../src/modules/memory/greeting.js';
import { clusterQuestion } from '../src/modules/readings/catalog.js';
import { moderateChat, screenQuestion } from '../src/modules/safety/safety.js';

const lib = { songs: [{ title: 'Lovely Day', artist: 'Bill Withers' }], drinks: ['Matcha latte'], foods: ['Dumplings'], outfits: [{ style: 'Blazer', color: 'navy' }], shoes: [{ style: 'Loafers', color: 'brown' }], colors: ['olive'], actions: ['Before noon today, write one goal on a sticky note.'] };
const base = { deity: { name: 'Master Bao', persona_prompt: 'You are Master Bao.' }, topic: 'wealth' as const, tier: 'standard' as const, question: 'Raise?', library: lib, localDate: '2026-10-30', language: 'en-US' as const };

describe('prompt', () => {
  it('tells the model there is no past when memory is empty', () => {
    const { user } = _test.buildPrompt({ ...base, memories: [] });
    expect(user).toContain('Do not refer to any past conversation');
  });
  it('includes only the user’s own words as memory', () => {
    const { user } = _test.buildPrompt({ ...base, memories: ['I got the job!'] });
    expect(user).toContain('- "I got the job!"');
  });
});

describe('language', () => {
  it('asks the model to write in the user’s language', () => {
    expect(_test.buildPrompt({ ...base, memories: [], language: 'zh-Hans' }).system).toContain('Simplified Chinese');
    expect(_test.buildPrompt({ ...base, memories: [], language: 'zh-Hant' }).system).toContain('Traditional Chinese');
    expect(_test.buildPrompt({ ...base, memories: [], language: 'en-GB' }).system).toContain('British English');
    expect(_test.buildPrompt({ ...base, memories: [] }).system).toContain('American English');
  });
  it('checks Chinese lucky actions for a time today and no vague words', () => {
    expect(isPreciseAction('今天下午三点前，把桌面上最旧的文件夹改成三个字的名字。', 'zh-Hans')).toBe(true);
    expect(isPreciseAction('试着多一些积极的想法。', 'zh-Hans')).toBe(false);
  });
  it('writes the memory greeting in the user’s language', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const memory = { content: '我拿到工作了！', mood_tag: 'happy', created_at: new Date('2026-10-29T12:00:00Z') };
    expect(buildGreeting({ deityGreeting: 'Hello!', memory, tz: 'UTC', now, lang: 'zh-Hans' }).text).toBe('昨天你跟我说：“我拿到工作了！”希望那份好心情还在。来，我们抽一支新签吧。');
    expect(buildGreeting({ deityGreeting: 'Hello!', memory, tz: 'UTC', now, lang: 'zh-Hant' }).text).toContain('你跟我說：「我拿到工作了！」');
  });
});

describe('content rules (Appendix A)', () => {
  it('accepts precise actions and rejects vague ones', () => {
    expect(isPreciseAction('Before 3 p.m. today, rename one folder on your desktop to a three-word name.')).toBe(true);
    expect(isPreciseAction('Try to be a bit more positive.')).toBe(false);
  });
  it('rejects guarantees and alcohol in model output', () => {
    const ok = { direction: 'East', direction_note: 'n', answer: 'a', outfit_index: 0, shoes_index: 0, avoid_color_index: 0, song_index: 0, drink_index: 0, food_index: 0, lucky_action: 'x', gentle_reminder: 'g', dos: ['d'], donts: ['d'], lucky_hour: '', reflections: [], deity_message: 'm' } as const;
    expect(_test.checkOutput({ ...ok })).toBeNull();
    expect(_test.checkOutput({ ...ok, answer: 'You will get rich, guaranteed.' })).toBe('guarantee');
    expect(_test.checkOutput({ ...ok, dos: ['Celebrate with champagne'] })).toBe('alcohol');
  });
});

describe('greeting', () => {
  it('never mentions the past without a memory', () => {
    expect(buildGreeting({ deityGreeting: 'Hello!', memory: null, tz: 'UTC' }).text).toBe('Hello!');
  });
  it('ignores memories older than a week', () => {
    const old = { content: 'old news', mood_tag: null, created_at: new Date(Date.now() - 10 * 86400000) };
    expect(buildGreeting({ deityGreeting: 'Hello!', memory: old, tz: 'UTC' }).memoryRef).toBeNull();
  });
});

describe('matching and safety', () => {
  it('clusters similar questions together', () => {
    expect(clusterQuestion('wealth', 'Should I ask for a raise?').id).toBe('raise');
    expect(clusterQuestion('love', 'Should I text my ex?').id).toBe('ex');
    expect(clusterQuestion('love', 'What does the universe say?').id).toBe('general');
  });
  it('screens crisis language and contact sharing', () => {
    expect(screenQuestion('I want to end my life').ok).toBe(false);
    expect(moderateChat('add me on venmo').ok).toBe(false);
    expect(moderateChat('this is shit').ok && (moderateChat('this is shit') as any).text).toBe('this is ****');
  });
});
