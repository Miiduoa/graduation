import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/class-gap-followups');
const mobileRequire = createRequire(path.join(root, 'apps/mobile/package.json'));
const nativeLeaves = {
  '@expo/vector-icons': 'export const Ionicons = () => null;',
  'react-native-safe-area-context': 'export const useSafeAreaInsets = () => ({top:0,right:0,bottom:0,left:0});',
};

await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'fixture.tsx')],
  outfile: path.join(output, 'preview.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
  alias: {
    'react-native': path.dirname(mobileRequire.resolve('react-native-web/package.json')),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  nodePaths: [path.join(root, 'apps/mobile/node_modules'), path.join(root, 'node_modules')],
  define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'unused-native-leaves', setup(builder) {
    builder.onResolve({ filter: /./ }, ({ path: name }) => Object.hasOwn(nativeLeaves, name)
      ? { path: name, namespace: 'native-leaf' } : undefined);
    builder.onLoad({ filter: /./, namespace: 'native-leaf' }, ({ path: name }) => ({ contents: nativeLeaves[name], loader: 'js' }));
  } }],
});
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>空堂查詢元件驗證</title><style>html,body,#root{margin:0;min-height:100%;width:100%}body{font-family:system-ui,"Noto Sans CJK TC",sans-serif}</style>
</head><body><div id="root"></div><script src="preview.js"></script></body></html>`);
