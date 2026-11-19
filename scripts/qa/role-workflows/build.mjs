import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/role-workflows');
const boundaries = {
  link: `import {createElement} from 'react';
export default function Link({children,prefetch,replace,scroll,...props}) {
  return createElement('a',props,children);
}`,
  shell: `import {createElement} from 'react';
export function SiteShell({children,title,subtitle}) {
  return createElement('section',{'data-fixture-shell':true},
    createElement('h1',null,title), createElement('p',{className:'fixture-subtitle'},subtitle), children);
}`,
  session: `import {NuniError} from '@campus/shared/src/nuni';
const auth = {
  session:{platformAccountId:'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',context:'qa-role-context'},
  loading:false,error:'',pendingLogout:false,refresh:async()=>{},logout:async()=>{}
};
export function useNuniSession() { return auth; } export const useOptionalNuniSession=useNuniSession;
export async function browserRequest(path,context,input,method,query) {
  const verb=method ?? (input === undefined ? 'GET' : 'POST');
  const search=new URLSearchParams(query).toString();
  const response=await fetch('/fixture-api/'+path+(search?'?'+search:''),{
    method:verb,headers:{'Content-Type':'application/json'},
    ...(input===undefined?{}:{body:JSON.stringify(input)})
  });
  const value=await response.json();
  if (!response.ok) throw new NuniError(response.status,value.error || 'FIXTURE_ERROR');
  return value;
}`,
};

await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'fixture.tsx')],
  outfile: path.join(output, 'preview.js'),
  bundle: true,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  alias: {
    '@': path.join(root, 'apps/web/src'),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  loader: {
    '.module.css': 'local-css',
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.png': 'dataurl',
    '.svg': 'dataurl',
  },
  plugins: [
    {
      name: 'isolated-role-boundaries',
      setup(builder) {
        const alias = (filter, name) =>
          builder.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
        alias(/^next\/link$/, 'link');
        alias(/^@\/components\/SiteShell$/, 'shell');
        alias(/^@\/features\/nuni\/Session$/, 'session');
        builder.onLoad({ filter: /./, namespace: 'fixture' }, ({ path: name }) => ({
          contents: boundaries[name],
          loader: 'js',
          resolveDir: root,
        }));
      },
    },
  ],
});
const sourceFiles = {};
for (const filename of Object.keys(result.metafile.inputs).sort()) {
  if (
    filename.startsWith('fixture:') ||
    filename.startsWith('<') ||
    filename.startsWith('(disabled):') ||
    filename.includes('node_modules/')
  )
    continue;
  const bytes = await readFile(path.join(root, filename));
  sourceFiles[filename] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(
  path.join(output, 'build.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope:
        'Actual AccountIdentity/AccountWorkspaces, MerchantWorkspace, MerchantOperations and MerchantOrderDesk with synthetic session/API and a minimal shell; no production login or backend.',
      sourceFiles,
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>角色工作流程元件驗收</title><link rel="stylesheet" href="/preview.css">
<style>body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-ui)}main{max-width:1120px;margin:24px auto;padding:16px}.fixture-note{color:var(--muted);font-size:12px;line-height:1.7;margin-bottom:24px}.fixture-subtitle{color:var(--muted);line-height:1.8;margin-bottom:24px}.fixture-next{margin-top:24px;padding:20px;border:1px solid var(--border);border-radius:var(--radius)}button,select,input,textarea{font-family:inherit}h1{overflow-wrap:anywhere}</style>
</head><body><main><div id="root"></div></main><script type="module" src="/preview.js"></script></body></html>`,
);
console.log(
  `Built actual role workflow components; ${Object.keys(sourceFiles).length} repository source hashes recorded.`,
);
