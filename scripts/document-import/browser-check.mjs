// Local-only browser fixture harness. Run with Node 22; does not upload documents.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adapter = await build({
  absWorkingDir: root,
  stdin: {
    contents:
      "import { readPersonalImportDocumentFile } from './apps/web/src/lib/personalImportDocuments'; import { parsePersonalImportDocument } from './packages/shared/src/imports/documents'; window.readFixtureDocument = readPersonalImportDocumentFile; window.parseFixtureDocument = parsePersonalImportDocument;",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><title>Campus document reader fixture check</title><p>Local document parser fixture check</p><script src="/adapter.js"></script>',
      );
      return;
    }
    if (pathname === '/adapter.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(adapter.outputFiles[0].contents);
      return;
    }
    const base = pathname.startsWith('/fixtures/') ? 'scripts/document-import' : 'apps/web/public';
    if (!/^\/(?:fixtures|documents|ocr)\/[\w./-]+$/.test(pathname) || pathname.includes('..'))
      throw new Error('path');
    const file = path.join(root, base, pathname);
    const type = path.extname(file);
    response.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.wasm': 'application/wasm',
        '.pdf': 'application/pdf',
      }[type] || 'application/octet-stream',
    );
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`Document fixture harness http://127.0.0.1:${server.address().port}`),
);
