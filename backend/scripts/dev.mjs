import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forms from '../api/forms.mjs';
import admin from '../api/admin.mjs';
import maintenance from '../api/maintenance.mjs';
import auth from '../api/auth/[...all].mjs';
const root = fileURLToPath(new URL('../public', import.meta.url));
const handlers = {
  '/api/forms': forms,
  '/api/admin': admin,
  '/api/maintenance': maintenance,
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4175');
    if (url.pathname.startsWith('/api/auth/')) return await auth(req, res);
    if (handlers[url.pathname]) return await handlers[url.pathname](req, res);
    const file = path.resolve(
      root,
      '.' +
        decodeURIComponent(url.pathname) +
        (url.pathname.endsWith('/') ? 'index.html' : ''),
    );
    if (!file.startsWith(root + path.sep)) throw new Error();
    if (!(await stat(file)).isFile()) throw new Error();
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
server.listen(4175, '127.0.0.1', () =>
  console.log('Club services: http://127.0.0.1:4175/admin/'),
);
