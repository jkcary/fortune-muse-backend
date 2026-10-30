# Fortune Muse — backend

Modular monolith (plan §5.2): one Fastify service, one module per plan section.

```
src/
  config.ts            env (see .env.example)
  server.ts            app wiring, error handling, /health, /console
  index.ts             migrate → seed → listen → background jobs
  jobs.ts              room expiry, stale orders, token cleanup
  db/                  pg pool, SQL migrations, seed content
  lib/                 auth guards, JWT/password, mailer, analytics events
  modules/
    auth/              M1 register, login, magic link, verify, reset
    profile/           M1/M2 profile, avatar, memory/rooms switches
    deities/           spirits, prices, question templates
    readings/          M3/M4 create reading, Claude generator, content library, pricing, clustering
    payments/          M8 Stripe Checkout + webhook, dev payment
    memory/            M5 memories, feedback, greeting
    draws/             M6 daily draw + odds
    rooms/             M7 matching, chat (REST + WebSocket), expiry
    moderation/        M7 reports, blocks, auto-restrict
    safety/            crisis screening, chat filter, alcohol/guarantee checks
    account/           M9 export, delete, privacy requests
    admin/             M10 console API + KPIs
public/admin.html      M10 console UI (served at /console)
test/                  vitest: API end-to-end + generator/safety units
```

## Commands

| | |
|---|---|
| `npm run dev` | watch mode on :4000 |
| `npm test` | tests (needs a `fortune_muse_test` database; set `TEST_DATABASE_URL` to override) |
| `npm run typecheck` / `npm run build` / `npm start` | production build |
| `npm run db:migrate` / `npm run db:seed` | run separately if needed |

Database: `docker compose up -d` starts PostgreSQL with the default `.env` credentials and creates the test database.

## AI generation

`modules/readings/generator.ts` calls Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`, effort `ANTHROPIC_EFFORT=low`) with structured JSON output and server-side refusal fallback. The model picks from a random slice of the content library and writes the answer, lucky action and reminders. Output is schema-checked and screened for guarantees, alcohol and unsafe content; a vague lucky action is replaced by a vetted template; two failures refund the order. Memories enter the prompt only as the user's own quoted words, and the "no memory" case explicitly forbids referring to the past.

## Stripe setup

1. Set `STRIPE_SECRET_KEY`; enable Stripe Tax and Apple Pay / Google Pay in the Dashboard.
2. Webhook endpoint `https://<api>/payments/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`; put the signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Local testing: `stripe listen --forward-to localhost:4000/payments/webhook`.
4. Charges are USD only. Add a Radar rule to block cards issued outside the US if you want a strict US launch.

## Main endpoints

`POST /auth/register|login|magic-link|magic/verify|verify-email|forgot|reset` · `GET/PATCH /me` · `PATCH /me/avatar` · `PATCH /settings/memory|rooms` · `GET /deities` · `POST/GET /readings` · `GET /readings/:id` · `GET /orders` · `POST /orders/:id/refund-request` · `POST /payments/webhook` · `POST /feedback` · `GET /greeting` · `GET/DELETE /memories[/:id]` · `GET/POST /draws/today` · `POST /rooms/join` · `GET /rooms/current|:id` · `WS /rooms/:id/ws?token=` · `POST /reports` · `POST/DELETE /blocks` · `POST /account/export` · `DELETE /account` · `POST /privacy-requests` · `/admin/*`
