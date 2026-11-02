import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://fm:fm@localhost:5432/fortune_muse'),
  JWT_SECRET: z.string().min(16).default('dev-only-change-me-please'),
  // Public URLs used for links in emails and for Stripe redirects.
  APP_URL: z.string().default('http://localhost:8081'),
  API_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),

  // Claude (AI generation). Without a key the mock generator is used.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  // Admins pick the AI provider and model per task in the console (/console → AI models). Provider keys can be
  // entered there (stored encrypted with this key) or set as env vars: OPENAI_API_KEY, DEEPSEEK_API_KEY,
  // GEMINI_API_KEY, XAI_API_KEY, DASHSCOPE_API_KEY, MOONSHOT_API_KEY, OPENROUTER_API_KEY, OLLAMA_API_KEY,
  // VLLM_API_KEY, CUSTOM_LLM_API_KEY. Required in production to save keys in the console.
  SETTINGS_ENCRYPTION_KEY: z.union([z.literal(''), z.string().min(32)]).optional(),

  // Stripe. Without a secret key the dev payment flow is used (never in production).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Email. "console" prints emails to the server log.
  MAIL_TRANSPORT: z.enum(['console', 'postmark']).default('console'),
  POSTMARK_TOKEN: z.string().optional(),
  MAIL_FROM: z.string().default('Fortune Muse <hello@fortunemuse.app>'),

  // Sign in with Google / Microsoft / Apple. A provider without keys uses a local test page
  // in development and is hidden in production. Redirect URI to register with each provider:
  // {API_URL}/auth/oauth/{google|microsoft|apple}/callback
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(), // the Services ID, e.g. app.fortunemuse.signin
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(), // contents of the .p8 file; \n escapes are fine

  // Super accounts: admin console + free readings. Powers switch on only once the user has proven
  // they own the address (verification link, magic link, or a provider-verified Google/Microsoft/Apple sign-in).
  // Comma separated; set in .env only.
  SUPER_EMAILS: z.string().default(''),

  // Comma separated emails that get the admin role (console only, readings still paid) once the email is verified.
  ADMIN_EMAILS: z.string().default(''),
  // Launch markets. MVP: US only.
  LAUNCH_COUNTRIES: z.string().default('US'),
});

const parsed = Env.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  if (parsed.JWT_SECRET.startsWith('dev-only')) throw new Error('JWT_SECRET must be set in production');
  if (!parsed.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY must be set in production');
}

export const config = {
  ...parsed,
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  superEmails: parsed.SUPER_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  adminEmails: parsed.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  launchCountries: parsed.LAUNCH_COUNTRIES.split(',').map((s) => s.trim().toUpperCase()),
  devPayments: !parsed.STRIPE_SECRET_KEY && parsed.NODE_ENV !== 'production',
};
export type Config = typeof config;
