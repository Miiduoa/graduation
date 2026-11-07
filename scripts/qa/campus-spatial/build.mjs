import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/campus-spatial');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { fixture: path.join(directory, 'fixture.tsx') },
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
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export const isFirebaseConfigured=()=>false; export function getAuth(){throw new Error("Fixture has no account")}; export function getDb(){throw new Error("Fixture must not access Firestore")}',
      loader: 'js',
    }));
  } }],
});
await writeFile(path.join(output, 'bundle-meta.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(path.join(output, 'scene.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>校園空間導覽元件驗證</title><link rel="stylesheet" href="fixture.css"></head>
<body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
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
