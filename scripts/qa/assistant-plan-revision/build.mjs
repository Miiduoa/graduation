import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/assistant-plan-revision');
await mkdir(output, { recursive: true });
const modules = {
  session: `import {useSyncExternalStore} from 'react'; const subscribe=callback=>{window.addEventListener('qa-account',callback);return()=>window.removeEventListener('qa-account',callback)}; export function useNuniSession(){const account=useSyncExternalStore(subscribe,()=>window.__agentQA.account);return {loading:false,pendingLogout:false,error:null,session:{context:(account==='qa-agent'?'a':'b').repeat(43),platformAccountId:account}};}`,
  campus: `import {useSyncExternalStore} from 'react'; const subscribe=callback=>{window.addEventListener('qa-school',callback);return()=>window.removeEventListener('qa-school',callback)}; export const useCampusBrowseContext=()=>({status:'ready',schoolId:useSyncExternalStore(subscribe,()=>window.__agentQA.school)});`,
  navigation: `export const useSearchParams=()=>new URLSearchParams(location.search);`,
  link: `import {createElement} from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return createElement('a',props,children)}`,
  shell: `import {createElement} from 'react'; export function SiteShell({children,title}){return createElement('main',null,createElement('h1',null,title),children)}`,
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
  plugins: [{ name: 'fixed-assistant-boundaries', setup(builder) {
    const alias = (filter, name) => builder.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
    alias(/^@\/lib\/useCampusBrowseContext$/, 'campus');
    alias(/^@\/components\/SiteShell$/, 'shell');
    alias(/^next\/navigation$/, 'navigation');
    alias(/^next\/link$/, 'link');
    builder.onResolve({ filter: /^\.\/Session$/ }, ({ importer }) => importer.endsWith('/features/nuni/Assistant.tsx')
      ? { path: 'session', namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: modules[name], loader: 'js', resolveDir: root,
    }));
  } }],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>助理修改預覽｜固定假資料瀏覽器驗證</title><link rel="stylesheet" href="fixture.css">
<style>body{margin:0;font-family:system-ui,sans-serif}main{padding:16px;max-width:1040px;margin:auto}.fixture-banner{padding:12px;background:#fff5cf;color:#3b331a;overflow-wrap:anywhere}.fixture-banner select{max-width:100%;min-height:44px}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #174ea6;outline-offset:2px}</style>
</head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
console.log(`Built actual Assistant with fixed API fixture: ${output}/index.html`);
