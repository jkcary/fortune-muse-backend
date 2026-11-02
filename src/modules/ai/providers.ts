/**
 * AI providers the admin can pick. Anthropic uses its own SDK; the rest speak the OpenAI-compatible
 * Chat Completions API at `baseUrl`. `json` says how to ask for structured output:
 * 'schema' = response_format json_schema; 'object' = json_object plus the schema in the prompt.
 * Model names are suggestions only: the console can also list a provider's /models.
 */
export interface ProviderInfo {
  label: string;
  kind: 'mock' | 'anthropic' | 'openai';
  baseUrl: string;
  /** Base URL is meant to be changed (self-hosted or custom). */
  editableUrl?: boolean;
  /** Env var used when no key is saved in the console. */
  keyEnv?: string;
  keyRequired: boolean;
  json: 'schema' | 'object';
  models: string[];
  docs?: string;
}

export const PROVIDERS = {
  mock: { label: 'Mock (offline)', kind: 'mock', baseUrl: '', keyRequired: false, json: 'schema', models: [] },
  anthropic: {
    label: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY', keyRequired: true, json: 'schema',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], docs: 'https://docs.claude.com',
  },
  openai: {
    label: 'OpenAI ChatGPT', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', keyRequired: true, json: 'schema',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1-mini'], docs: 'https://platform.openai.com/docs',
  },
  deepseek: {
    label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', keyRequired: true, json: 'object',
    models: ['deepseek-chat', 'deepseek-reasoner'], docs: 'https://api-docs.deepseek.com',
  },
  gemini: {
    label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', keyRequired: true, json: 'schema',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'], docs: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  xai: {
    label: 'xAI Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY', keyRequired: true, json: 'schema',
    models: ['grok-4', 'grok-3-mini'], docs: 'https://docs.x.ai',
  },
  qwen: {
    label: 'Alibaba Qwen (DashScope)', kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', editableUrl: true,
    keyEnv: 'DASHSCOPE_API_KEY', keyRequired: true, json: 'object', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    docs: 'https://www.alibabacloud.com/help/en/model-studio',
  },
  kimi: {
    label: 'Moonshot Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.ai/v1', editableUrl: true, keyEnv: 'MOONSHOT_API_KEY', keyRequired: true, json: 'object',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'], docs: 'https://platform.moonshot.ai',
  },
  openrouter: {
    label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', keyRequired: true, json: 'schema',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'], docs: 'https://openrouter.ai/docs',
  },
  ollama: {
    label: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', editableUrl: true, keyEnv: 'OLLAMA_API_KEY', keyRequired: false, json: 'schema',
    models: ['llama3.1', 'qwen2.5', 'gemma3'], docs: 'https://ollama.com',
  },
  vllm: {
    label: 'vLLM (self-hosted)', kind: 'openai', baseUrl: 'http://localhost:8000/v1', editableUrl: true, keyEnv: 'VLLM_API_KEY', keyRequired: false, json: 'schema',
    models: [], docs: 'https://docs.vllm.ai',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', editableUrl: true, keyEnv: 'CUSTOM_LLM_API_KEY', keyRequired: false, json: 'object',
    models: [],
  },
} satisfies Record<string, ProviderInfo>;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS[id];
