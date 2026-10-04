import { testDatabase } from './helpers/db.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { adminHandler } from '../api/admin.mjs';
let db, server, origin;
const poll = async (query = '') => {
  const response = await fetch(origin + '/api/admin?counts=1' + query);
  return { status: response.status, ...(await response.json()) };
};
const insert = (created) =>
  db.query(
    "INSERT INTO club_forms.entries(id,kind,email,dedupe_key,data,created_at) VALUES($1::uuid,'question','counts@example.edu',$1::text,'{}',$2)",
    [randomUUID(), created],
  );
before(async () => {
  db = await testDatabase();
  const handler = adminHandler({
    getDatabase: () => db,
    authorize: () => ({ email: 'admin@example.com' }),
    getEvents: async () => [],
    storage: {},
  });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});
// Production created_at has microseconds; the newest time the officer saw
// comes back through JSON in milliseconds. That submission is not new.
test('the newest submission seen is not an arrival at microsecond precision', async () => {
  await insert('2026-10-03T17:00:00.123456Z');
  const { latest } = await poll();
  assert.equal(latest, '2026-10-03T17:00:00.123Z');
  const seen = await poll('&status=new&since=' + encodeURIComponent(latest));
  assert.deepEqual([seen.arrived, seen.arrivedInView], [0, 0]);
  await insert('2026-10-03T17:00:00.124001Z');
  const next = await poll('&status=new&since=' + encodeURIComponent(latest));
  assert.deepEqual([next.arrived, next.arrivedInView], [1, 1]);
});
test('since must be a strict ISO time', async () => {
  const logError = console.error;
  console.error = () => {};
  try {
    for (const since of [
      '0',
      '1',
      'Tue Oct 03 2026 12:00:00 GMT-0500 (Central Daylight Time)',
      '+275760-09-13T00:00:00.000Z',
      '2026-13-01T00:00:00Z',
      '2026-10-03',
      // Also refused by Postgres: a day the month lacks, a 16-hour offset.
      '2026-02-31T00:00:00Z',
      '2026-10-03T17:00:00+16:00',
    ])
      assert.equal(
        (await poll('&since=' + encodeURIComponent(since))).status,
        400,
        since,
      );
    for (const since of [
      '2026-10-03T17:00:00Z',
      '2026-10-03T17:00:00.123456Z',
      '2026-10-03T12:00:00.5-05:00',
    ])
      assert.equal(
        (await poll('&since=' + encodeURIComponent(since))).status,
        200,
        since,
      );
  } finally {
    console.error = logError;
  }
});
