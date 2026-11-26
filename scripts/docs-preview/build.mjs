import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const output = path.join(root, 'artifacts/docs-preview');
const require = createRequire(path.join(root, 'package.json'));
const mobileRequire = createRequire(path.join(root, 'apps/mobile/package.json'));
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = execFileSync(
  'git',
  [
    'status',
    '--porcelain',
    '--untracked-files=no',
    '--',
    'apps/mobile/src',
    'packages/shared/src',
    'scripts/qa/saved-campus-plans/fixture.tsx',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();
const { build } = require('esbuild');
const nativeLeaves = {
  '@expo/vector-icons': 'export const Ionicons = () => null;',
  'react-native-safe-area-context':
    'export const useSafeAreaInsets = () => ({top:0,right:0,bottom:0,left:0});',
  './CampusAssignmentReminderAction':
    'export function CampusAssignmentReminderAction(){throw new Error("No native reminder in this presentation fixture");}',
  './CampusAssignmentOpenButton':
    'export function CampusAssignmentOpenButton(){throw new Error("No native assignment navigation in this presentation fixture");}',
};
const disabledFirebase = `
const disabled = () => { throw new Error('Firebase is disabled in the README component preview'); };
export const getAuthInstance = () => ({ currentUser: null });
export const isFirebaseMockMode = () => false;
export const hasUsableFirebaseConfig = () => false;
export const getDb = disabled;
export const getFunctionsInstance = disabled;
export const getFirebaseApp = disabled;
export const getStorageInstance = disabled;
`;
const memoryStorage = `
const values = new Map();
export default {
  getItem: async key => values.get(key) ?? null,
  setItem: async (key,value) => { values.set(key,value); },
  removeItem: async key => { values.delete(key); },
  multiGet: async keys => keys.map(key => [key,values.get(key) ?? null]),
  multiSet: async pairs => { for(const [key,value] of pairs) values.set(key,value); },
  multiRemove: async keys => { for(const key of keys) values.delete(key); },
  getAllKeys: async () => [...values.keys()],
  clear: async () => { values.clear(); }
};`;

await mkdir(output, { recursive: true });
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  alias: {
    'react-native': path.dirname(mobileRequire.resolve('react-native-web/package.json')),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  nodePaths: [path.join(root, 'apps/mobile/node_modules'), path.join(root, 'node_modules')],
  define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  plugins: [
    {
      name: 'presentation-only-native-leaves',
      setup(builder) {
        builder.onResolve({ filter: /./ }, ({ path: name, importer }) => {
          if (Object.hasOwn(nativeLeaves, name)) return { path: name, namespace: 'native-leaf' };
          if (name === '@react-native-async-storage/async-storage')
            return { path: 'memory-storage', namespace: 'native-leaf' };
          if (
            /^(?:\.\.\/|\.\/)+firebase$/.test(name) &&
            importer.startsWith(path.join(root, 'apps/mobile/src'))
          )
            return { path: 'disabled-firebase', namespace: 'native-leaf' };
        });
        builder.onLoad({ filter: /./, namespace: 'native-leaf' }, ({ path: name }) => ({
          contents:
            name === 'disabled-firebase'
              ? disabledFirebase
              : name === 'memory-storage'
                ? memoryStorage
                : nativeLeaves[name],
          loader: 'js',
        }));
      },
    },
  ],
};

const original = await build({
  ...common,
  entryPoints: [path.join(root, 'scripts/qa/saved-campus-plans/fixture.tsx')],
  outfile: path.join(output, 'saved-plans-preview.js'),
});

const showcase = await build({
  ...common,
  entryPoints: [path.join(here, 'fixture.tsx')],
  outfile: path.join(output, 'showcase.js'),
});

function page(title, script, scene = '') {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body,#root{margin:0;min-height:100%;width:100%}body{font-family:system-ui,"Noto Sans CJK TC",sans-serif}</style></head><body data-scene="${scene}"><div id="root"></div><script src="${script}"></script></body></html>`;
}
await writeFile(
  path.join(output, 'gallery.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>nuni｜課業助理元件展示</title>
<style>
*{box-sizing:border-box}html,body{margin:0;background:#e9e8e4;color:#252b33;font-family:system-ui,"Noto Sans CJK TC",sans-serif}
main{width:max-content;margin:0 auto;padding:12px 18px}
header{display:flex;align-items:center;gap:14px;height:24px;margin-bottom:8px}
h1{margin:0;font-size:20px;line-height:24px;font-weight:750;letter-spacing:-.5px}
header p{margin:0;font-size:12px;line-height:20px;color:#53605e}
.gallery{display:grid;grid-template-columns:repeat(3,390px);gap:14px}
section h2{margin:0 0 4px;font-size:13px;line-height:20px;font-weight:650}
iframe{display:block;width:390px;height:844px;border:1px solid #c6c8c5;background:white}
</style></head><body><main>
<header><h1>nuni</h1><p>正式元件・合成資料・React Native Web</p></header>
<div class="gallery">
<section><h2>課業計畫</h2><iframe title="課業計畫" src="plan.html"></iframe></section>
<section><h2>已儲存計畫</h2><iframe title="已儲存計畫" src="saved.html"></iframe></section>
<section><h2>確認準備行程</h2><iframe title="確認準備行程" src="confirm.html"></iframe></section>
</div></main></body></html>`,
);
await writeFile(
  path.join(output, 'gallery-dark.html'),
  (await readFile(path.join(output, 'gallery.html'), 'utf8')).replace(
    /src="(plan|saved|confirm)\.html"/g,
    'src="$1.html?theme=dark"',
  ),
);
await writeFile(
  path.join(output, 'saved-plans-preview.html'),
  page('nuni｜原有計畫元件驗證', 'saved-plans-preview.js'),
);
for (const [scene, title] of [
  ['plan', '課業計畫'],
  ['saved', '已儲存計畫'],
  ['confirm', '作業準備行程確認'],
]) {
  await writeFile(path.join(output, scene + '.html'), page('nuni｜' + title, 'showcase.js', scene));
  await writeFile(
    path.join(output, 'phone-' + scene + '.html'),
    `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nuni ${title}｜390 × 844 元件展示</title><style>html,body{margin:0;background:#e9e8e4;color:#252b33;font-family:system-ui,"Noto Sans CJK TC",sans-serif}main{width:max-content;max-width:100%;margin:20px auto}p{max-width:390px;margin:0 0 10px;font-size:13px;line-height:1.6}iframe{display:block;width:390px;height:844px;border:1px solid #c6c8c5;background:white}</style></head><body><main><p><strong>nuni · ${title}</strong><br>目前 main 真實元件／合成示範資料／React Native Web</p><iframe title="${title}" src="${scene}.html"></iframe></main></body></html>`,
  );
}
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>nuni README 畫面展示</title><style>body{font-family:system-ui,"Noto Sans CJK TC",sans-serif;background:#f4f3ef;color:#222;padding:24px}p,li{line-height:1.8}a{color:#075fad}</style></head><body><h1>nuni README 畫面展示</h1><p>來源版本：${gitHead}${sourceDirty ? '（元件有未提交修改）' : ''}。使用真實元件與合成示範資料；未連接正式帳號或平台，非原生實機截圖。</p><ul><li><a href="gallery.html">三個正式元件並列展示</a> · <a href="gallery-dark.html">深色展示</a></li><li><a href="phone-plan.html">390 × 844 課業計畫</a> · <a href="plan.html">直接開啟</a></li><li><a href="phone-saved.html">390 × 844 已儲存計畫</a> · <a href="saved.html">直接開啟</a></li><li><a href="phone-confirm.html">390 × 844 準備行程確認</a> · <a href="confirm.html">直接開啟</a></li><li><a href="saved-plans-preview.html?scenario=quiz">原有 QA：作業與測驗計畫</a></li><li><a href="saved-plans-preview.html">原有 QA：已儲存計畫</a></li></ul><p>直接頁面可加 ?theme=dark；原有 QA 的參數保留。所有 API 與導航為受控展示，不能拿來宣稱端到端驗收通過。</p></body></html>`,
);
const sourceInputs = [
  ...new Set([
    ...Object.keys(original.metafile.inputs),
    ...Object.keys(showcase.metafile.inputs),
    fileURLToPath(import.meta.url),
  ]),
]
  .filter((file) => !file.startsWith('native-leaf:') && !file.includes('node_modules'))
  .map((file) => path.resolve(root, file))
  .filter((file) => file.startsWith(root + path.sep))
  .sort();
const sourceHashes = [];
for (const file of sourceInputs)
  sourceHashes.push({
    path: path.relative(root, file),
    sha256: createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
  });
const manifest = {
  sourceCommit: gitHead,
  sourceDirty: sourceDirty || null,
  sourceHashes,
  builtAt: new Date().toISOString(),
  fixtureClock: '2026-11-08T02:00:00.000Z',
  dependencies: Object.fromEntries(
    ['esbuild', 'react', 'react-dom', 'react-native-web'].map((name) => [
      name,
      (name === 'esbuild' ? require : mobileRequire)(name + '/package.json').version,
    ]),
  ),
  sourceComponents: [
    'CampusEvidencePlanCard',
    'CampusStudyAgendaCard',
    'SavedCampusPlansPanel',
    'NuniStudyPlanActions',
    'NuniPlanAssignmentOpenButton',
    'NuniCourseworkStudyAction',
    'AICard',
    'AIButton',
  ],
  sourceDirectories: ['apps/mobile/src', 'packages/shared/src'],
  stubs: [
    'Ionicons omitted, as in existing QA fixture',
    'Safe area insets zero, as in existing QA fixture',
    'Unused native reminder/assignment leaves throw',
    'AsyncStorage isolated in-memory Map',
    'Firebase initialization and APIs disabled',
    'Synthetic platform account/source/current flags',
    'Injected exact-target readers return unavailable; navigation only records events',
    'Date.now fixed to fixtureClock',
  ],
  untouched:
    'Presentation uses application components and current shared-package source without editing them. See sourceDirty and sourceHashes for the exact input state.',
  verification:
    'Build only. Browser inspection is separate. Does not certify login, platform data, native rendering, writes or integration.',
};
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output,
    files: [
      'index.html',
      'gallery.html',
      'gallery-dark.html',
      'phone-plan.html',
      'phone-saved.html',
      'phone-confirm.html',
      'plan.html',
      'saved.html',
      'confirm.html',
      'saved-plans-preview.html',
    ],
    versions: manifest.dependencies,
  }),
);
