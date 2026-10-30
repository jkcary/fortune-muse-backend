import type { FastifyInstance } from 'fastify';
import { many } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { PRICES, QUESTION_TEMPLATES } from '../readings/catalog.js';

export default async function deityRoutes(app: FastifyInstance) {
  app.get('/deities', async () => {
    const deities = await many(pool, 'SELECT id, name, title, theme, greeting, image_assets FROM deities WHERE active ORDER BY sort');
    return { deities, prices: PRICES, questionTemplates: QUESTION_TEMPLATES };
  });
}
