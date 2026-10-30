import { z } from 'zod';

/** App languages. Stored on users.language; readings and greetings are written in it. */
export const LANGUAGES = ['en-US', 'en-GB', 'zh-Hans', 'zh-Hant'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const Language = z.enum(LANGUAGES);

export const asLang = (v: unknown): Lang => (LANGUAGES as readonly unknown[]).includes(v) ? (v as Lang) : 'en-US';
export const isChinese = (l: Lang) => l === 'zh-Hans' || l === 'zh-Hant';
