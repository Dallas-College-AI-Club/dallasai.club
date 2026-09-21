import {
  readFile,
  writeFile,
  mkdir,
  cp,
  readdir,
  stat,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const content = path.resolve(root, '../content/events');
await mkdir(path.join(root, 'generated'), { recursive: true });
if (await stat(content).catch(() => null)) {
  const events = [];
  for (const name of await readdir(content)) {
    if (!name.endsWith('.md')) continue;
    const source = await readFile(path.join(content, name), 'utf8');
    const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!header) continue;
    const value = parse(header[1]);
    if (
      !value.id ||
      value.draft ||
      new Date(value.publishDate || 0) > new Date()
    )
      continue;
    events.push({
      id: value.id,
      title: value.title,
      date: value.eventDate,
      end: value.end || null,
      location: value.location || '',
    });
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
await mkdir(path.join(root, 'public/admin'), { recursive: true });
await cp(
  path.join(root, 'admin/index.html'),
  path.join(root, 'public/admin/index.html'),
);
await cp(
  path.join(root, 'admin/style.css'),
  path.join(root, 'public/admin/style.css'),
);
await build({
  entryPoints: [path.join(root, 'admin/index.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: path.join(root, 'public/admin/index.js'),
});
await writeFile(
  path.join(root, 'public/index.html'),
  '<!doctype html><html lang="en"><title>Dallas AI Club services</title><a href="https://dallasai.club">Club website</a> · <a href="/admin/">Club office</a></html>',
);
console.log('Built club admin page and event registry.');
