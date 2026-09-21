import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../lib/auth.mjs';
const file = path.join(
  process.env.LOCALAPPDATA,
  'dallasai-club-website',
  'secrets.env.database-admin',
);
const text = await fs.readFile(file, 'utf8');
const connection = text
  .match(/^DATABASE_URL=(.+)$/m)?.[1]
  .trim()
  .replace(/^['"]|['"]$/g, '');
if (!connection)
  throw new Error('Database administration connection not found.');
const pool = new pg.Pool({
  connectionString: connection,
  connectionTimeoutMillis: 10000,
});
try {
  const migrations = await getMigrations(authOptions(pool));
  const sql = await migrations.compileMigrations();
  if (!sql.trim())
    throw new Error(
      'No schema changes generated; do not overwrite the existing migration.',
    );
  await fs.writeFile(
    new URL('../004_admin_auth.sql', import.meta.url),
    '-- Generated from the pinned Better Auth configuration; no member passwords.\nBEGIN;\n' +
      sql +
      '\nCOMMIT;\n',
  );
  console.log(
    'Generated admin authentication migration without changing the database.',
  );
} finally {
  await pool.end();
}
