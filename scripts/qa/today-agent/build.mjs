import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/today-agent');
await mkdir(output, { recursive: true });
const boundaries = {
  campus: `export const useCampusBrowseContext=()=>({status:'ready',schoolId:'fixture-campus-a'});`,
  enabled: `export const useAssistantEnabled=()=>true;`,
  link: `import {createElement} from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return createElement('a',props,children)}`,
};
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'fixture.tsx')],
  outdir: output,
  bundle: true,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  loader: { '.png': 'file' },
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'today-agent-fixture-boundaries', setup(builder) {
    const alias = (filter, name) => builder.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
    alias(/^@\/lib\/useCampusBrowseContext$/, 'campus');
    alias(/^@\/components\/AssistantEnabledProvider$/, 'enabled');
    alias(/^next\/link$/, 'link');
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: boundaries[name], loader: 'js', resolveDir: root,
    }));
  } }],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>首頁代辦｜合成 API 瀏覽器驗證</title><link rel="stylesheet" href="fixture.css">
<style>body{margin:0}.fixture-main{max-width:1040px;margin:auto;padding:16px}.fixture-banner{margin:0 0 16px;padding:12px;border-radius:12px;background:#fff5cf;color:#3b331a;font-size:13px;line-height:1.6;overflow-wrap:anywhere}@media(max-width:480px){.fixture-main{padding:12px}}</style>
</head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
console.log(`Built real TodayAgent with synthetic API: ${output}/index.html`);
