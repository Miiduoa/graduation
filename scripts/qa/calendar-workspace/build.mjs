import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/calendar-workspace');
await mkdir(output, { recursive: true });
const replaced = new Set();
const boundary = path.join(directory, 'boundaries.tsx');
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'fixture.tsx')],
  outdir: output,
  bundle: true,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  plugins: [
    {
      name: 'calendar-fixture-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^@campus\/shared$/ }, () => ({
          path: path.join(root, 'packages/shared/src/index.ts'),
        }));
        builder.onResolve(
          {
            filter:
              /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session|homeOverview))$/,
          },
          (args) => {
            replaced.add(args.path);
            return { path: boundary };
          },
        );
      },
    },
  ],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
const sources = [
  ...new Set([
    ...Object.keys(result.metafile.inputs).filter(
      (file) =>
        !file.includes('node_modules/') && !file.startsWith('<') && !file.startsWith('(disabled):'),
    ),
    'scripts/qa/calendar-workspace/build.mjs',
    'scripts/qa/calendar-workspace/check.py',
    'scripts/qa/calendar-workspace/README.md',
    'scripts/qa/browser/install-playwright.sh',
    '.github/workflows/calendar-workspace-browser.yml',
    'package.json',
    'apps/web/package.json',
    'pnpm-lock.yaml',
    'apps/web/tsconfig.json',
  ]),
].sort();
const files = await Promise.all(
  sources.map(async (file) => ({
    path: file,
    sha256: createHash('sha256')
      .update(await readFile(path.join(root, file)))
      .digest('hex'),
  })),
);
await writeFile(
  path.join(output, 'source-sha256.json'),
  JSON.stringify(
    {
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      synthetic: true,
      replacedImportBoundaries: [...replaced].sort(),
      scope:
        'Actual PersonalCalendar, MonthCalendar, personalImports, usePersonalImports and CSS; synthetic session/school/LMS/router boundaries, isolated local storage and no external writes. Minimal fixture shell.',
      files,
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni 行事曆流程驗收｜合成資料</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css">
<style>.fixture-controls{margin-top:40px;padding-top:24px;border-top:1px solid var(--border)}.fixture-controls h2{font-size:1.125rem}.fixture-controls p{font-size:.875rem;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px}.fixture-buttons>button{max-width:100%}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
);
console.log(
  `Built calendar flow fixture with ${files.length} source hashes and ${replaced.size} explicit boundaries.`,
);
