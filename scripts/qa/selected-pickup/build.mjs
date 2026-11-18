import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { log } from 'node:console';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/selected-pickup');
await mkdir(output, { recursive: true });
const modules = {
  session: `export function useNuniSession(){const c=window.__pickupQA;return {loading:false,pendingLogout:false,error:'',session:{context:c.context,platformAccountId:c.accountId},refresh:async()=>{}};}
    export async function browserRequest(path,context,input,method,query){if(input!==undefined||method&&method!=='GET')throw Error('Fixture forbids customer writes');const r=await fetch('/qa/platform/'+path+(query?'?'+new URLSearchParams(query):''),{cache:'no-store',headers:{'X-Campus-Session':context}});if(!r.ok)throw Error('Fixture customer read failed');return r.json();}`,
  campus: `export const useCampusBrowseContext=()=>({status:'ready',schoolId:window.__pickupQA.schoolId});`,
  enabled: `export const useAssistantEnabled=()=>true;`,
  link: `import {createElement} from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return createElement('a',props,children)}`,
  image: `import {createElement} from 'react'; export default function Image({unoptimized,priority,...props}){return createElement('img',props)}`,
  shell: `import {createElement} from 'react'; export function SiteShell({children,title,subtitle}){return createElement('main',{className:'fixture-main'},createElement('h1',null,title),createElement('p',null,subtitle),children)}`,
  signin: `import {createElement} from 'react';export const NuniSignIn=()=>createElement('p',null,'合成帳號');`,
};
const client = await build({
  absWorkingDir: root, entryPoints: [path.join(directory, 'fixture.tsx')], outdir: output,
  bundle: true, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  jsx: 'automatic', loader: { '.png': 'file' }, tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'selected-pickup-client-boundaries', setup(builder) {
    const alias = (filter, name) => builder.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
    alias(/^@\/features\/nuni\/Session$/, 'session');
    alias(/^@\/lib\/useCampusBrowseContext$/, 'campus');
    alias(/^@\/components\/AssistantEnabledProvider$/, 'enabled');
    alias(/^@\/components\/SiteShell$/, 'shell');
    alias(/^@\/components\/NuniSignIn$/, 'signin');
    alias(/^next\/link$/, 'link'); alias(/^next\/image$/, 'image');
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: modules[name], loader: 'js', resolveDir: root }));
  } }],
});
const server = await build({
  absWorkingDir: root, entryPoints: [path.join(directory, 'server.ts')], outfile: path.join(output, 'server.cjs'),
  bundle: true, metafile: true, platform: 'node', format: 'cjs', target: 'node22',
  tsconfig: path.join(root, 'apps/web/tsconfig.json'), external: ['next/server'],
  plugins: [{ name: 'selected-pickup-server-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/adapter$/ }, ({ importer }) => importer.endsWith('/assistantV2/handler.ts')
      ? { path: path.join(directory, 'serverBoundary.ts') } : undefined);
    builder.onResolve({ filter: /^\.\/groq$/ }, ({ importer }) => importer.endsWith('/assistantV2/handler.ts')
      ? { path: path.join(directory, 'serverModel.ts') } : undefined);
  } }],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify({ client: client.metafile, server: server.metafile }, null, 2));
const sources = [...new Set([...Object.keys(client.metafile.inputs), ...Object.keys(server.metafile.inputs)])]
  .filter(name => !['fixture:', '<', '(disabled):'].some(prefix => name.startsWith(prefix)) && !name.includes('node_modules/')).sort();
const hashes = Object.fromEntries(await Promise.all(sources.map(async name => [name,
  createHash('sha256').update(await readFile(path.resolve(root, name))).digest('hex')])));
await writeFile(path.join(output, 'build-source-hashes.json'), JSON.stringify(hashes, null, 2));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>指定訂單取餐行程驗證</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.fixture-main{max-width:1040px;margin:auto;padding:16px}.fixture-banner{margin:0;padding:12px;background:#fff5cf;color:#3b331a;font-size:13px;line-height:1.6;overflow-wrap:anywhere}@media(max-width:480px){.fixture-main{padding:12px}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
log(`Built actual FoodWorkspace and handleV2 with synthetic service boundaries: ${output}`);
