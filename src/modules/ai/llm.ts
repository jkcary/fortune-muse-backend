import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { providerInfo } from './providers.js';
import { resolveTask, type ResolvedConfig, type Task } from './settings.js';

export interface JsonRequest<T> {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Validates the parsed JSON (zod .parse); a failure counts as an invalid answer. */
  validate: (data: unknown) => T;
}

export interface JsonResult<T> { data: T; model: string; provider: string }

const TIMEOUT_MS = 60_000;

/** Error from a provider, safe to show an admin (never contains the API key). */
export class LlmError extends Error {}

/** Makes the provider name and message readable without echoing anything secret. */
function providerError(status: number, body: any): LlmError {
  const msg = body?.error?.message ?? body?.message ?? body?.error ?? '';
  return new LlmError(`HTTP ${status}${msg ? `: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}` : ''}`);
}

/** Pulls the JSON object out of a reply, ignoring ```json fences or text around it. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new SyntaxError('no JSON object in the reply');
}

let anthropic: { key: string; client: Anthropic } | null = null;

async function callAnthropic(cfg: ResolvedConfig, req: JsonRequest<unknown>): Promise<{ text: string; model: string }> {
  if (!cfg.apiKey) throw new LlmError('No API key for Anthropic.');
  if (anthropic?.key !== cfg.apiKey) anthropic = { key: cfg.apiKey, client: new Anthropic({ apiKey: cfg.apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) };
  let response;
  try {
    response = await anthropic.client.beta.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? req.maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: req.system,
      messages: req.messages,
      ...(cfg.temperature != null ? { temperature: cfg.temperature } : {}),
      output_config: { effort: config.ANTHROPIC_EFFORT, format: { type: 'json_schema', schema: req.schema } },
    });
  } catch (e: any) {
    throw e?.status ? providerError(e.status, e.error ?? { message: e.message }) : new LlmError(e?.message ?? 'Request failed');
  }
  if (response.stop_reason === 'refusal') throw new LlmError('model_refusal');
  if (response.stop_reason === 'max_tokens') throw new LlmError('model_truncated');
  return { text: response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''), model: response.model };
}

/** OpenAI-compatible Chat Completions: OpenAI, DeepSeek, Gemini, Grok, Qwen, Kimi, OpenRouter, Ollama, vLLM, custom. */
async function callOpenAiCompatible(cfg: ResolvedConfig, req: JsonRequest<unknown>): Promise<{ text: string; model: string }> {
  const info = providerInfo(cfg.provider);
  if (!cfg.baseUrl) throw new LlmError('No base URL set.');
  if (info.keyRequired && !cfg.apiKey) throw new LlmError(`No API key for ${info.label}.`);
  const system = info.json === 'schema' ? req.system
    : `${req.system}\n\nReturn only one JSON object that matches this JSON Schema, with no other text:\n${JSON.stringify(req.schema)}`;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, ...req.messages],
    // OpenAI's newer models only accept max_completion_tokens; the others use max_tokens.
    [cfg.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: cfg.maxTokens ?? req.maxTokens,
    response_format: info.json === 'schema'
      ? { type: 'json_schema', json_schema: { name: 'output', schema: req.schema, strict: true } }
      : { type: 'json_object' },
  };
  if (cfg.temperature != null) body.temperature = cfg.temperature;

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        ...(cfg.provider === 'openrouter' ? { 'x-title': 'Fortune Muse' } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new LlmError(e?.name === 'TimeoutError' ? 'Timed out' : `Cannot reach ${cfg.baseUrl} (${e?.cause?.code ?? e?.message ?? 'network error'})`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(res.status, data);
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c: any) => c?.text ?? '').join('') : String(content ?? '');
  if (!text.trim()) throw new LlmError('Empty reply');
  return { text, model: String(data?.model ?? cfg.model) };
}

/** One JSON call with an explicit configuration (used by the console's "Test connection"). */
export async function callJson<T>(cfg: ResolvedConfig, req: JsonRequest<T>): Promise<JsonResult<T>> {
  const call = providerInfo(cfg.provider).kind === 'anthropic' ? callAnthropic : callOpenAiCompatible;
  // An answer that is not valid JSON for the schema gets one more try.
  for (let attempt = 1; ; attempt++) {
    const { text, model } = await call(cfg, req as JsonRequest<unknown>);
    try {
      return { data: req.validate(extractJson(text)), model, provider: cfg.provider };
    } catch (e) {
      if (attempt >= 2) throw new LlmError(`Invalid JSON from the model: ${(e as Error).message.slice(0, 200)}`);
    }
  }
}

/**
 * The model call for a task, using the provider and model chosen in the admin console.
 * Returns null when the task is set to the offline mock, so callers use their scripted output.
 */
export async function generateJson<T>(task: Task, req: JsonRequest<T>): Promise<JsonResult<T> | null> {
  const cfg = await resolveTask(task);
  if (cfg.provider === 'mock') return null;
  return callJson(cfg, req);
}
