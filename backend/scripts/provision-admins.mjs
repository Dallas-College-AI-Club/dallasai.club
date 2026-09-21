// Run after reviewing the approved officer allowlist. Never prints passwords.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createAdmin, emailList } from '../lib/admin-accounts.mjs';
const directory = path.join(process.env.LOCALAPPDATA, 'dallasai-club-website');
const target = path.join(directory, 'admin-access.json');
if (await fs.stat(target).catch(() => null))
  throw new Error(
    'Private access file already exists. Existing accounts and passwords were not changed.',
  );
const text = await fs.readFile(
  path.join(directory, 'secrets.env.forms'),
  'utf8',
);
const env = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((x) => x.includes('='))
    .map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]),
);
const emails = [...new Set(emailList(env.ADMIN_EMAILS))];
if (!emails.length || !env.AUTH_DATABASE_URL)
  throw new Error('Approved emails and admin connection are required.');
const pool = new pg.Pool({
  connectionString: env.AUTH_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const accounts = [];
  for (const email of emails) {
    const password = randomBytes(24).toString('base64url');
    await createAdmin(client, { email, password }, env.ADMIN_EMAILS);
    accounts.push({ email, password });
  }
  await fs.writeFile(
    target,
    JSON.stringify(
      {
        note: 'Private initial officer passwords. Share each only with its named officer. Change the password in the club office after signing in. No emails have been sent.',
        adminUrl: env.AUTH_BASE_URL + '/admin/',
        accounts,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await client.query('COMMIT');
  console.log(
    'Created ' +
      accounts.length +
      ' officer accounts. Initial passwords are in the private local admin-access.json file.',
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Officer setup stopped:', error.code || error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
