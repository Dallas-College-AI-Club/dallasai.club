import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'espree';
import postcss from 'postcss';

function validate() {
  const site = path.join(import.meta.dirname, 'public');
  const errors = [];
  const modules = new Map();
  const referencedAssets = new Set();
  const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (['assets', 'vendor'].includes(entry.name)) return [];
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : [file];
    });
  const relative = (file) => path.relative(site, file).replaceAll(path.sep, '/');
  function checkReference(from, ref) {
    if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref) || ref.includes('${')) return;
    const clean = ref.split(/[?#]/)[0];
    if (!clean || clean.startsWith('/api/')) return;
    const target = clean.startsWith('/')
      ? path.resolve(site, '.' + clean)
      : path.resolve(path.dirname(from), clean);
    if (target === path.join(site, 'review-feed.xml')) return;
    if (!fs.existsSync(target)) errors.push(`${relative(from)} → missing ${ref}`);
    if (target.startsWith(path.join(site, 'assets') + path.sep)) referencedAssets.add(target);
  }
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
      else if (value && typeof value === 'object') walk(value, visit);
    }
  }
  for (const file of files(site)) {
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.js')) {
      const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
      const imports = [],
        exports = new Set();
      walk(ast, (node) => {
        if (
          [
            'ImportDeclaration',
            'ExportNamedDeclaration',
            'ExportAllDeclaration',
            'ImportExpression',
          ].includes(node.type) &&
          node.source?.value
        ) {
          const ref = node.source.value;
          if (ref.startsWith('.')) {
            checkReference(file, ref);
            imports.push({
              file: path.resolve(path.dirname(file), ref),
              names:
                node.type === 'ImportDeclaration'
                  ? node.specifiers
                      .filter((s) => s.type === 'ImportSpecifier')
                      .map((s) => s.imported.name)
                  : [],
            });
          }
        }
        if (node.type === 'ExportNamedDeclaration') {
          if (node.declaration?.id) exports.add(node.declaration.id.name);
          for (const declaration of node.declaration?.declarations || [])
            exports.add(declaration.id.name);
          for (const specifier of node.specifiers || []) exports.add(specifier.exported.name);
        }
        if (node.type === 'ExportDefaultDeclaration') exports.add('default');
        if (
          node.type === 'Literal' &&
          typeof node.value === 'string' &&
          /^(assets\/|[\w-]+\.json$)/.test(node.value) &&
          /\.[a-z0-9]+$/i.test(node.value)
        ) {
          checkReference(path.join(site, 'club.html'), node.value);
        }
      });
      // Rendered markup also contains asset attributes and local page links.
      for (const [, ref] of source.matchAll(/(?:src|href)=["']([^"']+)["']/g))
        checkReference(path.join(site, 'club.html'), ref);
      modules.set(file, { imports, exports });
    } else if (file.endsWith('.css')) {
      postcss.parse(source, { from: file });
      for (const [, ref] of source.matchAll(/url\(['"]?([^'"()]+)['"]?\)/g))
        checkReference(file, ref);
    } else if (file.endsWith('.html')) {
      for (const [, ref] of source.matchAll(/(?:src|href)=["']([^"']+)["']/g))
        checkReference(file, ref);
    }
  }
  for (const [file, module] of modules)
    for (const imported of module.imports) {
      const target = modules.get(imported.file);
      if (target)
        for (const name of imported.names)
          if (!target.exports.has(name))
            errors.push(
              `${relative(file)} imports missing export ${name} from ${relative(imported.file)}`,
            );
    }
  const reachable = new Set();
  function visit(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const imported of modules.get(file)?.imports || []) visit(imported.file);
  }
  for (const page of files(site).filter((file) => file.endsWith('.html'))) {
    const source = fs.readFileSync(page, 'utf8');
    for (const [, ref] of source.matchAll(/<script[^>]+src="([^"]+)"/g))
      visit(path.resolve(path.dirname(page), ref));
  }
  for (const file of modules.keys())
    if (!reachable.has(file)) errors.push(`Unused site module: ${relative(file)}`);

  // Dynamic paths are declared explicitly instead of exempting the whole media folder.
  const assetGroups = {
    dynamic: [
      {
        directory: 'assets/mascots',
        suffix: '-mark.webp',
        reason: 'Vehicle flags use the selected campus ID to construct the filename.',
      },
      {
        directory: 'assets/page-previews',
        suffix: '.png',
        reason: 'Arrival previews use the destination mode to construct the filename.',
      },
    ],
    notices: ['LICENSE', 'OFL', 'README'],
  };
  for (const group of assetGroups.dynamic) {
    const directory = path.join(site, group.directory);
    if (!fs.existsSync(directory)) {
      errors.push(`Missing dynamic asset directory: ${group.directory}`);
      continue;
    }
    for (const name of fs.readdirSync(directory)) {
      if (name.endsWith(group.suffix)) referencedAssets.add(path.join(directory, name));
    }
  }
  const unusedAssets = files(path.join(site, 'assets')).filter(
    (file) =>
      !referencedAssets.has(file) &&
      !assetGroups.notices.some((word) => path.basename(file).toUpperCase().includes(word)),
  );
  if (process.argv.includes('--list-unused-assets')) {
    console.log(
      JSON.stringify(
        unusedAssets.map((file) => ({ file: relative(file), bytes: fs.statSync(file).size })),
        null,
        2,
      ),
    );
  } else {
    for (const file of unusedAssets) errors.push(`Unused site asset: ${relative(file)}`);
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `PASS: all ${modules.size} first-party modules parse, link, and are reachable; HTML, CSS and static asset references resolve.`,
    );
}

function test() {
  const tests = fs
    .readdirSync(path.join(import.meta.dirname, 'tests'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(import.meta.dirname, 'tests', name));
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=spec', ...tests],
    { cwd: import.meta.dirname, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (!process.argv.includes('--test')) validate();
if (
  !process.exitCode &&
  !process.argv.includes('--validate') &&
  !process.argv.includes('--list-unused-assets')
)
  test();
