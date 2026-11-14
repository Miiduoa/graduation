import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const output = path.join(root, 'artifacts/contextual-home');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [path.join(directory, 'fixture.tsx')],
  outfile: path.join(output, 'preview.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  alias: {
    '@': path.join(root, 'apps/web/src'),
    '@campus/shared': path.join(root, 'packages/shared'),
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: {
    '.module.css': 'local-css',
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.png': 'dataurl',
    '.svg': 'dataurl',
  },
  plugins: [
    {
      name: 'standalone-link',
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, () => ({
          path: 'link',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /./, namespace: 'fixture' }, () => ({
          contents:
            'import React from "react"; export default function Link({children,...props}) { return <a {...props}>{children}</a>; }',
          loader: 'jsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>首頁安排元件驗收</title><link rel="stylesheet" href="preview.css">
<style>body{margin:0;background:var(--bg);font-family:system-ui,"Noto Sans CJK TC",sans-serif}main{max-width:820px;margin:24px auto;padding:16px}.fixture{font-size:12px;color:var(--muted);margin-bottom:20px}.fixture button{min-height:44px;margin:4px;padding:8px}button,select,input{font-family:inherit}</style>
</head><body><main><div id="root"></div></main><script type="module" src="preview.js"></script></body></html>`,
);
console.log('Built the actual homepage preference component with isolated test accounts.');
