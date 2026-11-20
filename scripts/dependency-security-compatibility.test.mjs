import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// Resolve through Expo so these checks exercise the same dependencies as mobile builds.
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const { getAssetData, getAssetSize } = mobileRequire('@expo/metro/metro/Assets');
const signing = mobileRequire('@expo/code-signing-certificates');

test('Metro parses image buffers and scaled files after removing image-size', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'metro-security-assets-'));
  try {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"></svg>',
    );
    assert.deepEqual(getAssetSize('svg', svg, 'icon.svg'), { width: 48, height: 32 });
    const filename = path.join(directory, 'icon@2x.svg');
    await writeFile(filename, svg);
    const data = await getAssetData(filename, 'assets/icon@2x.svg', [], 'ios', '/assets');
    assert.equal(data.width, 24);
    assert.equal(data.height, 16);
    assert.deepEqual(data.scales, [2]);
    assert.deepEqual(data.files, [filename]);
    assert.throws(() => getAssetSize('png', Buffer.alloc(0), 'empty.png'), /empty file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Expo signing supports certificate and PEM round trips with upgraded node-forge', () => {
  // Ephemeral test material stays in memory and never uses an existing credential.
  const keys = signing.generateKeyPair();
  const roundTripKeys = signing.convertKeyPairPEMToKeyPair(signing.convertKeyPairToPEM(keys));
  const certificate = signing.generateSelfSignedCodeSigningCertificate({
    keyPair: roundTripKeys,
    validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000),
    commonName: 'dependency-compatibility-test',
  });
  const parsed = signing.convertCertificatePEMToCertificate(
    signing.convertCertificateToCertificatePEM(certificate),
  );
  signing.validateSelfSignedCertificate(parsed, roundTripKeys);
  const signature = signing.signBufferRSASHA256AndVerify(
    roundTripKeys.privateKey,
    parsed,
    Buffer.from('local compatibility check'),
  );
  assert.ok(Buffer.from(signature, 'base64').length > 0);
  const csr = signing.convertCSRPEMToCSR(
    signing.convertCSRToCSRPEM(signing.generateCSR(roundTripKeys, 'dependency-compatibility-test')),
  );
  assert.equal(csr.verify(), true);
});

test('MCP supports the patched Hono adapter over local JSON and SSE HTTP', { timeout: 10_000 }, async (t) => {
  const rootRequire = createRequire(import.meta.url);
  const firebaseRequire = createRequire(rootRequire.resolve('firebase-tools'));
  const transportPath = firebaseRequire.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const sdkRequire = createRequire(transportPath);
  const adapterPath = sdkRequire.resolve('@hono/node-server');
  const esmAdapter = await import(pathToFileURL(path.join(path.dirname(adapterPath), 'index.mjs')));
  assert.equal(typeof esmAdapter.getRequestListener, 'function');
  const { StreamableHTTPServerTransport } = sdkRequire(transportPath);

  for (const enableJsonResponse of [true, false]) {
    await t.test(enableJsonResponse ? 'JSON responses' : 'SSE responses', async () => {
      const nativeResponse = globalThis.Response;
      const received = [];
      const errors = [];
      const sends = [];
      let closed = false;
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse,
        sessionIdGenerator: () => 'local-compatibility-session',
      });
      transport.onclose = () => { closed = true; };
      transport.onerror = (error) => errors.push(error);
      transport.onmessage = (message, info) => {
        received.push({ message, authInfo: info.authInfo });
        if ('id' in message) {
          sends.push(transport.send({ jsonrpc: '2.0', id: message.id, result: { accepted: true } }));
        }
      };
      const server = createServer((req, res) => {
        req.auth = { token: 'synthetic-compatibility-token' };
        transport.handleRequest(req, res).catch((error) => {
          errors.push(error);
          res.writeHead(500).end();
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const url = `http://127.0.0.1:${server.address().port}/mcp`;
        const headers = {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        };
        const response = await globalThis.fetch(url, {
          method: 'POST',
          headers,
          signal: globalThis.AbortSignal.timeout(3_000),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'test', version: '1' },
            },
          }),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('mcp-session-id'), 'local-compatibility-session');
        assert.match(
          response.headers.get('content-type'),
          enableJsonResponse ? /application\/json/ : /text\/event-stream/,
        );
        const body = await response.text();
        const payload = enableJsonResponse
          ? body
          : body.split('\n').find((line) => line.startsWith('data: ')).slice(6);
        const message = JSON.parse(payload);
        assert.deepEqual(message, { jsonrpc: '2.0', id: 1, result: { accepted: true } });
        const notification = await globalThis.fetch(url, {
          method: 'POST',
          signal: globalThis.AbortSignal.timeout(3_000),
          headers: {
            ...headers,
            'mcp-session-id': 'local-compatibility-session',
            'mcp-protocol-version': '2025-03-26',
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });
        assert.equal(notification.status, 202);
        await notification.text();
        await Promise.all(sends);
        assert.equal(received.length, 2);
        assert.equal(received[0].authInfo.token, 'synthetic-compatibility-token');
        assert.deepEqual(errors, []);
        assert.equal(globalThis.Response, nativeResponse);
      } finally {
        await transport.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      assert.equal(closed, true);
    });
  }
});
