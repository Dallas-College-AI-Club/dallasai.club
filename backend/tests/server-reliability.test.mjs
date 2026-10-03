import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { adminHandler } from '../api/admin.mjs';
import { transaction } from '../lib/db.mjs';
import { fail, jsonBody } from '../lib/http.mjs';
import { RequestError } from '../lib/errors.mjs';
import { testDatabase } from './helpers/db.mjs';

test('a failed ROLLBACK keeps the original error and destroys the connection', async () => {
  const released = [];
  const client = {
    query: async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
    },
    release: (error) => released.push(error),
  };
  const original = new RequestError(409, 'This changed.');
  await assert.rejects(
    transaction({ connect: async () => client }, async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal(released.length, 1);
  assert.equal(released[0]?.message, 'connection lost');
});

test('a successful ROLLBACK returns the connection to the pool', async () => {
  const released = [];
  const client = { query: async () => {}, release: (e) => released.push(e) };
  await assert.rejects(
    transaction({ connect: async () => client }, async () => {
      throw new Error('stop');
    }),
  );
  assert.deepEqual(released, [undefined]);
});

test('a body the platform cannot parse is a 400, not a server error', async () => {
  const req = {
    headers: { 'content-type': 'application/json' },
    get body() {
      throw new SyntaxError('Unexpected token');
    },
  };
  await assert.rejects(
    jsonBody(req),
    (error) => error instanceof RequestError && error.status === 400,
  );
});

test('an error after streaming started closes the response', () => {
  let destroyed = false;
  const res = {
    headersSent: true,
    destroy: () => (destroyed = true),
    setHeader: () => assert.fail('headers were already sent'),
  };
  fail(res, new Error('storage dropped'));
  assert.equal(destroyed, true);
});

let db, server, origin, settled;
const entryId = randomUUID(),
  fileId = randomUUID(),
  chunks = 40;
const slowFile = () => {
  let sent = 0;
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (sent++ === chunks) controller.close();
      else controller.enqueue(new Uint8Array(1024).fill(65));
    },
  });
};
before(async () => {
  db = await testDatabase();
  await db.query(
    `INSERT INTO club_forms.entries(id,kind,email,name,data,dedupe_key,state)
     VALUES($1,'contribution','writer@example.edu','Writer','{}',$2,'active')`,
    [entryId, 'contribution:' + entryId],
  );
  await db.query(
    `INSERT INTO club_forms.attachments(id,entry_id,name,pathname,content_type,size)
     VALUES($1,$2,'draft notes.pdf','private/draft.pdf','application/pdf',$3)`,
    [fileId, entryId, chunks * 1024],
  );
  const handler = adminHandler({
    getDatabase: () => db,
    authorize: async () => ({ email: 'officer@example.com' }),
    getEvents: async () => [],
    storage: { get: async () => ({ statusCode: 200, stream: slowFile() }) },
  });
  server = http.createServer((req, res) => {
    settled = 'pending';
    handler(req, res).then(
      () => (settled = 'settled'),
      () => (settled = 'settled'),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test('officers download attachments in full and each download is audited', async () => {
  const response = await fetch(
    origin + '/api/admin?attachment=' + fileId,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(
    response.headers.get('content-disposition'),
    /filename\*=UTF-8''draft%20notes\.pdf/,
  );
  assert.equal((await response.arrayBuffer()).byteLength, chunks * 1024);
  const audit = await db.query(
    `SELECT actor FROM club_forms.audit WHERE entry_id=$1 AND action='download-attachment'`,
    [entryId],
  );
  assert.deepEqual(audit.rows, [{ actor: 'officer@example.com' }]);
});

test('a download the officer cancels does not leave the function running', async () => {
  await new Promise((resolve, reject) => {
    const request = http.get(
      origin + '/api/admin?attachment=' + fileId,
      (response) => response.once('data', () => request.destroy()),
    );
    request.on('close', resolve);
    request.on('error', (error) =>
      error.code === 'ECONNRESET' ? resolve() : reject(error),
    );
  });
  const deadline = Date.now() + 1000;
  while (settled === 'pending' && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, 'settled');
});
