import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createClubServer } from '../server.mjs';
import { ScoreValidationError } from '../server.mjs';

async function withServer(store, run) {
  const server = createClubServer(fileURLToPath(new URL('../public/', import.meta.url)), store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run('http://127.0.0.1:' + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('score submissions preserve a Unicode nickname split across network chunks', async () => {
  let saved;
  await withServer(
    {
      save: async (input) => {
        saved = input;
      },
    },
    async (base) => {
      const body = Buffer.from(JSON.stringify({ nickname: '한글' }));
      const split = body.indexOf(Buffer.from('한')) + 1;
      const status = await new Promise((resolve, reject) => {
        const req = http.request(
          base + '/api/scores',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.write(body.subarray(0, split));
        setTimeout(() => req.end(body.subarray(split)), 15);
      });
      assert.equal(status, 200);
      assert.equal(saved.nickname, '한글');
    },
  );
});

test('invalid input returns 400; storage failures return 500 without exposing details', async () => {
  for (const [error, status] of [
    [new ScoreValidationError('invalid'), 400],
    [new Error('private path'), 500],
  ]) {
    await withServer(
      {
        list: async () => {
          throw error;
        },
        save: async () => {
          throw error;
        },
      },
      async (base) => {
        for (const response of [
          await fetch(base + '/api/leaderboard'),
          await fetch(base + '/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
        ]) {
          assert.equal(response.status, status);
          assert.ok(!(await response.text()).includes('private path'));
        }
      },
    );
  }
});
