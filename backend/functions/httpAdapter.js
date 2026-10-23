'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { isProductionRuntime } = require('./securityUtils');

const DEFAULT_ALLOWED_ORIGINS = ['https://nuni.tw', 'https://www.nuni.tw'];
const LOCAL_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const CORS_ALLOW_HEADERS =
  'Authorization, Content-Type, X-Firebase-AppCheck, X-Client-Version, X-Firebase-gmpid, X-Firebase-Encoding';

const FUNCTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function originMatches(origin, matcher) {
  if (!origin) return false;
  if (matcher instanceof RegExp) return matcher.test(origin);
  return origin === matcher;
}

function resolveAllowedOrigins(allowedOrigins) {
  if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    return allowedOrigins;
  }
  const fromEnv = String(process.env.ALLOWED_WEB_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  if (isProductionRuntime()) return DEFAULT_ALLOWED_ORIGINS;
  return [...DEFAULT_ALLOWED_ORIGINS, ...LOCAL_DEV_ORIGINS];
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  return resolveAllowedOrigins(allowedOrigins).some((matcher) => originMatches(origin, matcher));
}

function applyCorsHeaders(req, res, allowedOrigins) {
  const origin = String(req.headers.origin || '');
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    String(req.headers['access-control-request-headers'] || CORS_ALLOW_HEADERS),
  );
  res.setHeader('Access-Control-Max-Age', '3600');
}

function sendJson(res, statusCode, body) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function callableErrorBody(code, message, details) {
  const error = new HttpsError(code, message, details);
  return { error: error.toJSON() };
}

function sendCallableError(res, code, message, details) {
  const error = new HttpsError(code, message, details);
  sendJson(res, error.httpErrorCode.status, { error: error.toJSON() });
}

function mapThrownError(error) {
  if (error instanceof HttpsError) {
    return {
      statusCode: error.httpErrorCode.status,
      body: { error: error.toJSON() },
    };
  }
  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode === 401) {
    return {
      statusCode: 401,
      body: callableErrorBody('unauthenticated', error.message || 'Unauthenticated'),
    };
  }
  if (statusCode === 403) {
    return {
      statusCode: 403,
      body: callableErrorBody('permission-denied', error.message || 'Permission denied'),
    };
  }
  if (statusCode === 404) {
    return {
      statusCode: 404,
      body: callableErrorBody('not-found', error.message || 'Not found'),
    };
  }
  return {
    statusCode: 500,
    body: callableErrorBody('internal', 'INTERNAL'),
  };
}

function getHeader(req, name) {
  return req.headers[String(name).toLowerCase()];
}

function parseAuthorization(headerValue) {
  const header = String(headerValue || '').trim();
  if (!header) return { kind: 'missing' };
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return { kind: 'invalid' };
  return { kind: 'bearer', token: match[1] };
}

async function verifyCallableAuth(authorizationHeader, verifyIdToken) {
  const parsed = parseAuthorization(authorizationHeader);
  if (parsed.kind === 'missing') {
    return { auth: null };
  }
  if (parsed.kind === 'invalid' || !verifyIdToken) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
  try {
    const decoded = await verifyIdToken(parsed.token);
    if (!decoded?.uid) {
      throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
    }
    return {
      auth: {
        uid: decoded.uid,
        token: decoded,
      },
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
}

async function readRawBody(req, limitBytes = 10 * 1024 * 1024) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limitBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(rawBody) {
  const text = rawBody.toString('utf8').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpsError('invalid-argument', 'Request body is not valid JSON');
  }
}

function parseQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }
  return query;
}

function decorateNodeRequest(req, { body, rawBody, url }) {
  req.body = body;
  req.rawBody = rawBody;
  req.query = parseQuery(url);
  if (typeof req.get !== 'function') {
    req.get = (name) => {
      const value = getHeader(req, name);
      return Array.isArray(value) ? value.join(', ') : value;
    };
  }
  if (typeof req.header !== 'function') {
    req.header = req.get.bind(req);
  }
  if (!req.ip) {
    const forwarded = getHeader(req, 'x-forwarded-for');
    req.ip =
      (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
      req.socket?.remoteAddress ||
      'unknown';
  }
  return req;
}

function decorateNodeResponse(res) {
  if (typeof res.status !== 'function') {
    res.status = function status(code) {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.set !== 'function') {
    res.set = function set(field, value) {
      if (field && typeof field === 'object') {
        for (const [name, headerValue] of Object.entries(field)) {
          res.setHeader(name, headerValue);
        }
      } else if (field) {
        res.setHeader(field, value);
      }
      return res;
    };
  }
  if (typeof res.json !== 'function') {
    res.json = function json(payload) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return res;
    };
  }
  if (typeof res.send !== 'function') {
    res.send = function send(payload) {
      if (payload == null) {
        res.end();
        return res;
      }
      if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
        return res.json(payload);
      }
      res.end(payload);
      return res;
    };
  }
  return res;
}

function functionNameFromUrl(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 3) return parts[2];
  return parts[0] || '';
}

async function dispatchCallable({
  handler,
  body,
  authorizationHeader,
  verifyIdToken,
  rawRequest,
  enforceAppCheck = false,
}) {
  if (enforceAppCheck) {
    throw new HttpsError(
      'failed-precondition',
      'App Check is not enforced on campus-one-tw callables; do not set ENFORCE_APP_CHECK.',
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.data === 'undefined') {
    throw new HttpsError('invalid-argument', 'Request body is missing data.');
  }
  const { auth } = await verifyCallableAuth(authorizationHeader, verifyIdToken);
  const request = {
    data: body.data,
    auth,
    rawRequest,
    app: undefined,
    instanceIdToken: undefined,
    acceptsStreaming: false,
  };
  const context = { auth };
  return handler(request, context);
}

function createRequestListener({
  callables = {},
  httpFunctions = {},
  schedules = {},
  verifyIdToken,
  allowedOrigins,
  cronSecret,
  enforceAppCheck = false,
} = {}) {
  const origins = resolveAllowedOrigins(allowedOrigins);
  const cron = String(cronSecret || process.env.CRON_SECRET || '').trim();

  return async function requestListener(req, res) {
    const host = req.headers.host || '127.0.0.1';
    const url = new URL(req.url || '/', `http://${host}`);
    decorateNodeResponse(res);

    if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/healthz/')) {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/internal/cron' || url.pathname.startsWith('/internal/cron/')) {
      applyCorsHeaders(req, res, origins);
      if (!cron) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const provided =
        parseAuthorization(getHeader(req, 'authorization')).token ||
        String(getHeader(req, 'x-cron-secret') || '').trim();
      if (!provided || provided !== cron) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      const name = url.pathname.slice('/internal/cron/'.length).replace(/\/+$/, '');
      const job = schedules[name];
      if (!job || typeof job.handler !== 'function') {
        sendJson(res, 404, { error: 'Unknown schedule' });
        return;
      }
      try {
        await job.handler({
          jobName: name,
          scheduleTime: new Date().toISOString(),
        });
        sendJson(res, 200, { ok: true, name });
      } catch (error) {
        console.error(`[cron] ${name} failed`, error);
        sendJson(res, 500, { error: 'Schedule failed' });
      }
      return;
    }

    const functionName = functionNameFromUrl(url);
    const isCallable = Boolean(callables[functionName]);
    const isHttp = Boolean(httpFunctions[functionName]);

    if (isCallable) {
      applyCorsHeaders(req, res, origins);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        sendCallableError(res, 'invalid-argument', 'Request has invalid method.');
        return;
      }
      try {
        const rawBody = await readRawBody(req);
        decorateNodeRequest(req, { rawBody, body: undefined, url });
        const contentType = String(getHeader(req, 'content-type') || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          sendCallableError(res, 'invalid-argument', 'Request has incorrect Content-Type.');
          return;
        }
        const body = parseJsonBody(rawBody);
        const result = await dispatchCallable({
          handler: callables[functionName],
          body,
          authorizationHeader: getHeader(req, 'authorization'),
          verifyIdToken,
          rawRequest: req,
          enforceAppCheck,
        });
        sendJson(res, 200, { result });
      } catch (error) {
        const mapped = mapThrownError(error);
        if (mapped.statusCode >= 500) {
          console.error(`[callable] ${functionName} failed`, error);
        }
        sendJson(res, mapped.statusCode, mapped.body);
      }
      return;
    }

    if (isHttp) {
      applyCorsHeaders(req, res, origins);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      try {
        const rawBody = await readRawBody(req);
        let body = {};
        if (rawBody.length) {
          try {
            body = parseJsonBody(rawBody);
          } catch {
            body = {};
          }
        }
        decorateNodeRequest(req, { rawBody, body, url });
        await httpFunctions[functionName](req, res);
      } catch (error) {
        if (error instanceof HttpsError) {
          sendJson(res, error.httpErrorCode.status, { error: error.message });
          return;
        }
        const statusCode = Number(error?.statusCode) || 500;
        if (!res.headersSent) {
          sendJson(res, statusCode, { error: error?.message || 'Request failed' });
        }
      }
      return;
    }

    applyCorsHeaders(req, res, origins);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (functionName && FUNCTION_NAME_RE.test(functionName)) {
      sendCallableError(res, 'not-found', `Unknown function: ${functionName}`);
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  LOCAL_DEV_ORIGINS,
  applyCorsHeaders,
  createRequestListener,
  dispatchCallable,
  isAllowedOrigin,
  mapThrownError,
  resolveAllowedOrigins,
  sendCallableError,
  verifyCallableAuth,
};
