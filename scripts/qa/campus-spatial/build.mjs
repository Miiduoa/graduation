import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/campus-spatial');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { fixture: path.join(directory, 'fixture.tsx'), map: path.join(directory, 'map-fixture.tsx') },
  outdir: output,
  bundle: true,
  splitting: true,
  metafile: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  loader: { '.png': 'file' },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'public-map-only', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/firebase$/ }, () => ({ path: 'no-backend', namespace: 'fixture' }));
    builder.onResolve({ filter: /^@\/components\/AuthGuard$/ }, () => ({ path: 'guest-auth', namespace: 'fixture' }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'plain-link', namespace: 'fixture' }));
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: path.join(directory, 'firestore-fixture.ts') }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: name === 'guest-auth'
        ? 'export const useAuth=()=>({user:null,loading:false,error:null});'
        : name === 'plain-link'
        ? 'import {createElement} from "react"; export default function Link({children,prefetch,replace,scroll,...props}){return createElement("a",props,children)}'
        : 'export const isFirebaseConfigured=()=>true; export const getAuth=()=>({currentUser:null}); export const getDb=()=>null;',
      loader: 'js',
      resolveDir: root,
    }));
    builder.onLoad({ filter: /[\\/]MapCanvas\.tsx$/ }, async ({ path: filename }) => {
      const source = await readFile(filename, 'utf8');
      const url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      if (source.split(url).length !== 2) throw new Error('Map fixture tile boundary changed; review the adapter');
      // Only the tile URL changes. Leaflet, markers, selection and viewport remain production code.
      return { contents: source.replace(url, '/offline-tile.svg'), loader: 'tsx', resolveDir: path.dirname(filename) };
    });
  } }],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(path.join(output, 'scene.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>校園空間導覽元件驗證</title><link rel="stylesheet" href="fixture.css"></head>
<body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
await writeFile(path.join(output, 'map.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>課表教室地圖驗證</title><link rel="stylesheet" href="map.css"></head>
<body><div id="root"></div><script type="module" src="map.js"></script></body></html>`);
await writeFile(path.join(output, 'offline-tile.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#f0f2ee" d="M0 0h256v256H0z"/><path stroke="#d8ddd7" fill="none" d="M0 0H256V256H0Z M128 0V256 M0 128H256"/></svg>');
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>校園空間導覽｜瀏覽器驗證</title><style>
body{margin:0;background:#dddcd7;font-family:system-ui,sans-serif;color:#242b28}header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 20px;background:#fff}button,label{min-height:44px;display:inline-flex;align-items:center;gap:6px}button{padding:8px 12px}iframe{display:block;margin:20px auto;border:1px solid #aaa;background:#fff;max-width:calc(100vw - 24px)}
</style></head><body><header><strong>正式元件 · 公開地點快照</strong>
<button data-width="320" data-height="568">320 × 568</button><button data-width="390" data-height="844">390 × 844</button><button data-width="1200" data-height="820">桌面</button>
<label><input id="dark" type="checkbox">深色</label><label><input id="motion" type="checkbox">停用動畫</label><label><input id="large" type="checkbox">200% 字級</label>
<button id="context">模擬繪圖中斷</button></header><iframe id="device" title="校園導覽預覽" src="scene.html" width="1200" height="820"></iframe>
<script>
const device=document.getElementById('device');
for(const button of document.querySelectorAll('[data-width]'))button.onclick=()=>{device.width=button.dataset.width;device.height=button.dataset.height};
function apply(){const doc=device.contentDocument;if(!doc)return;doc.documentElement.dataset.theme=document.getElementById('dark').checked?'dark':'light';doc.documentElement.dataset.reducedMotion=String(document.getElementById('motion').checked);doc.documentElement.style.fontSize=document.getElementById('large').checked?'32px':'16px'}
for(const id of ['dark','motion','large'])document.getElementById(id).onchange=apply;device.onload=apply;
document.getElementById('context').onclick=()=>device.contentDocument.querySelector('[data-spatial-canvas]')?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
</script></body></html>`);
console.log(`Preview: ${output}/index.html`);
