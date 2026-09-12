import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createClubServer } from '../server.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'club-server-'));
assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
await fs.writeFile(path.join(root, 'index.html'), '0123456789');
await fs.writeFile(path.join(root, 'empty.txt'), '');
const script = 'export const greeting = "Hello, club.";\n'.repeat(100);
await fs.writeFile(path.join(root, 'sample.js'), script);
const store = { list: async () => [], save: async () => true };
const server = createClubServer(root, store);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [range, body, status] of [
    ['bytes=0-3', '0123', 206],
    ['bytes=7-', '789', 206],
    ['bytes=-3', '789', 206],
    ['bytes=20-', '', 416],
    ['bytes=-0', '', 416],
    ['bytes=-', '', 416],
  ]) {
    const response = await fetch(base, { headers: { Range: range } });
    assert.equal(response.status, status, range);
    assert.equal(await response.text(), body, range);
  }
  assert.equal((await fetch(base + '/empty.txt')).status, 200);
  assert.equal(await (await fetch(base + '/empty.txt')).text(), '');
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  const etag = head.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(base, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal(
    (await fetch(base, { headers: { 'If-Modified-Since': head.headers.get('last-modified') } }))
      .status,
    304,
  );
  assert.equal(
    (
      await fetch(base, {
        headers: {
          'If-None-Match': '"different"',
          'If-Modified-Since': head.headers.get('last-modified'),
        },
      })
    ).status,
    200,
  );
  const resumed = await fetch(base, {
    headers: { Range: 'bytes=7-', 'If-Range': 'Thu, 01 Jan 1970 00:00:00 GMT' },
  });
  assert.equal(resumed.status, 200);
  assert.equal(await resumed.text(), '0123456789');
  const compressed = await fetch(base + '/sample.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.equal(await compressed.text(), script);
  const plain = await fetch(base + '/sample.js', { headers: { 'Accept-Encoding': 'gzip;q=0' } });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.equal(await plain.text(), script);
  assert.equal(
    (
      await fetch(base + '/sample.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } })
    ).headers.get('content-encoding'),
    'gzip',
  );
  const range = await fetch(base + '/sample.js', {
    headers: { Range: 'bytes=0-9', 'Accept-Encoding': 'gzip' },
  });
  assert.equal(range.headers.get('content-encoding'), null);
  assert.equal(await range.text(), script.slice(0, 10));
  assert.equal((await fetch(base + '/.private')).status, 403);
  assert.equal((await fetch(base + '/%2e%2e%2fpackage.json')).status, 403);
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base, { method: 'DELETE' })).status, 405);
  assert.deepEqual(await (await fetch(base + '/api/leaderboard?game=snake')).json(), {
    entries: [],
  });
  assert.equal((await fetch(base + '/api/scores', { method: 'POST', body: '{}' })).status, 415);
  assert.equal(
    (
      await fetch(base + '/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
        body: '{}',
      })
    ).status,
    403,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.unlink(path.join(root, 'index.html'));
  await fs.unlink(path.join(root, 'empty.txt'));
  await fs.unlink(path.join(root, 'sample.js'));
  await fs.rmdir(root);
}
console.log(
  'PASS: static files, conditional caching, gzip, empty files, HEAD, video byte ranges, missing/private paths, and API method/origin guards.',
);
