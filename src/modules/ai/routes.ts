import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { callJson, LlmError } from './llm.js';
import { PROVIDER_IDS, PROVIDERS, providerInfo, type ProviderId } from './providers.js';
import {
  clearKey, getTaskConfig, keyStatus, recentAudit, resolveKey, saveKey, saveTaskConfig, TASKS, type ResolvedConfig, type TaskConfig,
} from './settings.js';

const Provider = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

const Settings = z.object({
  provider: Provider,
  model: z.string().trim().max(200).default(''),
  baseUrl: z.string().trim().max(500).optional(),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxTokens: z.number().int().min(64).max(64000).nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.provider !== 'mock' && !v.model) ctx.addIssue({ code: 'custom', message: 'Choose a model.' });
  const url = v.baseUrl || PROVIDERS[v.provider].baseUrl;
  if (v.provider !== 'mock' && !/^https?:\/\/\S+$/.test(url)) ctx.addIssue({ code: 'custom', message: 'Enter a base URL starting with http:// or https://.' });
});

const toConfig = (s: z.infer<typeof Settings>): TaskConfig => ({
  provider: s.provider, model: s.provider === 'mock' ? '' : s.model,
  // Fixed endpoints always use the preset; self-hosted and custom ones keep what the admin typed.
  baseUrl: providerInfo(s.provider).editableUrl ? (s.baseUrl || PROVIDERS[s.provider].baseUrl) : PROVIDERS[s.provider].baseUrl,
  temperature: s.temperature, maxTokens: s.maxTokens,
});

const TEST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'reply'],
  properties: { ok: { type: 'boolean' }, reply: { type: 'string' } },
};
const TestReply = z.object({ ok: z.boolean(), reply: z.string() });

/** Admin console: choose the provider and model for the intake conversation and for readings. */
export default async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => { await requireAdmin(req); });

  app.get('/admin/ai', async () => ({
    tasks: Object.fromEntries(await Promise.all(TASKS.map(async (t) => [t, await getTaskConfig(t)] as const))),
    keys: await keyStatus(),
    providers: PROVIDERS,
    audit: await recentAudit(),
  }));

  app.put('/admin/ai/:task', async (req) => {
    const me = await requireAdmin(req);
    const { task } = z.object({ task: z.enum(TASKS) }).parse(req.params);
    const cfg = toConfig(Settings.parse(req.body));
    await saveTaskConfig(task, cfg, me.id);
    return { task, settings: cfg };
  });

  app.put('/admin/ai/keys/:provider', async (req) => {
    const me = await requireAdmin(req);
    const { provider } = z.object({ provider: Provider }).parse(req.params);
    const { apiKey } = z.object({ apiKey: z.string().trim().min(8).max(500) }).parse(req.body);
    if (provider === 'mock') throw badRequest('no_key', 'The mock needs no key.');
    await saveKey(provider, apiKey, me.id);
    return { keys: await keyStatus() };
  });

  app.delete('/admin/ai/keys/:provider', async (req) => {
    const me = await requireAdmin(req);
    const { provider } = z.object({ provider: Provider }).parse(req.params);
    await clearKey(provider, me.id);
    return { keys: await keyStatus() };
  });

  // Sends a tiny JSON request with the settings on screen (saved or not) and reports how it went.
  app.post('/admin/ai/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ settings: Settings, apiKey: z.string().trim().max(500).optional() }).parse(req.body);
    const cfg = toConfig(body.settings);
    if (cfg.provider === 'mock') return { ok: true, latencyMs: 0, model: 'mock', reply: 'Offline mock: scripted replies, no AI calls.' };
    const resolved: ResolvedConfig = { ...cfg, apiKey: body.apiKey || (await resolveKey(cfg.provider)) };
    const started = Date.now();
    try {
      const out = await callJson(resolved, {
        system: 'You are a connection test. Answer with ok=true and a greeting of at most five words in reply.',
        messages: [{ role: 'user', content: 'Say hello.' }],
        schema: TEST_SCHEMA, maxTokens: 400, validate: (d) => TestReply.parse(d),
      });
      return { ok: true, latencyMs: Date.now() - started, model: out.model, reply: out.data.reply };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, error: e instanceof LlmError ? e.message : 'Request failed' };
    }
  });

  // The provider's own model list (OpenAI-compatible GET /models, or Anthropic's /v1/models).
  app.post('/admin/ai/models', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ settings: z.object({ provider: Provider, baseUrl: z.string().trim().max(500).optional() }), apiKey: z.string().trim().max(500).optional() }).parse(req.body);
    const p = body.settings.provider;
    if (p === 'mock') return { models: [] };
    const info = providerInfo(p);
    const baseUrl = (info.editableUrl ? body.settings.baseUrl || info.baseUrl : info.baseUrl).replace(/\/+$/, '');
    const key = body.apiKey || (await resolveKey(p));
    const anthropic = info.kind === 'anthropic';
    try {
      const res = await fetch(anthropic ? `${baseUrl}/v1/models?limit=100` : `${baseUrl}/models`, {
        headers: anthropic ? { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' } : key ? { authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { models: [], error: `HTTP ${res.status}${data?.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ''}` };
      const list: string[] = (data?.data ?? data?.models ?? []).map((m: any) => String(m?.id ?? m?.name ?? '')).filter(Boolean);
      return { models: [...new Set(list)].sort() };
    } catch (e: any) {
      return { models: [], error: `Cannot reach ${baseUrl} (${e?.cause?.code ?? e?.name ?? 'network error'})` };
    }
  });
}
