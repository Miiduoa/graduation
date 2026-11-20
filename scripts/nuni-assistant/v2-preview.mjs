import process from 'node:process';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';
const entry = fileURLToPath(
  new URL('../../apps/web/src/lib/nuni/assistantV2/preview.ts', import.meta.url),
);
const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  logLevel: 'silent',
  tsconfig: fileURLToPath(new URL('../../apps/web/tsconfig.json', import.meta.url)),
});
const { preview } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
try {
  await preview();
} catch {
  process.stderr.write('Preview failed (configuration or fixture error).\n');
  process.exitCode = 1;
}
