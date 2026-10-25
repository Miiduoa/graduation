'use strict';

const http = require('node:http');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  applyCorsHeaders,
  createRequestListener,
  isAllowedOrigin,
  mapThrownError,
  resolveAllowedOrigins,
} = require('./httpAdapter');

function listen(listener) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(listener);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
    server.once('error', reject);
  });
}

function request(port, { method, path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('callable HTTP adapter', () => {
  let server;
  let port;
  let lastRequest;

  beforeAll(async () => {
    const listener = createRequestListener({
      callables: {
        joinLiveSession: async (request, context) => {
          lastRequest = { request, context };
          if (!request.auth?.uid) {
            throw new HttpsError('unauthenticated', 'Must be logged in');
          }
          return { ok: true, uid: request.auth.uid };
        },
        forbiddenOp: async () => {
          throw new HttpsError('permission-denied', 'nope', { reason: 'role' });
        },
      },
      verifyIdToken: async (token) => {
        if (token === 'valid-token') {
          return { uid: 'student-1', email: 'a@test.local' };
        }
        throw new Error('bad token');
      },
      allowedOrigins: ['https://nuni.tw'],
    });
    ({ server, port } = await listen(listener));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    lastRequest = null;
  });

  test('auth required: missing bearer token is unauthenticated', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/joinLiveSession',
      body: { data: { sessionId: 's1' } },
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { status: 'UNAUTHENTICATED', message: 'Must be logged in' },
    });
  });

  test('auth required: invalid bearer token is unauthenticated before the handler', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/joinLiveSession',
      body: { data: {} },
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.status).toBe('UNAUTHENTICATED');
    expect(lastRequest).toBeNull();
  });

  test('valid token populates request.auth and context.auth', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/joinLiveSession',
      body: { data: { sessionId: 's1' } },
      headers: { Authorization: 'Bearer valid-token', Origin: 'https://nuni.tw' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { ok: true, uid: 'student-1' } });
    expect(lastRequest.request.auth).toMatchObject({ uid: 'student-1' });
    expect(lastRequest.context.auth.uid).toBe('student-1');
    expect(res.headers['access-control-allow-origin']).toBe('https://nuni.tw');
  });

  test('maps HttpsError to callable error envelope', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/forbiddenOp',
      body: { data: {} },
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        status: 'PERMISSION_DENIED',
        message: 'nope',
        details: { reason: 'role' },
      },
    });
  });

  test('unknown function returns 404 callable error', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/notARealFunction',
      body: { data: {} },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.status).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/notARealFunction/);
  });

  test('healthz does not require auth', async () => {
    const res = await request(port, { method: 'GET', path: '/healthz' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('requests without Origin do not get a wildcard CORS allow', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/joinLiveSession',
      body: { data: {} },
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('disallowed Origin is not reflected', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/joinLiveSession',
      body: { data: {} },
      headers: { Authorization: 'Bearer valid-token', Origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('httpAdapter CORS allowlist', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('missing Origin is not treated as allowed', () => {
    expect(isAllowedOrigin('', ['https://nuni.tw'])).toBe(false);
    expect(isAllowedOrigin(undefined, ['https://nuni.tw'])).toBe(false);
  });

  test('production defaults exclude localhost and allow nuni.tw', () => {
    process.env.APP_ENV = 'production';
    delete process.env.ALLOWED_WEB_ORIGINS;
    expect(resolveAllowedOrigins()).toEqual(['https://nuni.tw', 'https://www.nuni.tw']);
    expect(isAllowedOrigin('https://nuni.tw')).toBe(true);
    expect(isAllowedOrigin('https://www.nuni.tw')).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
  });

  test('non-production defaults include localhost', () => {
    process.env.APP_ENV = 'development';
    delete process.env.ALLOWED_WEB_ORIGINS;
    expect(resolveAllowedOrigins()).toEqual(
      expect.arrayContaining(['https://nuni.tw', 'http://localhost:3000', 'http://127.0.0.1:3000']),
    );
  });

  test('applyCorsHeaders never writes a wildcard', () => {
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; } };
    applyCorsHeaders({ headers: {} }, res, ['https://nuni.tw']);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    applyCorsHeaders({ headers: { origin: 'https://nuni.tw' } }, res, ['https://nuni.tw']);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://nuni.tw');
  });
});

describe('mapThrownError', () => {
  test('maps 413 and 429 to resource-exhausted instead of 500', () => {
    const tooLarge = new Error('Request body too large');
    tooLarge.statusCode = 413;
    expect(mapThrownError(tooLarge)).toMatchObject({
      statusCode: 413,
      body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Request body too large' } },
    });

    const limited = new Error('Too many requests');
    limited.statusCode = 429;
    expect(mapThrownError(limited)).toMatchObject({
      statusCode: 429,
      body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Too many requests' } },
    });
  });
});

