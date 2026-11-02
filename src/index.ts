import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startJobs } from './jobs.js';
import { applyAdminRole } from './lib/super.js';
import { getTaskConfig } from './modules/ai/settings.js';
import { buildServer } from './server.js';

await migrate();
await seed();
await applyAdminRole();
const app = await buildServer();
startJobs(app.log);
await app.listen({ port: config.PORT, host: config.HOST });
const reading = await getTaskConfig('reading');
app.log.info(`AI (readings): ${reading.provider}${reading.model ? ` ${reading.model}` : ''} · payments: ${config.devPayments ? 'DEV (no Stripe key)' : 'Stripe'}`);
