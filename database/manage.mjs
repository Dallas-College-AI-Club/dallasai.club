import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const database = 'dallasai_club';
const role = 'dallasai_leaderboard_api';
const marker = 'dallasai.club leaderboard managed by database/manage.mjs';
const directory = path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
  'dallasai-club-website',
);
const sourceFile = path.join(directory, 'secrets.env');
const adminFile = path.join(directory, 'secrets.env.database-admin');
const workerFile = path.join(directory, 'secrets.env.worker');
const privateValues = [];
const migration = readFileSync(
  new URL('./migrations/001_leaderboard.sql', import.meta.url),
  'utf8',
);
const verification = readFileSync(new URL('./verify.sql', import.meta.url), 'utf8');
const checksum = createHash('sha256').update(migration.replaceAll('\r\n', '\n')).digest('hex');

function readConnection(file) {
  const { DATABASE_URL } = parseEnv(readFileSync(file, 'utf8'));
  if (!DATABASE_URL) throw new Error('Credential file is missing DATABASE_URL.');
  const url = new URL(DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech'))
    throw new Error('Expected a Neon PostgreSQL connection.');
  privateValues.push(DATABASE_URL, url.password, decodeURIComponent(url.password));
  return url;
}

function run(url, sql, readOnly = false) {
  // No connection string or password is placed in shell arguments or printed.
  // The direct endpoint is used for administrative transactions and their session settings.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  Object.assign(env, {
    PGHOST: url.hostname.replace(/-pooler(?=\.)/, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: 'require',
    PGCHANNELBINDING: 'require',
    PGCONNECT_TIMEOUT: '12',
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'dallasai-database-preparation',
    PGOPTIONS:
      '-c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=20000' +
      (readOnly ? ' -c default_transaction_read_only=on' : ''),
  });
  const result = spawnSync(
    'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-f', '-'],
    { env, input: sql, encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(result.error?.code || result.stderr.trim() || 'Database command failed.');
  return result.stdout.trim();
}

function inspect(url) {
  return JSON.parse(
    run(
      url,
      `SELECT json_build_object(
        'canCreateDatabase', rolcreatedb,
        'canCreateRoles', rolcreaterole,
        'targetExists', EXISTS(SELECT 1 FROM pg_database WHERE datname='${database}'),
        'targetManaged', EXISTS(SELECT 1 FROM pg_database WHERE datname='${database}'
            AND shobj_description(oid,'pg_database')='${marker}'),
        'runtimeRoleExists', EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}')
      ) FROM pg_roles WHERE rolname=current_user;`,
      true,
    ),
  );
}

function writeConnection(file, url, purpose) {
  try {
    const existing = readConnection(file);
    if (existing.toString() !== url.toString())
      throw new Error('A different credential file already exists; it will not be overwritten.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    writeFileSync(file, `# ${purpose}\nDATABASE_URL="${url.toString()}"\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  }
}

function verify(admin, worker) {
  if (
    decodeURIComponent(admin.pathname.slice(1)) !== database ||
    decodeURIComponent(worker.pathname.slice(1)) !== database ||
    decodeURIComponent(worker.username) !== role
  )
    throw new Error('Verification requires the dedicated database and its runtime role.');
  run(admin, `BEGIN;\n${verification}\nROLLBACK;`);
  run(
    worker,
    `BEGIN;
    DO $$
    DECLARE v_result record;
    BEGIN
      SELECT * INTO v_result FROM leaderboard.submit_score(gen_random_uuid(),'RuntimeTest','snake',42);
      IF v_result.score <> 42 THEN RAISE EXCEPTION 'Runtime submission failed'; END IF;
      PERFORM leaderboard.list_scores('snake');
      BEGIN
        PERFORM count(*) FROM leaderboard.daily_scores;
        RAISE EXCEPTION 'Runtime role unexpectedly read a private table';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END;
    $$;
    ROLLBACK;`,
  );
  return JSON.parse(
    run(
      admin,
      `SELECT json_build_object(
        'database',current_database(),
        'migration', (SELECT version FROM leaderboard.schema_migrations ORDER BY version DESC LIMIT 1),
        'players', (SELECT count(*) FROM leaderboard.players),
        'dailyScores', (SELECT count(*) FROM leaderboard.daily_scores),
        'runtimeLoginTestPassed',true,
        'behaviorAndPermissionTestsPassed',true,
        'testRowsRolledBack',true,
        'clientRequiresTlsAndChannelBinding',true
      );`,
      true,
    ),
  );
}

function apply() {
  const source = readConnection(sourceFile);
  const state = inspect(source);
  if (!state.canCreateDatabase || !state.canCreateRoles)
    throw new Error(
      'The supplied administrative role cannot create the database and runtime role.',
    );
  if (state.targetExists && !state.targetManaged)
    throw new Error('The database name already belongs to an unmanaged database; nothing changed.');
  if (!state.targetExists && state.runtimeRoleExists)
    throw new Error('The runtime role name already exists; nothing changed.');

  const admin = new URL(source);
  admin.pathname = `/${database}`;
  admin.hostname = admin.hostname.replace(/-pooler(?=\.)/, '');
  admin.searchParams.set('sslmode', 'require');
  admin.searchParams.set('channel_binding', 'require');
  writeConnection(
    adminFile,
    admin,
    'Administrative migration connection; never use in the browser or Worker.',
  );

  if (!state.targetExists) {
    // CREATE DATABASE cannot run inside a transaction. Only the new database is changed.
    run(source, `CREATE DATABASE ${database};`);
    run(
      source,
      `COMMENT ON DATABASE ${database} IS '${marker}'; REVOKE ALL ON DATABASE ${database} FROM PUBLIC;`,
    );
    console.log('Created the separate dallasai_club database.');
  }

  const hasMigration =
    run(admin, "SELECT to_regclass('leaderboard.schema_migrations') IS NOT NULL;", true) === 't';
  if (hasMigration) {
    const applied = run(
      admin,
      "SELECT checksum FROM leaderboard.schema_migrations WHERE version='001';",
      true,
    );
    if (applied !== checksum)
      throw new Error(
        'Migration checksum differs; create a new migration instead of replacing an applied one.',
      );
    console.log(
      JSON.stringify(
        { alreadyPrepared: true, ...verify(admin, readConnection(workerFile)) },
        null,
        2,
      ),
    );
    return;
  }
  const tableCount = Number(
    run(
      admin,
      "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%';",
      true,
    ),
  );
  if (tableCount !== 0 || inspect(source).runtimeRoleExists)
    throw new Error('Unexpected existing tables or runtime role; refusing to overwrite them.');

  let worker;
  try {
    worker = readConnection(workerFile);
    if (
      worker.hostname.replace(/-pooler(?=\.)/, '') !== admin.hostname ||
      decodeURIComponent(worker.pathname.slice(1)) !== database ||
      decodeURIComponent(worker.username) !== role
    )
      throw new Error('The existing Worker credential belongs to a different database or role.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    worker = new URL(source);
    worker.pathname = `/${database}`;
    worker.username = role;
    worker.password = randomBytes(32).toString('hex');
    worker.searchParams.set('sslmode', 'require');
    worker.searchParams.set('channel_binding', 'require');
    privateValues.push(worker.password, worker.toString());
    writeConnection(
      workerFile,
      worker,
      'Restricted leaderboard connection for the future Cloudflare Worker DATABASE_URL secret.',
    );
  }
  // Neon requires the actual password when provisioning a role. Send it only through
  // encrypted psql stdin; it is never a shell argument, source-file value or log item.
  const password = decodeURIComponent(worker.password);
  if (!/^[0-9a-f]{64}$/.test(password))
    throw new Error('Expected the generated runtime password; no role was created.');
  run(
    admin,
    `BEGIN;
    REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
    CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
    ALTER ROLE ${role} SET statement_timeout='5s';
    ALTER ROLE ${role} SET idle_in_transaction_session_timeout='15s';
    ${migration}
    SAVEPOINT verification;
    ${verification}
    ROLLBACK TO SAVEPOINT verification;
    INSERT INTO leaderboard.schema_migrations(version,checksum) VALUES ('001','${checksum}');
    COMMIT;`,
  );
  console.log(JSON.stringify(verify(admin, worker), null, 2));
}

try {
  const action = process.argv[2];
  if (action === 'inspect')
    console.log(JSON.stringify(inspect(readConnection(sourceFile)), null, 2));
  else if (action === 'apply') apply();
  else if (action === 'verify')
    console.log(
      JSON.stringify(verify(readConnection(adminFile), readConnection(workerFile)), null, 2),
    );
  else throw new Error('Usage: node database/manage.mjs inspect|apply|verify');
} catch (error) {
  let message = error.message;
  for (const value of privateValues.filter(Boolean).sort((a, b) => b.length - a.length))
    message = message.split(value).join('[redacted]');
  console.error(message);
  process.exitCode = 1;
}
