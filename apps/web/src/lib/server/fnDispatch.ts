import { isHostedWebCallable } from '@/lib/hostedCallables';
import { callableErrorBody, HttpsError } from './httpsError';
import type { CallableRequest } from './groupInviteHandlers';
import {
  assertJoinCodeAttemptsAllowed,
  assertTimetableShareCreatesAllowed,
  checkUidRateLimit,
  recordInvalidJoinCode,
  recordTimetableShareCreate,
} from './uidRateLimit';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

const CORS_ALLOW_HEADERS =
  'Authorization, Content-Type, X-Firebase-AppCheck, X-Client-Version, X-Firebase-gmpid, X-Firebase-Encoding';

const MAX_BODY_BYTES = 64 * 1024;

export type FnRuntime = {
  db: import('./groupInviteHandlers').GroupFirestore;
  verifyIdToken: (token: string) => Promise<{ uid: string } & Record<string, unknown>>;
};

function jsonResponse(status: number, body: unknown, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const allowed = origin === 'https://nuni.tw' || origin === 'https://www.nuni.tw';
  return allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function callableResponse(error: HttpsError, request: Request): Response {
  return jsonResponse(error.httpErrorCode.status, callableErrorBody(error), corsHeaders(request));
}

function parseAuthorization(headerValue: string | null): {
  kind: 'missing' | 'invalid' | 'bearer';
  token?: string;
} {
  const header = String(headerValue || '').trim();
  if (!header) return { kind: 'missing' };
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return { kind: 'invalid' };
  return { kind: 'bearer', token: match[1] };
}

async function verifyCallableAuth(
  authorizationHeader: string | null,
  verifyIdToken: FnRuntime['verifyIdToken'],
): Promise<{ uid: string; token: Record<string, unknown> } | null> {
  const parsed = parseAuthorization(authorizationHeader);
  if (parsed.kind === 'missing') return null;
  if (parsed.kind !== 'bearer' || !parsed.token) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
  try {
    const decoded = await verifyIdToken(parsed.token);
    if (!decoded?.uid) {
      throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
    }
    return { uid: decoded.uid, token: decoded };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = String(request.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpsError('invalid-argument', 'Request has incorrect Content-Type.');
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    throw new HttpsError('invalid-argument', 'Request body too large');
  }
  const text = Buffer.from(raw).toString('utf8').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpsError('invalid-argument', 'Request body is not valid JSON');
  }
}

function mapThrownError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  return new HttpsError('internal', 'INTERNAL');
}

async function invokeHostedCallable(
  name: string,
  request: CallableRequest,
  db: FnRuntime['db'],
): Promise<unknown> {
  if (name === 'joinGroupByCode' || name === 'leaveGroup') {
    const { createGroupInviteHandlers } = await import('./groupInviteHandlers');
    return createGroupInviteHandlers({ db })[name](request);
  }
  if (name === 'createTimetableShare' || name === 'revokeTimetableShare') {
    const { createTimetableShareHandlers } = await import('./timetableShareHandlers');
    return createTimetableShareHandlers({ db })[name](request);
  }
  if (name === 'startLiveSession' || name === 'endLiveSession' || name === 'joinLiveSession') {
    const { createLiveSessionHandlers } = await import('./attendanceSessionHandlers');
    return createLiveSessionHandlers({ db })[name](request);
  }
  throw new HttpsError('not-found', `Unknown function: ${name}`);
}

export async function dispatchFnRequest(
  name: string,
  request: Request,
  runtime?: FnRuntime | null,
): Promise<Response> {
  const cors = corsHeaders(request);

  if (!isHostedWebCallable(name)) {
    return callableResponse(new HttpsError('not-found', `Unknown function: ${name}`), request);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          request.headers.get('access-control-request-headers') || CORS_ALLOW_HEADERS,
        'Access-Control-Max-Age': '3600',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (request.method !== 'POST') {
    return callableResponse(
      new HttpsError('invalid-argument', 'Request has invalid method.'),
      request,
    );
  }

  let resolved = runtime;
  if (resolved === undefined) {
    try {
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      const admin = await getFirebaseAdmin();
      resolved = admin
        ? { db: admin.db as unknown as FnRuntime['db'], verifyIdToken: admin.verifyIdToken }
        : null;
    } catch {
      resolved = null;
    }
  }

  if (!resolved) {
    return callableResponse(new HttpsError('unavailable', '尚未啟用'), request);
  }

  let uid: string | undefined;
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) {
      throw new HttpsError('invalid-argument', 'Request body is missing data.');
    }
    const auth = await verifyCallableAuth(
      request.headers.get('authorization'),
      resolved.verifyIdToken,
    );
    uid = auth?.uid;
    if (uid) {
      checkUidRateLimit(uid);
      if (name === 'joinGroupByCode') {
        assertJoinCodeAttemptsAllowed(uid);
      }
      if (name === 'createTimetableShare') {
        assertTimetableShareCreatesAllowed(uid);
        recordTimetableShareCreate(uid);
      }
    }
    const callableRequest: CallableRequest = {
      data: (body as { data: unknown }).data,
      auth,
    };
    const result = await invokeHostedCallable(name, callableRequest, resolved.db);
    return jsonResponse(200, { result }, cors);
  } catch (error) {
    const mapped = mapThrownError(error);
    if (uid && name === 'joinGroupByCode' && mapped.code === 'not-found') {
      recordInvalidJoinCode(uid);
    }
    return callableResponse(mapped, request);
  }
}
