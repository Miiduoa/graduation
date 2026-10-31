import { isSchoolLmsReadonlyEnabled } from './schoolLmsReadonly';
import { isHostedWebCallable, isLeaveWebCallable, isSchoolLoginWebCallable } from '@/lib/hostedCallables';
import { callableErrorBody, HttpsError } from './httpsError';
import { isLeaveWebApiServerEnabled } from './leaveWebApiEnabled';
import { isSchoolStudentIdLoginEnabled } from './schoolStudentIdLoginEnabled';
import type { CallableRequest } from './groupInviteHandlers';
import {
  assertJoinCodeAttemptsAllowed,
  assertTimetableShareCreatesAllowed,
  checkUidRateLimit,
  recordInvalidJoinCode,
  recordTimetableShareCreate,
} from './uidRateLimit';
import type { PuCampusGateway } from './puCampusClient';
import type { SchoolLoginFirestore } from './schoolLoginProfile';
import type { ServiceAccountSigner } from './firebaseCustomToken';
import type { AcademicFetchers, AcademicFirestore } from './academicRecordsHandlers';
import type { LmsCoursesFetcher } from './tronClassCoursesHandler';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { LoginRateLimitError, LoginRateStoreError, type LoginRateGate } from './loginRateLimit';
import { clientIpFromRequest, PuLoginHttpError } from './signInPuStudentId';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

const CORS_ALLOW_HEADERS =
  'Authorization, Content-Type, X-Firebase-AppCheck, X-Client-Version, X-Firebase-gmpid, X-Firebase-Encoding';

const MAX_BODY_BYTES = 64 * 1024;

export type FnRuntime = {
  db: import('./groupInviteHandlers').GroupFirestore;
  verifyIdToken: (
    token: string,
    checkRevoked?: boolean,
  ) => Promise<{ uid: string } & Record<string, unknown>>;
  createCustomToken?: (uid: string, claims: Record<string, string>) => Promise<string>;
  puCampus?: PuCampusGateway;
  academicFetchers?: AcademicFetchers;
  lmsCoursesFetcher?: LmsCoursesFetcher;
  lmsReadonlySource?: LmsReadonlySource;
  serviceAccount?: ServiceAccountSigner | null;
  rateLimitGate?: LoginRateGate;
  rateLimitSalt?: string;
  scheduleCampusSso?: (task: () => Promise<void>) => void;
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
  checkRevoked = false,
): Promise<{ uid: string; token: Record<string, unknown> } | null> {
  const parsed = parseAuthorization(authorizationHeader);
  if (parsed.kind === 'missing') return null;
  if (parsed.kind !== 'bearer' || !parsed.token) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
  try {
    const decoded = checkRevoked
      ? await verifyIdToken(parsed.token, true)
      : await verifyIdToken(parsed.token);
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
  academicFetchers?: AcademicFetchers,
  lmsCoursesFetcher?: LmsCoursesFetcher,
  lmsReadonlySource?: LmsReadonlySource,
): Promise<unknown> {
  if (name === 'getMyTronClassCourses') {
    const { createTronClassCoursesHandler } = await import('./tronClassCoursesHandler');
    const fetchCourses = lmsCoursesFetcher ?? (await import('./tronClassSchoolSource')).tronClassSchoolSource;
    return createTronClassCoursesHandler({ db: db as unknown as AcademicFirestore, fetchCourses })(request);
  }
  if (name === 'getMyTronClassLms') {
    const { createTronClassLmsHandler } = await import('./tronClassLmsHandler');
    const source = lmsReadonlySource ?? (await import('./tronClassLmsSource')).tronClassLmsReadonlySource;
    return createTronClassLmsHandler({ db: db as unknown as AcademicFirestore, source })(request);
  }
  if (name === 'getMyAcademicRecords') {
    const { createAcademicRecordsHandler } = await import('./academicRecordsHandlers');
    const fetchers = academicFetchers ?? (await import('./academicSchoolSource')).academicSchoolSource;
    return createAcademicRecordsHandler({ db: db as unknown as AcademicFirestore, fetchers })(request);
  }
  if (name === 'clearPuCampusSessions') {
    const { createClearPuCampusSessions } = await import('./academicRecordsHandlers');
    return createClearPuCampusSessions({ db: db as unknown as AcademicFirestore })(request);
  }
  if (name === 'joinGroupByCode' || name === 'leaveGroup') {
    const { createGroupInviteHandlers } = await import('./groupInviteHandlers');
    return createGroupInviteHandlers({ db })[name](request);
  }
  if (name === 'createTimetableShare' || name === 'revokeTimetableShare') {
    const { createTimetableShareHandlers } = await import('./timetableShareHandlers');
    return createTimetableShareHandlers({ db })[name](request);
  }
  if (name === 'startLiveSession' || name === 'endLiveSession' || name === 'joinLiveSession' || name === 'correctAttendanceRecord') {
    const { createLiveSessionHandlers } = await import('./attendanceSessionHandlers');
    return createLiveSessionHandlers({ db })[name](request);
  }
  if (
    name === 'submitLeaveRequest' ||
    name === 'withdrawLeaveRequest' ||
    name === 'reviewLeaveRequest' ||
    name === 'listLeaveReviewQueue'
  ) {
    const { createLeaveRequestHandlers } = await import('./leaveRequestHandlers');
    return createLeaveRequestHandlers({ db: db as never })[name](request);
  }
  throw new HttpsError('not-found', `Unknown function: ${name}`);
}

export async function dispatchFnRequest(
  name: string,
  request: Request,
  runtime?: FnRuntime | null,
): Promise<Response> {
  if (name === 'getMyTronClassLms' && !isSchoolLmsReadonlyEnabled()) {
    return callableResponse(new HttpsError('not-found', '玩課雲唯讀功能未啟用。'), request);
  }
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

  if (isLeaveWebCallable(name) && !isLeaveWebApiServerEnabled()) {
    return callableResponse(new HttpsError('unavailable', '尚未啟用'), request);
  }

  if (isSchoolLoginWebCallable(name) && !isSchoolStudentIdLoginEnabled()) {
    return jsonResponse(503, { error: '尚未啟用' }, cors);
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
    if (isSchoolLoginWebCallable(name)) {
      return jsonResponse(503, { error: '尚未啟用' }, cors);
    }
    return callableResponse(new HttpsError('unavailable', '尚未啟用'), request);
  }

  if (isSchoolLoginWebCallable(name)) {
    return dispatchSchoolLogin(request, resolved, cors);
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
      isLeaveWebCallable(name) || name === 'correctAttendanceRecord' ||
        name === 'getMyAcademicRecords' || name === 'getMyTronClassCourses' ||
        name === 'getMyTronClassLms' ||
        name === 'clearPuCampusSessions',
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
    const result = await invokeHostedCallable(name, callableRequest, resolved.db,
      resolved.academicFetchers, resolved.lmsCoursesFetcher, resolved.lmsReadonlySource);
    return jsonResponse(200, { result }, cors);
  } catch (error) {
    const mapped = mapThrownError(error);
    if (uid && name === 'joinGroupByCode' && mapped.code === 'not-found') {
      recordInvalidJoinCode(uid);
    }
    return callableResponse(mapped, request);
  }
}

async function dispatchSchoolLogin(
  request: Request,
  runtime: FnRuntime,
  cors: HeadersInit,
): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const { handleSignInPuStudentId } = await import('./signInPuStudentId');
    const { readServiceAccountSigner } = await import('./firebaseAdmin');
    const { scheduleAfterResponse } = await import('./scheduleAfterResponse');
    const result = await handleSignInPuStudentId(body, clientIpFromRequest(request), {
      db: runtime.db as unknown as SchoolLoginFirestore,
      campus: runtime.puCampus,
      signCustomToken: runtime.createCustomToken,
      serviceAccount: runtime.serviceAccount ?? readServiceAccountSigner(),
      rateLimitGate: runtime.rateLimitGate,
      rateLimitSalt: runtime.rateLimitSalt,
      scheduleCampusSso: runtime.scheduleCampusSso ?? scheduleAfterResponse,
      requestSignal: request.signal,
    });
    return jsonResponse(200, result, cors);
  } catch (error) {
    if (error instanceof LoginRateLimitError) {
      return jsonResponse(429, { error: error.message }, cors);
    }
    if (error instanceof LoginRateStoreError) {
      return jsonResponse(503, { error: error.message }, cors);
    }
    if (error instanceof PuLoginHttpError) {
      return jsonResponse(
        error.status,
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        cors,
      );
    }
    if (error instanceof HttpsError) {
      return jsonResponse(error.httpErrorCode.status, { error: error.message }, cors);
    }
    return jsonResponse(500, { error: 'PU student login failed' }, cors);
  }
}
