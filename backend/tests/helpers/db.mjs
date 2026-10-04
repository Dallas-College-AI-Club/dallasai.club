import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const backend = new URL('../../', import.meta.url);

// A fresh database with every numbered migration applied in order, matching
// production. 002 is skipped: it belongs to the separate leaderboard database.
export async function testDatabase() {
  const db = new PGlite();
  const files = (await readdir(backend))
    .filter((name) => /^0\d\d_.+\.sql$/.test(name) && !name.startsWith('002_'))
    .sort();
  for (const file of files)
    await db.exec(await readFile(new URL(file, backend), 'utf8'));
  return db;
}
