import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startJobs } from './jobs.js';
import { buildServer } from './server.js';

await migrate();
await seed();
const app = await buildServer();
startJobs(app.log);
await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`AI: ${config.ANTHROPIC_API_KEY ? config.ANTHROPIC_MODEL : 'mock generator'} · payments: ${config.devPayments ? 'DEV (no Stripe key)' : 'Stripe'}`);
