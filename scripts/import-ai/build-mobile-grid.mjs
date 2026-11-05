import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const asset = new URL('../../apps/mobile/assets/ocr/ruled-timetable-grid.bin', import.meta.url);
const result = await build({
  absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
  entryPoints: ['packages/shared/src/imports/ruledTimetableGrid.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'TimetableGrid',
  target: ['safari16.4', 'chrome110'],
  minify: true,
});
const bytes = Buffer.from(result.outputFiles[0].contents);
if (process.argv.includes('--check')) {
  if (!bytes.equals(await readFile(asset))) {
    throw new Error('Rebuild the Expo OCR asset with node scripts/import-ai/build-mobile-grid.mjs');
  }
} else {
  await writeFile(asset, bytes);
}
