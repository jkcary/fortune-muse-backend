import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';

let client: Anthropic | null = null;

/** One Claude call with structured JSON output (same model, fallback and effort settings for every caller). */
export async function claudeJson(opts: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<{ data: unknown; model: string }> {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: opts.system,
    messages: opts.messages,
    output_config: { effort: config.ANTHROPIC_EFFORT, format: { type: 'json_schema', schema: opts.schema } },
  });
  if (response.stop_reason === 'refusal') throw new Error('model_refusal');
  if (response.stop_reason === 'max_tokens') throw new Error('model_truncated');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return { data: JSON.parse(text), model: response.model };
}
