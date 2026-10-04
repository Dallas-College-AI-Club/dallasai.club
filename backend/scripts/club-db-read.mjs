// Read-only production query against the club database:
//   node scripts/club-db-read.mjs "SELECT kind, count(*) FROM club_forms.entries GROUP BY kind"
// Uses FORMS_DATABASE_URL from the private secrets file, refuses any database other
// than dallasai_club, and runs one statement in a READ ONLY transaction that is
// always rolled back. Prints rows as JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const sql = process.argv.slice(2).join(' ').trim();
if (!/^(select|with|explain|show|table|values)\b/i.test(sql))
  throw Error(
    'Pass one read-only statement: SELECT, WITH, EXPLAIN, SHOW, TABLE or VALUES.',
  );
const settings = await fs.readFile(
  path.join(
    process.env.LOCALAPPDATA,
    'dallasai-club-website',
    'secrets.env.forms',
  ),
  'utf8',
);
const connectionString = settings
  .split(/\r?\n/)
  .find((line) => line.startsWith('FORMS_DATABASE_URL='))
  ?.slice('FORMS_DATABASE_URL='.length)
  .replace(/^"(.*)"$/, '$1');
if (!connectionString) throw Error('FORMS_DATABASE_URL is not configured.');
const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10000,
});
await client.connect();
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15s'");
  const { db } = (await client.query('SELECT current_database() AS db'))
    .rows[0];
  if (db !== 'dallasai_club')
    throw Error('Refusing to query database ' + db + '.');
  // An empty values array forces the extended protocol, which accepts exactly one
  // statement, so "COMMIT; UPDATE ..." cannot escape the read-only transaction.
  const result = await client.query({ text: sql, values: [] });
  console.log(JSON.stringify(result.rows, null, 1));
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
