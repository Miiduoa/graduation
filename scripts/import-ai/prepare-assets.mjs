import { createHash } from 'node:crypto';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const transformersRequire = createRequire(require.resolve('@huggingface/transformers'));
const runtimeRoot = path.resolve(
  path.dirname(transformersRequire.resolve('onnxruntime-web')),
  '..',
);
const expectedVersion = '1.31.0-dev.20260914-8d85527a0';
const runtime = JSON.parse(await readFile(path.join(runtimeRoot, 'package.json'), 'utf8'));
if (runtime.version !== expectedVersion) {
  throw new Error(
    `Import AI runtime changed (${runtime.version}). Review the worker and local assets before updating the pinned version.`,
  );
}
const output = path.join(root, 'apps/web/public/ai/onnxruntime', expectedVersion);
await mkdir(output, { recursive: true });
const manifest = { version: expectedVersion, files: {} };
for (const file of [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]) {
  const bytes = await readFile(path.join(runtimeRoot, 'dist', file));
  await writeFile(path.join(output, file), bytes);
  manifest.files[file] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
await writeFile(
  path.join(output, 'LICENSE'),
  await readFile(path.join(root, 'scripts/import-ai/ONNXRUNTIME-LICENSE')),
);
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
log(`Prepared same-origin import AI runtime ${expectedVersion}.`);
