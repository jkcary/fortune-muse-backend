import { config } from '../../config.js';
import { many, one, pool } from '../../db/pool.js';
import { decrypt, encrypt } from '../../lib/secrets.js';
import { PROVIDER_IDS, PROVIDERS, providerInfo, type ProviderId } from './providers.js';

/** The two places the app calls a model. Each can use its own provider and model. */
export const TASKS = ['intake', 'reading'] as const;
export type Task = (typeof TASKS)[number];

export interface TaskConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number | null;
  maxTokens: number | null;
}
export interface ResolvedConfig extends TaskConfig { apiKey: string | null }

/** Before an admin saves anything: Claude when ANTHROPIC_API_KEY is set (the original setup), else the offline mock. */
export function defaultConfig(): TaskConfig {
  return config.ANTHROPIC_API_KEY
    ? { provider: 'anthropic', model: config.ANTHROPIC_MODEL, baseUrl: PROVIDERS.anthropic.baseUrl, temperature: null, maxTokens: null }
    : { provider: 'mock', model: '', baseUrl: '', temperature: null, maxTokens: null };
}

let cache: { at: number; rows: Map<Task, TaskConfig> } | null = null;
const invalidate = () => { cache = null; };

async function rows(): Promise<Map<Task, TaskConfig>> {
  if (cache && Date.now() - cache.at < 5000) return cache.rows;
  const list = await many<{ task: Task; provider: string; model: string; base_url: string | null; temperature: number | null; max_tokens: number | null }>(
    pool, 'SELECT task, provider, model, base_url, temperature, max_tokens FROM ai_settings');
  const map = new Map<Task, TaskConfig>();
  for (const r of list) {
    if (!PROVIDER_IDS.includes(r.provider as ProviderId)) continue;
    const p = r.provider as ProviderId;
    map.set(r.task, { provider: p, model: r.model, baseUrl: r.base_url || PROVIDERS[p].baseUrl, temperature: r.temperature, maxTokens: r.max_tokens });
  }
  cache = { at: Date.now(), rows: map };
  return map;
}

export async function getTaskConfig(task: Task): Promise<TaskConfig> {
  return (await rows()).get(task) ?? defaultConfig();
}

/** A key saved in the console wins over the provider's env var. */
export async function resolveKey(provider: ProviderId): Promise<string | null> {
  const row = await one<{ ciphertext: string }>(pool, 'SELECT ciphertext FROM ai_keys WHERE provider=$1', [provider]);
  if (row) return decrypt(row.ciphertext);
  const env = providerInfo(provider).keyEnv;
  return (env && process.env[env]) || (provider === 'anthropic' ? config.ANTHROPIC_API_KEY || null : null);
}

export async function resolveTask(task: Task): Promise<ResolvedConfig> {
  const cfg = await getTaskConfig(task);
  return { ...cfg, apiKey: cfg.provider === 'mock' ? null : await resolveKey(cfg.provider) };
}

/** Where each provider's key comes from, for the console. Never the key itself. */
export async function keyStatus(): Promise<Record<string, { source: 'console' | 'env' | null; last4: string | null; env: string | null }>> {
  const saved = new Map((await many<{ provider: string; last4: string }>(pool, 'SELECT provider, last4 FROM ai_keys')).map((r) => [r.provider, r.last4]));
  const out: Record<string, { source: 'console' | 'env' | null; last4: string | null; env: string | null }> = {};
  for (const id of PROVIDER_IDS) {
    if (id === 'mock') continue;
    const env = providerInfo(id).keyEnv ?? null;
    const envValue = (env && process.env[env]) || (id === 'anthropic' ? config.ANTHROPIC_API_KEY : '');
    out[id] = saved.has(id) ? { source: 'console', last4: saved.get(id)!, env }
      : envValue ? { source: 'env', last4: envValue.slice(-4), env } : { source: null, last4: null, env };
  }
  return out;
}

export async function audit(adminId: string, action: string, details: Record<string, unknown>) {
  await pool.query('INSERT INTO admin_audit(admin_id, action, details) VALUES ($1,$2,$3)', [adminId, action, details]);
}

export async function saveTaskConfig(task: Task, cfg: TaskConfig, adminId: string) {
  const before = await getTaskConfig(task);
  await pool.query(
    `INSERT INTO ai_settings(task, provider, model, base_url, temperature, max_tokens, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
     ON CONFLICT (task) DO UPDATE SET provider=$2, model=$3, base_url=$4, temperature=$5, max_tokens=$6, updated_at=now(), updated_by=$7`,
    [task, cfg.provider, cfg.model, cfg.baseUrl || null, cfg.temperature, cfg.maxTokens, adminId]);
  invalidate();
  await audit(adminId, 'ai.settings', { task, before, after: cfg });
}

export async function saveKey(provider: ProviderId, apiKey: string, adminId: string) {
  const last4 = apiKey.slice(-4);
  await pool.query(
    `INSERT INTO ai_keys(provider, ciphertext, last4, updated_at, updated_by) VALUES ($1,$2,$3, now(), $4)
     ON CONFLICT (provider) DO UPDATE SET ciphertext=$2, last4=$3, updated_at=now(), updated_by=$4`,
    [provider, encrypt(apiKey), last4, adminId]);
  await audit(adminId, 'ai.key.set', { provider, last4 });
}

export async function clearKey(provider: ProviderId, adminId: string) {
  await pool.query('DELETE FROM ai_keys WHERE provider=$1', [provider]);
  await audit(adminId, 'ai.key.clear', { provider });
}

export async function recentAudit(limit = 20) {
  return many(pool,
    `SELECT a.action, a.details, a.created_at, u.email AS admin_email
     FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
     WHERE a.action LIKE 'ai.%' ORDER BY a.created_at DESC LIMIT $1`, [limit]);
}
