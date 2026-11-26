import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../artifacts/merchant-workspace',
);
const port = Number(process.env.MERCHANT_QA_PORT || 4178);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end('Read-only fixture');
    return;
  }
  try {
    const pathname = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname;
    const asset = [
      '/fixture.js',
      '/fixture.css',
      '/icons/mark.svg',
      '/source-sha256.json',
      '/bundle-meta.json',
    ].includes(pathname)
      ? pathname.slice(1)
      : 'index.html';
    const content = await readFile(path.join(root, asset));
    response.writeHead(200, {
      'Content-Type': mime[path.extname(asset)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404);
    response.end('Build the fixture before starting this server');
  }
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Merchant workspace fixture: http://127.0.0.1:${port}/merchant/workspace\n`);
});
