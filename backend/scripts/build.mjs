import {
  readFile,
  writeFile,
  mkdir,
  cp,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEventSource } from '../lib/event-registry.mjs';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const content = path.resolve(root, '../content/events');
await mkdir(path.join(root, 'generated'), { recursive: true });
if (await stat(content).catch(() => null)) {
  const events = [];
  for (const name of await readdir(content)) {
    if (!name.endsWith('.md')) continue;
    const source = await readFile(path.join(content, name), 'utf8');
    const event = parseEventSource(source);
    if (event) events.push(event);
  }
  await writeFile(
    path.join(root, 'generated/events.json'),
    JSON.stringify(
      events.sort((a, b) => a.id.localeCompare(b.id)),
      null,
      2,
    ) + '\n',
  );
}
// public/ holds build output only. Starting empty means removed files never linger.
await rm(path.join(root, 'public'), {
  recursive: true,
  force: true,
  maxRetries: 3,
});
await mkdir(path.join(root, 'public/admin'), { recursive: true });
await cp(
  path.join(root, 'admin/index.html'),
  path.join(root, 'public/admin/index.html'),
);
await cp(
  path.join(root, 'admin/style.css'),
  path.join(root, 'public/admin/style.css'),
);
await cp(
  path.join(root, 'admin/assets'),
  path.join(root, 'public/admin/assets'),
  { recursive: true },
);
// Splitting keeps on-demand code, such as the PDF download, in its own file
// next to index.js.
await build({
  entryPoints: [path.join(root, 'admin/index.js')],
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outdir: path.join(root, 'public/admin'),
  // jsPDF's HTML and SVG helpers are unused; its README says to leave their
  // optional libraries external.
  external: ['canvg', 'dompurify', 'html2canvas'],
});
await mkdir(path.join(root, 'public/surveys'), { recursive: true });
for (const file of ['index.html', 'style.css'])
  await cp(
    path.join(root, 'surveys', file),
    path.join(root, 'public/surveys', file),
  );
await build({
  entryPoints: [path.join(root, 'surveys/index.js')],
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outdir: path.join(root, 'public/surveys'),
});
await writeFile(
  path.join(root, 'public/index.html'),
  '<!doctype html><html lang="en"><title>Dallas AI Club services</title><a href="https://dallasai.club">Club website</a> · <a href="/admin/">Club office</a></html>',
);
console.log('Built club admin page and event registry.');
