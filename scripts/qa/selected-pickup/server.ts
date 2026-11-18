import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { handleV2 } from '../../../apps/web/src/lib/nuni/assistantV2/handler';
import { sealCookie, SESSION_COOKIE } from '../../../apps/web/src/lib/nuni/server';
import { config, current, customerRead, reset, snapshot } from './serverBoundary';

const output = path.resolve(process.argv[2] || 'artifacts/selected-pickup');
reset();
globalThis.fetch = async input => {
  current().externalFetches.push(String(input));
  throw new Error('Synthetic browser fixture refuses every external service/model request');
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) { chunks.push(Buffer.from(chunk)); if (Buffer.concat(chunks).length > 16384) throw new Error('Body limit'); }
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/qa/reset' && req.method === 'POST') return json(reset());
    if (url.pathname === '/qa/configure' && req.method === 'POST') {
      const value = JSON.parse(body);
      if (Object.keys(value).some(key => key !== 'holdNextConfirmation') || typeof value.holdNextConfirmation !== 'boolean') throw new Error('Invalid fault');
      current().holdNextConfirmation = value.holdNextConfirmation;
      return json({ ok: true });
    }
    if (url.pathname === '/qa/snapshot' && req.method === 'GET') return json(snapshot());
    if (url.pathname === '/qa/config' && req.method === 'GET') {
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, current().session)}; Path=/; HttpOnly; SameSite=Lax`);
      return json(config());
    }
    if (url.pathname.startsWith('/qa/platform/') && req.method === 'GET') {
      if (req.headers['x-campus-session'] !== current().context) return json({ error: 'SESSION_CHANGED' }, 409);
      const apiPath = url.pathname.slice('/qa/platform/'.length);
      current().requests.push({ channel: 'customer', method: req.method, path: apiPath });
      return json(customerRead(apiPath));
    }
    const match = /^\/api\/nuni\/assistant\/(capability|pickup-plan|confirm|reconcile|cancel)$/.exec(url.pathname);
    if (match) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      const input = new NextRequest(url, { method: req.method, headers, ...(body ? { body } : {}) });
      const entry: Record<string, unknown> = { channel: 'assistant', action: match[1], method: req.method, body: body ? JSON.parse(body) : {} };
      current().requests.push(entry);
      const response = await handleV2(input, match[1]);
      const data = await response.json();
      entry.status = response.status; entry.response = data;
      if (match[1] === 'confirm' && response.ok && current().holdNextConfirmation) {
        current().holdNextConfirmation = false; current().held = true; entry.heldAfterWrite = true;
        // Deliberately lose this HTTP response after the real transaction and
        // read-back have finished. A browser reload must reconcile, never submit.
        return;
      }
      return json(data, response.status);
    }
    if (req.method !== 'GET') return json({ error: 'QA_ROUTE_NOT_FOUND' }, 404);
    const asset = url.pathname === '/' || url.pathname === '/food' || url.pathname === '/index.html'
      ? 'index.html' : url.pathname === '/fixture.js' ? 'fixture.js' : url.pathname === '/fixture.css' ? 'fixture.css'
        : /^\/[A-Za-z0-9_-]+\.png$/.test(url.pathname) ? url.pathname.slice(1) : null;
    if (!asset) return json({ error: 'QA_ROUTE_NOT_FOUND' }, 404);
    res.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css' : asset.endsWith('.js') ? 'text/javascript'
      : asset.endsWith('.png') ? 'image/png' : 'text/html',
      'Cache-Control': 'no-store' });
    res.end(await readFile(path.join(output, asset)));
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'QA_FAILED' }));
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  const origin = `http://127.0.0.1:${address.port}`;
  process.env.WEB_PUBLIC_ORIGIN = origin;
  console.log(JSON.stringify({ ready: true, origin }));
});
