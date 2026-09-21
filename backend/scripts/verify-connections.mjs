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
for (const [key, role] of [
  ['FORMS_DATABASE_URL', 'forms'],
  ['AUTH_DATABASE_URL', 'admin'],
]) {
  const pool = new pg.Pool({
    connectionString: env[key],
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();
  try {
    if (role === 'forms') {
      await client.query('BEGIN');
      const id = randomUUID();
      await client.query(
        "INSERT INTO club_forms.entries(id,kind,email,dedupe_key) VALUES($1,'join','connection-check@example.invalid',$2)",
        [id, 'connection-check:' + id],
      );
      const rows = (
        await client.query(
          'SELECT kind FROM club_forms.outbox WHERE entry_id=$1',
          [id],
        )
      ).rows;
      if (rows.length !== 1 || rows[0].kind !== 'notify')
        throw new Error('Notification trigger check failed.');
      await client.query('ROLLBACK');
      const access = (
        await client.query(
          "SELECT has_schema_privilege(current_user,'public','USAGE') AS admin_access",
        )
      ).rows[0];
      if (access.admin_access)
        throw new Error('Forms role can read admin authentication data.');
    } else {
      await client.query('SELECT id FROM public.club_admin_user LIMIT 0');
      const access = (
        await client.query(
          "SELECT has_schema_privilege(current_user,'club_forms','USAGE') AS forms_access",
        )
      ).rows[0];
      if (access.forms_access)
        throw new Error('Authentication role has unexpected forms access.');
    }
    console.log(
      role +
        ': connection and permissions verified' +
        (role === 'forms'
          ? '; notification trigger verified inside a rolled-back transaction.'
          : '.'),
    );
  } finally {
    client.release();
    await pool.end();
  }
}
