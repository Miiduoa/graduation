const http = require('node:http');
const { Readable } = require('node:stream');
const { onRequest } = require('firebase-functions/v2/https');
const { createPrivateGroupFileHandler } = require('./privateGroupFiles');
const { createRequestListener } = require('./httpAdapter');
const { classifyFunctions } = require('./functionRegistry');
const { transactionStore } = require('./testSupport/transactionStore');

const FILE_PATH = 'groups/course/posts/post/notes.pdf';
const REQUEST_PATH = `/privateGroupFile?path=${encodeURIComponent(FILE_PATH)}`;

async function startTransport({ verifyIdToken } = {}) {
  const store = transactionStore([
    ['users/alice', {}], ['groups/course', { schoolId: 'pu' }],
    ['groups/course/posts/post', { authorId: 'alice' }],
    ['groups/course/members/alice', { status: 'active', role: 'member' }],
    ['schools/pu/members/alice', { status: 'active' }],
  ]);
  const objects = new Map();
  const saves = [];
  const bucket = {
    file(path, options = {}) {
      return {
        async getMetadata() {
          const object = objects.get(path);
          if (!object) throw Object.assign(new Error('Missing object'), { code: 404 });
          return [{ size: String(object.bytes.length), generation: object.generation, contentType: 'application/pdf' }];
        },
        async save(bytes, saveOptions) {
          expect(saveOptions.preconditionOpts.ifGenerationMatch).toBe(0);
          expect(objects.has(path)).toBe(false);
          saves.push(path);
          objects.set(path, { bytes: Buffer.from(bytes), generation: String(saves.length) });
        },
        createReadStream() {
          const object = objects.get(path);
          expect(options.generation).toBe(object.generation);
          return Readable.from([object.bytes]);
        },
      };
    },
  };
  const handler = createPrivateGroupFileHandler({
    db: store.db, bucket, maxConcurrentUploads: 1, uploadTimeoutMs: 1000,
    verifyIdToken: async (token, checkRevoked) => {
      expect(checkRevoked).toBe(true);
      if (verifyIdToken) await verifyIdToken(token);
      if (token !== 'alice') throw new Error('Invalid token');
      return { uid: 'alice', role: 'admin', schoolId: 'untrusted-claim' };
    },
  });
  const wrapped = onRequest({ cors: ['https://nuni.tw'], timeoutSeconds: 120 }, handler);
  const classified = classifyFunctions({ privateGroupFile: wrapped });
  expect(classified.httpFunctions.privateGroupFile).toBe(wrapped);
  const listener = createRequestListener({ httpFunctions: classified.httpFunctions });
  const requests = [];
  const received = Promise.withResolvers();
  const server = http.createServer((req, res) => {
    const bodyStarted = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const record = { events: [], bodyStarted: bodyStarted.promise, closed: closed.promise };
    // Observe emitted events without adding an error listener that changes Node's behavior.
    const emit = req.emit;
    req.emit = function observedEmit(event, ...args) {
      if (event === 'data') bodyStarted.resolve();
      if (['aborted', 'end', 'error', 'close'].includes(event)) {
        record.events.push(event === 'error' ? `error:${args[0]?.code}` : event);
      }
      if (event === 'close') closed.resolve();
      return emit.call(this, event, ...args);
    };
    requests.push(record);
    received.resolve(record);
    record.done = listener(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function request(method, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, method, path: REQUEST_PATH,
        headers: {
          Authorization: 'Bearer alice', Origin: 'https://nuni.tw', 'Content-Type': 'application/pdf',
          ...(body ? { 'Content-Length': body.length } : {}), ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(new Error('Transport response timed out')));
      req.end(body);
    });
  }

  function openUpload(headers = {}) {
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'POST', path: REQUEST_PATH,
      headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/pdf', 'Content-Length': 1024, ...headers },
    });
    req.on('error', () => {});
    req.on('response', (res) => res.resume());
    req.setTimeout(2000, () => req.destroy(new Error('Upload socket timed out')));
    return req;
  }

  return {
    store, saves, requests, request, openUpload, received: received.promise,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await Promise.all(requests.map(({ done }) => done));
    },
  };
}

test('real Firebase wrapper authenticates before binary input and preserves generation-pinned private reads', async () => {
  const transport = await startTransport();
  try {
    const unauthorized = transport.openUpload({ Authorization: '' });
    const response = new Promise((resolve, reject) => {
      unauthorized.once('response', resolve);
      unauthorized.once('error', reject);
    });
    unauthorized.flushHeaders();
    expect((await response).statusCode).toBe(401);
    unauthorized.destroy();
    expect(transport.saves).toHaveLength(0);

    const bytes = Buffer.alloc(11 * 1024 * 1024, 65);
    const uploaded = await transport.request('POST', bytes);
    expect(uploaded.status).toBe(201);
    expect(uploaded.headers['access-control-allow-origin']).toBe('https://nuni.tw');
    const downloaded = await transport.request('GET');
    expect(downloaded.status).toBe(200);
    expect(downloaded.bytes.equals(bytes)).toBe(true);
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(transport.requests[1].events).toEqual(['end', 'close']);

    transport.store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    expect((await transport.request('GET')).status).toBe(403);
  } finally {
    await transport.close();
  }
});

test('disconnect during authentication releases the upload slot before its deadline', async () => {
  const authStarted = Promise.withResolvers();
  const continueAuth = Promise.withResolvers();
  let first = true;
  const transport = await startTransport({
    verifyIdToken: async () => {
      if (first) {
        first = false;
        authStarted.resolve();
        await continueAuth.promise;
      }
    },
  });
  try {
    const abandoned = transport.openUpload();
    abandoned.flushHeaders();
    await authStarted.promise;
    abandoned.destroy();
    await transport.requests[0].closed;
    continueAuth.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect((await transport.request('POST', Buffer.from('complete'))).status).toBe(201);
    expect(transport.saves).toHaveLength(1);
    expect(transport.requests[0].events).toEqual(['aborted', 'close']);
  } finally {
    continueAuth.resolve();
    await transport.close();
  }
});

test.each(['destroy', 'end'])('active upload interrupted by socket %s releases capacity immediately', async (method) => {
  const transport = await startTransport();
  try {
    const abandoned = transport.openUpload();
    abandoned.write('partial');
    const active = await transport.received;
    await active.bodyStarted;
    abandoned.socket[method]();
    await active.closed;
    expect((await transport.request('POST', Buffer.from('complete'))).status).toBe(201);
    expect(transport.saves).toHaveLength(1);
    expect(active.events).toEqual(['aborted', 'error:ECONNRESET', 'close']);
  } finally {
    await transport.close();
  }
});
