import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const settings = await fs.readFile(
  path.join(
    process.env.LOCALAPPDATA,
    'dallasai-club-website',
    'secrets.env.forms',
  ),
  'utf8',
);
const env = Object.fromEntries(
  settings
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1),
    ]),
);
// Checks the forms runtime role against production. The test row is written
// inside a transaction that is always rolled back.
const pool = new pg.Pool({
  connectionString: env.FORMS_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const id = randomUUID();
  await client.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','connection-check@example.invalid',$2)",
    [id, 'connection-check:' + id],
  );
  await client.query('ROLLBACK');
  const access = (
    await client.query(
      "SELECT has_schema_privilege(current_user,'public','USAGE') AS public_access",
    )
  ).rows[0];
  if (access.public_access)
    throw new Error('Forms role can use the public schema.');
  console.log(
    'forms: connection and permissions verified; a test row was written and rolled back.',
  );
} finally {
  client.release();
  await pool.end();
}
