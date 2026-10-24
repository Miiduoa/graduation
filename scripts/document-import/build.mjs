import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const fflateRoot = path.dirname(require.resolve('fflate/package.json'));
const fflateVersion = require(path.join(fflateRoot, 'package.json')).version;
const expectedSheetHash = '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
if (sha(await readFile(path.join(root, 'vendor/xlsx-0.20.3.tgz'))) !== expectedSheetHash)
  throw new Error('SheetJS vendor checksum mismatch');
const embedded = {};
const sources = {};
for (const [directory, kind] of [
  ['cmaps', 'cMapUrl'],
  ['standard_fonts', 'standardFontDataUrl'],
  ['wasm', 'wasmUrl'],
]) {
  for (const name of (await readdir(path.join(pdfRoot, directory))).sort()) {
    if (/LICENSE|quickjs-eval/.test(name)) continue;
    const bytes = await readFile(path.join(pdfRoot, directory, name));
    embedded[`${kind}/${name}`] = bytes.toString('base64');
    sources[`${directory}/${name}`] = sha(bytes);
  }
}
export const assetPlugin = {
  name: 'embedded-document-pdf-assets',
  setup(context) {
    context.onResolve({ filter: /^document-pdf-assets$/ }, () => ({
      path: 'pdf-assets',
      namespace: 'embedded',
    }));
    context.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({
      contents: `export default ${JSON.stringify(embedded)}`,
      loader: 'js',
    }));
  },
};
export async function bundleDocumentReader(entry = 'bridge.ts', platform = 'browser') {
  return build({
    absWorkingDir: root,
    entryPoints: [`scripts/document-import/${entry}`],
    bundle: true,
    write: false,
    platform,
    format: platform === 'node' ? 'cjs' : 'iife',
    packages: platform === 'node' ? 'external' : undefined,
    target: platform === 'node' ? 'node22' : ['safari16.4', 'chrome110'],
    minify: true,
    legalComments: 'inline',
    plugins: [assetPlugin],
    logOverride: { 'empty-import-meta': 'silent' },
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await bundleDocumentReader();
  const bundle = result.outputFiles[0].contents;
  const manifest =
    JSON.stringify(
      {
        sheetjs: {
          version: '0.20.3',
          url: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
          sha256: expectedSheetHash,
        },
        pdfjs: { version: '6.4.299', assets: sources },
        fflate: fflateVersion,
        esbuild: '0.28.2',
        readerSha256: sha(bundle),
      },
      null,
      2,
    ) + '\n';
  const html =
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'unsafe-inline'\"></head><body><script src=\"../ocr/tesseract.min.js\"></script><script src=\"document-reader.js\"></script></body></html>\n";
  const licenses = [
    ['SheetJS CE 0.20.3', path.join(path.dirname(require.resolve('xlsx')), 'LICENSE')],
    ['PDF.js 6.4.299', path.join(pdfRoot, 'LICENSE')],
    [`fflate ${fflateVersion}`, path.join(fflateRoot, 'LICENSE')],
  ];
  let licenseText = '';
  for (const [title, file] of licenses)
    licenseText += `${title}\n${await readFile(file, 'utf8')}\n`;
  for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
    for (const name of (await readdir(path.join(pdfRoot, directory))).sort())
      if (/LICENSE/.test(name))
        licenseText += `${directory}/${name}\n${await readFile(path.join(pdfRoot, directory, name), 'utf8')}\n`;
  const outputs = new Map([
    ['apps/web/public/documents/document-reader.js', bundle],
    ['apps/web/public/documents/reader.html', html],
    ['apps/mobile/assets/documents/document-reader.bin', bundle],
    ['apps/web/public/documents/manifest.json', manifest],
    ['apps/web/public/documents/LICENSES.txt', licenseText],
    ['apps/mobile/assets/documents/LICENSES.txt', licenseText],
  ]);
  for (const [file, value] of outputs) {
    const target = path.join(root, file);
    if (process.argv.includes('--check')) {
      if (sha(await readFile(target)) !== sha(value))
        throw new Error(`Document assets stale: ${file}`);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, value);
    }
  }
  console.log(
    `Document assets ${process.argv.includes('--check') ? 'verified' : 'built'}: ${bundle.length} bytes, sha256 ${sha(bundle)}`,
  );
}
