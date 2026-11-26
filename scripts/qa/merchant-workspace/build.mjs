import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { log } from 'node:console';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/merchant-workspace');
await mkdir(path.join(output, 'icons'), { recursive: true });
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
      name: 'merchant-fixture-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^@campus\/shared$/ }, () => ({
          path: path.join(root, 'packages/shared/src/index.ts'),
        }));
        builder.onResolve(
          {
            filter:
              /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session|privateMessages|campusIntentClient|usePersonalTodayRecords|firebase))$/,
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
await copyFile(
  path.join(root, 'apps/web/public/icons/mark.svg'),
  path.join(output, 'icons/mark.svg'),
);
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
const inputs = [
  ...new Set([
    ...Object.keys(result.metafile.inputs).filter(
      (file) =>
        !file.includes('node_modules/') && !file.startsWith('<') && !file.startsWith('(disabled):'),
    ),
    'scripts/qa/merchant-workspace/build.mjs',
    'scripts/qa/merchant-workspace/check.py',
    'scripts/qa/merchant-workspace/serve.mjs',
    'scripts/qa/merchant-workspace/README.md',
    '.github/workflows/merchant-workspace-browser.yml',
    'package.json',
    'apps/web/package.json',
    'pnpm-lock.yaml',
    'apps/web/public/icons/mark.svg',
  ]),
].sort();
const files = await Promise.all(
  inputs.map(async (file) => ({
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
        'Actual MerchantWorkspace, MerchantOperations, MerchantOrderDesk, SiteShell and CSS. Synthetic local session, merchant memberships and food API; no production writes.',
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
<title>nuni 門市流程驗收｜合成資料</title><link rel="stylesheet" href="/fixture.css">
<style>.fixture-controls{max-width:1120px;margin:48px auto 120px;padding:24px;border-top:1px solid var(--border)}.fixture-controls h2{font-size:1.125rem}.fixture-controls p{font-size:.875rem;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px}.fixture-buttons>button{max-width:100%}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
);
log(
  `Built real merchant workspace; ${files.length} source hashes, ${replaced.size} explicit data/router boundaries.`,
);
