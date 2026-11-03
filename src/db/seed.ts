import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { CONTENT, DEITIES, REWARDS } from './seedData.js';

/** Idempotent: inserts launch content only where missing. */
export async function seed() {
  for (const d of DEITIES) {
    await pool.query(
      `INSERT INTO deities(id,name,title,theme,persona_prompt,greeting,image_assets,sort,topic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [d.id, d.name, d.title, d.theme, d.persona_prompt, d.greeting, d.image_assets, d.sort, d.topic],
    );
  }
  for (const r of REWARDS) {
    await pool.query(
      `INSERT INTO rewards(id,type,name,description,weight,asset) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.type, r.name, r.description, r.weight, r.asset],
    );
  }
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM content_items');
  if (rows[0].n === 0) {
    for (const c of CONTENT) {
      await pool.query('INSERT INTO content_items(kind,topic,data) VALUES ($1,$2,$3)', [c.kind, c.topic, c.data]);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed().then(() => { console.log('seeded'); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
