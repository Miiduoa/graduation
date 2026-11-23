import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/first-value');
await mkdir(output, { recursive: true });
const replaced = new Set();
const result = await build({
  absWorkingDir: root, entryPoints: [path.join(directory, 'fixture.tsx')], outdir: output,
  bundle: true, metafile: true, platform: 'browser', format: 'esm', target: 'es2022',
  jsx: 'automatic', minify: true, tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  plugins: [{
    name: 'first-value-data-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session|privateMessages|usePersonalTodayRecords|firebase))$/ }, (args) => {
        replaced.add(args.path);
        return { path: path.join(directory, 'boundaries.tsx') };
      });
    },
  }],
});
const inputs = [...new Set([
  ...Object.keys(result.metafile.inputs).filter((file) => !file.includes('node_modules/') && !file.startsWith('<') && !file.startsWith('(disabled):')),
  'scripts/qa/first-value/build.mjs', 'scripts/qa/first-value/check.py', 'scripts/qa/first-value/README.md',
  'scripts/qa/browser/install-playwright.sh', '.github/workflows/first-value-browser.yml',
  'package.json', 'apps/web/package.json', 'apps/web/tsconfig.json', 'pnpm-lock.yaml',
  'apps/web/src/components/today/TodayWelcome.test.tsx',
  'apps/web/src/components/today/StudentToday.test.tsx',
  'apps/web/src/components/today/StudentToday.schoolNavigation.test.tsx',
  'apps/web/src/components/today/TodayUnreadNotifications.test.tsx',
  'apps/web/src/components/today/TodayUnreadNotifications.schoolNavigation.test.tsx',
  'apps/web/src/app/page.tsx', 'apps/web/src/app/page.test.tsx',
  'apps/web/src/components/PWAInstallBanner.tsx', 'apps/web/src/components/PWAInstallBanner.test.tsx',
  'apps/web/src/components/PWAInstallObserver.tsx', 'apps/web/src/components/PWAInstallSettings.tsx',
  'apps/web/src/components/PWAInstallSettings.module.css', 'apps/web/src/lib/pwaInstallation.ts',
  'apps/web/src/app/settings/page.tsx', 'apps/web/src/app/settings/page.test.tsx',
  'apps/web/src/app/layout.tsx', 'apps/web/src/app/layout.test.tsx',
])].sort();
const files = await Promise.all(inputs.map(async (file) => ({
  path: file, sha256: createHash('sha256').update(await readFile(path.join(root, file))).digest('hex'),
})));
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(path.join(output, 'source-sha256.json'), JSON.stringify({
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  synthetic: true, replacedImportBoundaries: [...replaced].sort(), files,
  scope: 'Actual StudentToday, TodayWelcome, TodayClassRows, TodayUnreadNotifications and product CSS; synthetic providers and records. Synthetic assistant prop only measures same-scope child continuity. No backend, auth, import completion, production analytics or cross-account assistant isolation claim.',
}, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni 首次價值驗收｜合成資料</title><link rel="stylesheet" href="/fixture.css">
<style>.fixture-controls{margin-top:40px;padding-block:24px;border-top:1px solid var(--border);overflow-wrap:anywhere}.fixture-controls p{font-size:.875rem;line-height:1.7;color:var(--muted)}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.fixture-buttons button{min-height:44px;padding:8px;max-width:100%;font-size:1rem}.fixture-draft{display:grid;gap:8px;padding-block:20px;border-top:1px solid var(--border)}.fixture-draft label{font-size:.875rem;color:var(--muted)}.fixture-draft textarea{min-height:88px;width:100%;max-width:100%;font-size:1rem;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
process.stdout.write(`Built actual first-value UI; ${files.length} source hashes, ${replaced.size} explicit data boundaries.\n`);
