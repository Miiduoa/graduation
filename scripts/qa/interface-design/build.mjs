import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { log } from 'node:console';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/interface-design');
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
      name: 'interface-fixture-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session|privateMessages|campusIntentClient|usePersonalTodayRecords|firebase))$/,
          },
          (args) => {
            // Do not intercept package firebase/* imports or any product UI component.
            replaced.add(args.path);
            return { path: boundary };
          },
        );
      },
    },
  ],
});
const taskFlowBoundary = path.join(directory, 'task-flow-boundaries.tsx');
const taskFlowFirestore = path.join(directory, 'task-flow-firestore.ts');
const taskFlow = await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'task-flow.tsx')],
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
      name: 'task-flow-fixture-data-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^firebase\/firestore$/ }, (args) => {
          if (!/(?:community\/firestore\.ts|StudyBuddyTab\.tsx)$/.test(args.importer)) return;
          replaced.add(`task-flow:${args.path}:${path.relative(root, args.importer)}`);
          return { path: taskFlowFirestore };
        });
        builder.onResolve(
          {
            filter:
              /^(?:next\/(?:link|navigation)|.*\/(?:AuthGuard|SelectedSchoolProvider|Session|privateMessages|campusIntentClient|usePersonalTodayRecords|firebase))$/,
          },
          (args) => {
            replaced.add(`task-flow:${args.path}`);
            return { path: taskFlowBoundary };
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
await writeFile(
  path.join(output, 'task-flow-bundle-meta.json'),
  JSON.stringify(taskFlow.metafile, null, 2),
);
const inputs = [
  ...new Set([
    ...[...Object.keys(result.metafile.inputs), ...Object.keys(taskFlow.metafile.inputs)].filter(
      (file) =>
        !file.includes('node_modules/') && !file.startsWith('<') && !file.startsWith('(disabled):'),
    ),
    'scripts/qa/interface-design/build.mjs',
    'scripts/qa/interface-design/check.py',
    'scripts/qa/interface-design/quick_search.py',
    'scripts/qa/interface-design/task_flow.py',
    'scripts/qa/interface-design/navigation.py',
    'scripts/qa/interface-design/feedback.py',
    'scripts/qa/browser/install-playwright.sh',
    'package.json',
    'apps/web/package.json',
    'pnpm-lock.yaml',
    '.github/workflows/interface-design-browser.yml',
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
      files,
      scope:
        'Actual product components and CSS in both fixtures; synthetic account, school and timetable records. Task-flow forms retain product submission code and use explicit deferred Firestore SDK writes. No production API writes.',
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni 介面驗收｜合成資料</title><link rel="stylesheet" href="/fixture.css">
<style>.fixture-controls{margin-top:32px;padding-top:24px;border-top:1px solid var(--border)}.fixture-controls>p,.fixture-copy{font-size:.875rem;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px}.fixture-buttons>button{max-width:100%}.fixture-reading-space{height:900px}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
);
await writeFile(
  path.join(output, 'task-flow.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni 任務流程驗收｜合成資料</title><link rel="stylesheet" href="task-flow.css">
<style>.fixture-controls{margin-top:32px;padding-top:24px;border-top:1px solid var(--border)}.fixture-controls>p{font-size:.875rem;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}.fixture-buttons{display:flex;flex-wrap:wrap;gap:10px}.fixture-buttons>button{max-width:100%}</style>
</head><body><div id="root"></div><script type="module" src="task-flow.js"></script></body></html>`,
);
log(
  `Built real interface components; ${files.length} source hashes, ${replaced.size} explicit import boundaries.`,
);
