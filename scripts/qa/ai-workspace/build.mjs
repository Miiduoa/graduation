import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/ai-workspace');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const webManifest = JSON.parse(await readFile(path.join(root, 'apps/web/package.json'), 'utf8'));
const runtime = await Promise.all(
  ['react', 'react-dom'].map(async (name) => {
    const declared = webManifest.dependencies[name];
    const override = rootManifest.pnpm?.overrides?.[name] ?? null;
    const expected = override ?? declared;
    const manifestPath = webRequire.resolve(name + '/package.json');
    const manifest = await readFile(manifestPath);
    const installed = JSON.parse(manifest.toString()).version;
    if (installed !== expected) {
      throw new Error(
        `${name}: installed ${installed}, expected pinned ${expected} (Web ${declared}, override ${override})`,
      );
    }
    return {
      name,
      declared,
      override,
      expected,
      installed,
      entryPath: path.relative(root, webRequire.resolve(name)),
      manifestPath: path.relative(root, manifestPath),
      manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    };
  }),
);
await mkdir(path.join(output, 'icons'), { recursive: true });
const replaced = new Set();
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
      name: 'ai-workspace-web-react-runtime',
      setup(builder) {
        builder.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, (args) => ({
          path: webRequire.resolve(args.path),
        }));
      },
    },
    {
      name: 'ai-workspace-infrastructure-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session))$/,
          },
          (args) => {
            replaced.add(args.path);
            return { path: path.join(directory, 'boundaries.tsx') };
          },
        );
      },
    },
  ],
});
const inputs = [
  ...new Set([
    ...Object.keys(result.metafile.inputs).filter(
      (file) =>
        !file.includes('node_modules/') && !file.startsWith('<') && !file.startsWith('(disabled):'),
    ),
    'scripts/qa/ai-workspace/build.mjs',
    'scripts/qa/ai-workspace/check.py',
    'scripts/qa/ai-workspace/README.md',
    'package.json',
    'apps/web/package.json',
    'apps/web/tsconfig.json',
    'pnpm-lock.yaml',
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
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(
  path.join(output, 'source-sha256.json'),
  JSON.stringify(
    {
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      synthetic: true,
      nodeVersion: process.version,
      runtime,
      replacedImportBoundaries: [...replaced].sort(),
      files,
      scope:
        'Actual AssistantWorkspaceProvider, AppHeader, TodayAssistantDisclosure, StudentToday, QuickCampusEntry, Conversation, AssistantThread and product CSS. Synthetic auth/session/campus/routing, home records and capability/ask responses. No production backend, real identity, provider quality, writes, native runtime or deployment claim.',
    },
    null,
    2,
  ),
);
await copyFile(
  path.join(root, 'apps/web/public/icons/mark.svg'),
  path.join(output, 'icons/mark.svg'),
);
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni AI 工作區驗收｜合成資料</title><link rel="stylesheet" href="/fixture.css">
<style>.fixture-controls{margin-top:40px;padding-block:24px;border-top:1px solid var(--border);overflow-wrap:anywhere}.fixture-controls p,.fixture-note{font-size:.875rem;line-height:1.7;color:var(--muted)}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.fixture-buttons button,.fixture-destination a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px;max-width:100%;font-size:1rem}.fixture-destination{min-height:40vh;overflow-wrap:anywhere}.fixture-destination nav{display:flex;gap:16px;flex-wrap:wrap}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
);
process.stdout.write(
  `Built actual AI workspace UI; ${files.length} source hashes, ${replaced.size} infrastructure import boundaries.\n`,
);
