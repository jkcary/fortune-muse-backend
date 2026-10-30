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

  // Stripe. Without a secret key the dev payment flow is used (never in production).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Email. "console" prints emails to the server log.
  MAIL_TRANSPORT: z.enum(['console', 'postmark']).default('console'),
  POSTMARK_TOKEN: z.string().optional(),
  MAIL_FROM: z.string().default('Fortune Muse <hello@fortunemuse.app>'),

  // Comma separated emails that get the admin role on registration.
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
  adminEmails: parsed.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  launchCountries: parsed.LAUNCH_COUNTRIES.split(',').map((s) => s.trim().toUpperCase()),
  devPayments: !parsed.STRIPE_SECRET_KEY && parsed.NODE_ENV !== 'production',
};
export type Config = typeof config;
