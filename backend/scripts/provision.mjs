// Run once after reviewing migrations. Credentials stay outside Git and OneDrive.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
const secretsDir = path.join(process.env.LOCALAPPDATA, 'dallasai-club-website');
const target = path.join(secretsDir, 'secrets.env.forms');
if (await fs.stat(target).catch(() => null))
  throw new Error(
    'Forms credentials already exist. Use the existing connections; do not rotate them by rerunning provisioning.',
  );
const source = await fs.readFile(
  path.join(secretsDir, 'secrets.env.database-admin'),
  'utf8',
);
const connection = source
  .match(/^DATABASE_URL=(.+)$/m)?.[1]
  .trim()
  .replace(/^['"]|['"]$/g, '');
if (!connection)
  throw new Error('Database administration connection not found.');
const formsPassword = randomBytes(32).toString('base64url'),
  authPassword = randomBytes(32).toString('base64url');
const pool = new pg.Pool({
  connectionString: connection,
  connectionTimeoutMillis: 10000,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const existing = await client.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('club_forms_api','club_admin_api')",
  );
  if (existing.rows.length)
    throw new Error(
      'A runtime role already exists. Stop and recover its existing credentials before proceeding.',
    );
  for (const name of [
    '003_club_forms.sql',
    '004_admin_auth.sql',
    '005_screen_confirmations.sql',
  ]) {
    const sql = (
      await fs.readFile(new URL('../' + name, import.meta.url), 'utf8')
    )
      .replace(/^BEGIN;\s*$/gm, '')
      .replace(/^COMMIT;\s*$/gm, '');
    await client.query(sql);
  }
  // Passwords are generated from a restricted alphabet, never interpolated from user input.
  await client.query(
    `CREATE ROLE club_forms_api LOGIN PASSWORD '${formsPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await client.query(
    `CREATE ROLE club_admin_api LOGIN PASSWORD '${authPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  const databaseName = (
    await client.query('SELECT current_database() AS name')
  ).rows[0].name.replaceAll('"', '""');
  await client.query(
    `GRANT CONNECT ON DATABASE "${databaseName}" TO club_forms_api,club_admin_api`,
  );
  await client.query(`GRANT USAGE ON SCHEMA club_forms TO club_forms_api;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA club_forms TO club_forms_api;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA club_forms TO club_forms_api;
    GRANT EXECUTE ON FUNCTION club_forms.queue_new_entry() TO club_forms_api;
    GRANT USAGE ON SCHEMA public TO club_admin_api;
    REVOKE ALL ON public.club_admin_user,public.club_admin_session,public.club_admin_account,public.club_admin_verification,public.club_admin_rate_limit FROM PUBLIC;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.club_admin_user,public.club_admin_session,public.club_admin_account,public.club_admin_verification,public.club_admin_rate_limit TO club_admin_api;`);
  const dsn = (user, password) => {
    const url = new URL(connection);
    url.username = user;
    url.password = password;
    url.searchParams.set('sslmode', 'verify-full');
    return url.href;
  };
  const env = {
    FORMS_DATABASE_URL: dsn('club_forms_api', formsPassword),
    AUTH_DATABASE_URL: dsn('club_admin_api', authPassword),
    FORM_TOKEN_SECRET: randomBytes(32).toString('base64url'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    CRON_SECRET: randomBytes(32).toString('base64url'),
    AUTH_BASE_URL: 'https://dallasai-leaderboard.vercel.app',
    ADMIN_EMAILS: '',
    BLOB_READ_WRITE_TOKEN: '',
  };
  // Exclusive creation prevents accidentally replacing existing credentials.
  await fs.writeFile(
    target,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await client.query('COMMIT');
  console.log(
    'Created forms and admin tables, separate runtime roles, and private local settings. No emails were sent and no website was published.',
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Provisioning stopped:', error.code || error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
