#!/usr/bin/env node
/**
 * Isolated HTTPS mock for legacy account auth contract tests.
 * Routes by Host + method + path; fails closed on unrecognized calls.
 * Fixture values only — never points at production auth providers.
 */
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const certDir = resolve(process.env.SYNTHETIC_CERT_DIR || '.');
const fixturePath = process.env.SYNTHETIC_FIXTURE
  || resolve(new URL('../fixtures/synthetic-auth.json', import.meta.url).pathname);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const state = {
  calls: [],
  activeHandles: new Set(),
  accountRevoked: new Set(),
  handleSeq: 0,
};

function nextHandle() {
  state.handleSeq += 1;
  return state.handleSeq === 1 ? fixture.handle : fixture.handleAlt;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function record(host, method, path) {
  state.calls.push({ host, method, path, at: Date.now() });
}

async function handleApi(req, res, { allowAdmin }) {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `https://${host || 'campus-api.test'}`);
    const path = url.pathname;
    const bodyText = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : '';

    if (allowAdmin && path === '/__synthetic__/calls' && method === 'GET') {
      return json(res, 200, { calls: state.calls, activeHandles: [...state.activeHandles] });
    }

    if (allowAdmin && path === '/__synthetic__/reset' && method === 'POST') {
      state.calls = [];
      state.activeHandles.clear();
      state.accountRevoked.clear();
      state.handleSeq = 0;
      return json(res, 200, { ok: true });
    }

    if (host === 'campus-api.test' && method === 'POST' && path === '/v1/auth/account/login-transactions') {
      record(host, method, path);
      const body = JSON.parse(bodyText || '{}');
      if (
        body.tenantId !== fixture.tenantId
        || body.kind !== fixture.kind
        || body.clientKind !== 'web'
      ) {
        return json(res, 400, { error: { code: 'BAD_REQUEST' } });
      }
      return json(res, 201, {
        tenantId: fixture.tenantId,
        kind: fixture.kind,
        clientKind: 'web',
        issuer: fixture.issuer,
        clientId: fixture.clientId,
        nonce: fixture.nonce,
        expiresInSeconds: 600,
        scopes: ['openid', 'email', 'profile'],
      });
    }

    if (host === 'oauth2.googleapis.com' && method === 'POST' && path === '/token') {
      record(host, method, path);
      const params = new URLSearchParams(bodyText);
      if (
        params.get('grant_type') !== 'authorization_code'
        || params.get('client_id') !== fixture.clientId
        || params.get('code') !== fixture.code
        || params.get('code_verifier') !== fixture.codeVerifier
        || params.get('redirect_uri') !== fixture.redirectUri
      ) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      return json(res, 200, { id_token: fixture.idToken });
    }

    if (host === 'campus-api.test' && method === 'POST' && path === '/v1/auth/account/sessions') {
      record(host, method, path);
      const body = JSON.parse(bodyText || '{}');
      if (
        body.tenantId !== fixture.tenantId
        || body.kind !== fixture.kind
        || body.clientKind !== 'web'
        || body.nonce !== fixture.nonce
        || body.idToken !== fixture.idToken
      ) {
        return json(res, 400, { error: { code: 'BAD_REQUEST' } });
      }
      return json(res, 201, { token: fixture.campusToken, expiresInSeconds: 900 });
    }

    if (host === 'campus-api.test' && method === 'POST' && path === '/v1/auth/web/sessions') {
      record(host, method, path);
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${fixture.campusToken}`) {
        return json(res, 401, { error: { code: 'UNAUTHENTICATED' } });
      }
      const handle = nextHandle();
      state.activeHandles.add(handle);
      return json(res, 201, {
        sessionHandle: handle,
        family: 'campus-account',
        expiresInSeconds: 900,
      });
    }

    if (host === 'campus-api.test' && method === 'GET' && path === '/v1/auth/web/sessions/current') {
      record(host, method, path);
      const auth = req.headers.authorization || '';
      const handle = auth.startsWith('Session ') ? auth.slice('Session '.length) : '';
      if (!state.activeHandles.has(handle) || state.accountRevoked.has(handle)) {
        return json(res, 401, { error: { code: 'UNAUTHENTICATED' } });
      }
      return json(res, 200, {
        authenticated: true,
        family: 'campus-account',
        expiresInSeconds: 900,
      });
    }

    if (host === 'campus-api.test' && method === 'POST' && path === '/v1/auth/account/sessions/logout') {
      record(host, method, path);
      const auth = req.headers.authorization || '';
      const handle = auth.startsWith('Session ') ? auth.slice('Session '.length) : '';
      state.accountRevoked.add(handle);
      state.activeHandles.delete(handle);
      return json(res, 200, { revoked: true });
    }

    if (host === 'campus-api.test' && method === 'POST' && path === '/v1/auth/web/sessions/logout') {
      record(host, method, path);
      const auth = req.headers.authorization || '';
      const handle = auth.startsWith('Session ') ? auth.slice('Session '.length) : '';
      state.activeHandles.delete(handle);
      return json(res, 200, { revoked: true });
    }

    if (host === 'campus-api.test' && method === 'GET' && path === '/v1/auth/platform/providers') {
      record(host, method, path);
      return json(res, 200, { kinds: [] });
    }

    record(host, method, path);
    return json(res, 404, { error: { code: 'NOT_FOUND', host, method, path } });
}

const port = Number(process.env.SYNTHETIC_PORT || 443);
const adminPort = Number(process.env.SYNTHETIC_ADMIN_PORT || 9080);

const server = createHttpsServer(
  {
    key: readFileSync(resolve(certDir, 'server.key')),
    cert: readFileSync(resolve(certDir, 'server.pem')),
    ca: readFileSync(resolve(certDir, 'ca.pem')),
  },
  (req, res) => {
    handleApi(req, res, { allowAdmin: false }).catch(() => {
      json(res, 500, { error: { code: 'INTERNAL' } });
    });
  },
);

const admin = createHttpServer((req, res) => {
  handleApi(req, res, { allowAdmin: true }).catch(() => {
    json(res, 500, { error: { code: 'INTERNAL' } });
  });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`synthetic-upstream https on ${port}\n`);
});
admin.listen(adminPort, '0.0.0.0', () => {
  process.stdout.write(`synthetic-upstream admin http on ${adminPort}\n`);
});
