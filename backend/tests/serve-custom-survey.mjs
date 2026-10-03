import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers/custom-survey-fixture.mjs';
const f = await fixture(),
  root = path.resolve(import.meta.dirname, '../public');
const port = Number(process.env.PORT || 4187);
const origin = 'http://127.0.0.1:' + port;
process.env.AUTH_BASE_URL = origin;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/responsive') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(
        `<!doctype html><html><head><title>Survey responsive check</title><style>body{margin:0;background:#eee}nav{padding:8px}iframe{display:block;border:0;max-width:none}output{font:12px monospace;display:block}</style></head><body><nav><label>Viewport <select id="size"><option>320x740</option><option>390x844</option><option>768x1024</option><option>844x390</option><option>1024x768</option><option>1440x1100</option></select></label><output aria-label="Layout measurements"></output></nav><iframe title="Survey under test" src="/surveys/#invite=${f.token}&preview=1"></iframe><script>const frame=document.querySelector('iframe'),sizes=document.querySelector('select');function resize(){const [w,h]=sizes.value.split('x');frame.width=w;frame.height=h}sizes.onchange=resize;resize();setInterval(()=>{const d=frame.contentDocument,w=frame.contentWindow;if(!d?.body)return;const overflow=[...d.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.left<-.5||r.right>w.innerWidth+.5)}).map(e=>e.className||e.tagName);document.querySelector('output').textContent=JSON.stringify({width:w.innerWidth,height:w.innerHeight,scrollWidth:d.documentElement.scrollWidth,heading:d.querySelector('main h1')?.textContent,overflow:[...new Set(overflow)],enabledAnswers:d.querySelectorAll('main input:not(:disabled),main textarea:not(:disabled),main select:not(:disabled)').length})},250);</script></body></html>`,
      );
    }
    if (url.pathname === '/reference' && process.env.SURVEY_REFERENCE_SOURCE) {
      res.setHeader('Content-Type', 'text/html');
      return res.end(await readFile(process.env.SURVEY_REFERENCE_SOURCE));
    }
    if (url.pathname === '/api/custom-surveys') return f.handler(req, res);
    if (url.pathname === '/api/auth/get-session') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({ user: { email: 'officer@example.com' } }),
      );
    }
    if (url.pathname === '/api/admin') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          user: 'officer@example.com',
          entries: [],
          hasMore: false,
          counts: [],
          events: [],
          notifications: { email: false },
          configured: { uploads: false },
        }),
      );
    }
    if (url.pathname === '/api/surveys') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({ responses: [], events: [], hasMore: false }),
      );
    }
    if (url.pathname === '/test-officer') {
      res.setHeader(
        'Set-Cookie',
        'test-officer=yes; Path=/; HttpOnly; SameSite=Strict',
      );
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }
    const file = path.resolve(
      root,
      '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''),
    );
    if (!file.startsWith(root + path.sep)) throw Error('Path');
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      respondent: origin + '/surveys/#invite=' + f.token,
      preview: origin + '/surveys/#invite=' + f.token + '&preview=1',
      officer: origin + '/test-officer',
      testCode: '123456',
    }),
  ),
);
