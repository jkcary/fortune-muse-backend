import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * AES-256-GCM for secrets stored in the database (provider API keys).
 * The key comes from SETTINGS_ENCRYPTION_KEY; development falls back to one derived from JWT_SECRET.
 */
function key(): Buffer {
  if (config.SETTINGS_ENCRYPTION_KEY) return createHash('sha256').update(config.SETTINGS_ENCRYPTION_KEY).digest();
  if (config.NODE_ENV === 'production') throw new Error('SETTINGS_ENCRYPTION_KEY must be set to store API keys');
  return createHash('sha256').update(`dev-settings:${config.JWT_SECRET}`).digest();
}

/** Returns "iv.tag.ciphertext", each base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
