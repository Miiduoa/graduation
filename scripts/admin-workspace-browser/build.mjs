import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../..');
const web = path.join(root, 'apps/web');
const output = path.resolve(process.env.ADMIN_BROWSER_OUTPUT || path.join(root, 'tmp/admin-workspace-browser'));
const dist = path.join(output, 'dist');
await mkdir(dist, { recursive: true });

// Bundle the production workbench and styles. Only authentication, Next's
// navigation adapter and the surrounding site chrome are replaced by fixtures.
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [path.join(fixture, 'entry.tsx')],
  outdir: dist,
  bundle: true,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    '@/components/SiteShell': path.join(fixture, 'shell.tsx'),
    '@/features/nuni/Session': path.join(fixture, 'session.tsx'),
    'next/link': path.join(fixture, 'link.tsx'),
    'next/navigation': path.join(fixture, 'navigation.ts'),
    '@': path.join(web, 'src'),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  loader: {
    '.module.css': 'local-css',
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
  },
});

await mkdir(path.join(dist, 'icons'), { recursive: true });
await writeFile(path.join(dist, 'icons/mark.svg'), await readFile(path.join(web, 'public/icons/mark.svg')));
await writeFile(path.join(dist, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>平台管理工作台介面驗收</title><link rel="stylesheet" href="/entry.css">
<style>body{margin:0;font-family:system-ui,"Noto Sans CJK TC",sans-serif}.fixture-note{margin:0;padding:6px 16px;text-align:center;font-size:12px;color:var(--muted);background:var(--bg-soft)}</style>
</head><body><p class="fixture-note">介面驗收 · 合成學校、帳號與申請資料</p>
<div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);

const sourcePaths = [...new Set([
  ...Object.keys(bundle.metafile.inputs).filter((name) => !name.includes('node_modules/')),
  'scripts/admin-workspace-browser/build.mjs',
  'scripts/admin-workspace-browser/run.py',
  'package.json',
  'apps/web/package.json',
  'pnpm-lock.yaml',
])].sort();
const sourceFiles = {};
for (const name of sourcePaths) {
  sourceFiles[name] = createHash('sha256').update(await readFile(path.resolve(root, name))).digest('hex');
}
const sourceDigest = createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const metadata = {
  sourceHead: revision,
  sourceDigest,
  sourceFiles,
  generatedAt: new Date().toISOString(),
  browserValidated: false,
  bundledOutputs: await readdir(dist),
};
await writeFile(path.join(output, 'build.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ output, sourceHead: revision, sourceDigest, inputs: sourcePaths.length }));
