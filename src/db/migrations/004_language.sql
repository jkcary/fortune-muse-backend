-- App language: en-US, en-GB, zh-Hans (Simplified Chinese), zh-Hant (Traditional Chinese).
UPDATE users SET language = 'en-US' WHERE language NOT IN ('en-US','en-GB','zh-Hans','zh-Hant');
ALTER TABLE users ALTER COLUMN language SET DEFAULT 'en-US';
ALTER TABLE users ADD CONSTRAINT users_language_check CHECK (language IN ('en-US','en-GB','zh-Hans','zh-Hant'));
