import {
  assertStoryMediaRead,
  authorizePrivateFile,
  isAllowedPrivateFileContentType,
  isCoverFilenameAllowed,
  parsePrivateFilePath,
  privateFileMaxBytes,
  PrivateFileAccessError,
  validPrivateFileSegment,
  type PrivateFileDb,
  type PrivateFileScope,
} from '@campus/shared/src/privateFileAccess';
import { boundedBytes } from './boundedBytes';
import { HttpsError } from './httpsError';
import type { FileStorage } from './fileStorage';
import {
  checkPrivateFileRequestRate,
  checkPrivateFileUploadRate,
} from './privateFileRateLimit';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

const CORS_ALLOW_HEADERS = 'Authorization, Content-Type';
const MAX_BODY_BYTES = 16 * 1024;

export type PrivateFileRuntime = {
  db: PrivateFileDb;
  verifyIdToken: (
    token: string,
    checkRevoked?: boolean,
  ) => Promise<{ uid: string } & Record<string, unknown>>;
  storage: FileStorage;
  now?: () => number;
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

async function verifyUser(
  authorizationHeader: string | null,
  verifyIdToken: PrivateFileRuntime['verifyIdToken'],
): Promise<string> {
  const parsed = parseAuthorization(authorizationHeader);
  if (parsed.kind === 'missing' || parsed.kind !== 'bearer' || !parsed.token) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
  try {
    const decoded = await verifyIdToken(parsed.token, true);
    if (!decoded?.uid || !validPrivateFileSegment(decoded.uid)) {
      throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
    }
    return decoded.uid;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unauthenticated', 'Invalid Firebase ID token');
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = String(request.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpsError('invalid-argument', 'Request has incorrect Content-Type.');
  }
  if (!request.body) throw new HttpsError('invalid-argument', 'Request body is missing data.');
  let raw: Buffer;
  try {
    raw = await boundedBytes(request, MAX_BODY_BYTES);
  } catch {
    throw new HttpsError('invalid-argument', 'Request body could not be read');
  }
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpsError('invalid-argument', 'Request body is not valid JSON');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('invalid-argument', 'Request body is not valid JSON');
  }
}

function mapError(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof PrivateFileAccessError) {
    return { status: error.statusCode, body: { error: error.message } };
  }
  if (error instanceof HttpsError) {
    return { status: error.httpErrorCode.status, body: { error: error.message } };
  }
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode);
  if ([400, 401, 403, 404, 405, 409, 413, 429].includes(statusCode)) {
    return {
      status: statusCode,
      body: { error: error instanceof Error ? error.message : 'File request failed' },
    };
  }
  return { status: 500, body: { error: 'File request failed' } };
}

function parseScope(path: unknown): PrivateFileScope {
  const scope = parsePrivateFilePath(path);
  if (!scope || (scope.kind === 'group-cover' && !isCoverFilenameAllowed(scope.filename))) {
    throw new HttpsError('invalid-argument', 'Invalid private file path');
  }
  if (scope.kind === 'assignment' && !scope.groupId) {
    throw new HttpsError('permission-denied', '不支援舊版作業附件路徑');
  }
  return scope;
}

async function issueUpload(
  runtime: PrivateFileRuntime,
  uid: string,
  scope: PrivateFileScope,
  body: Record<string, unknown>,
) {
  const contentType = String(body.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!isAllowedPrivateFileContentType(scope.kind, contentType)) {
    throw new HttpsError('invalid-argument', 'Unsupported file type or filename');
  }
  const maxBytes = privateFileMaxBytes(scope.kind, contentType);
  const byteSize = Number(body.byteSize);
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize >= maxBytes) {
    throw Object.assign(new Error('File is too large'), { statusCode: 413 });
  }
  checkPrivateFileUploadRate(uid);
  await authorizePrivateFile(runtime.db, scope, uid, true);

  let ifMatch: string | undefined;
  let ifNoneMatch: string | undefined;
  if (scope.kind === 'group-cover') {
    const existing = await runtime.storage.head(scope.path);
    if (existing?.etag) ifMatch = existing.etag;
    else ifNoneMatch = '*';
  } else {
    ifNoneMatch = '*';
  }

  const metadata = scope.kind === 'story' ? { 'owner-uid': uid } : undefined;
  return {
    maxBytes,
    signed: runtime.storage.presignPut({
      key: scope.path,
      contentType,
      contentLength: byteSize,
      ifMatch,
      ifNoneMatch,
      metadata,
      now: runtime.now ? new Date(runtime.now()) : undefined,
    }),
  };
}

async function issueDownload(
  runtime: PrivateFileRuntime,
  uid: string,
  scope: PrivateFileScope,
) {
  await authorizePrivateFile(runtime.db, scope, uid, false);
  const object = await runtime.storage.head(scope.path);
  if (!object) {
    throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }
  const maxBytes = privateFileMaxBytes(scope.kind, object.contentType);
  if (
    !Number.isSafeInteger(object.contentLength) ||
    object.contentLength < 0 ||
    object.contentLength >= maxBytes
  ) {
    throw Object.assign(new Error('File is too large'), { statusCode: 413 });
  }
  if (scope.kind === 'story') {
    const snap = await runtime.db.runTransaction(
      async (tx) => tx.get(runtime.db.collection('campusStories').doc(scope.storyId || '')),
      { readOnly: true },
    );
    assertStoryMediaRead({
      schoolId: scope.schoolId || '',
      uid,
      story: snap.exists ? snap.data() || null : null,
      object: {
        ownerUid: object.metadata['owner-uid'],
        contentType: object.contentType,
      },
      nowMs: runtime.now?.(),
    });
  }
  return {
    maxBytes,
    signed: runtime.storage.presignGet({
      key: scope.path,
      contentType: isAllowedPrivateFileContentType(scope.kind, object.contentType || '') ? object.contentType : 'application/octet-stream',
      attachment: scope.kind === 'assignment' || scope.kind === 'group-post' || !isAllowedPrivateFileContentType(scope.kind, object.contentType || ''),
      now: runtime.now ? new Date(runtime.now()) : undefined,
    }),
  };
}

export async function dispatchPrivateFileRequest(
  request: Request,
  runtime?: PrivateFileRuntime | null,
): Promise<Response> {
  const cors = corsHeaders(request);
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
    return jsonResponse(405, { error: 'Method not allowed' }, { ...cors, Allow: 'POST, OPTIONS' });
  }

  let resolved = runtime;
  if (resolved === undefined) {
    try {
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      const { getFileStorage } = await import('./fileStorage');
      const admin = await getFirebaseAdmin();
      const storage = getFileStorage();
      resolved =
        admin && storage
          ? {
              db: admin.db as unknown as PrivateFileDb,
              verifyIdToken: admin.verifyIdToken,
              storage,
            }
          : null;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    return jsonResponse(503, { error: '尚未啟用' }, cors);
  }

  try {
    const body = await readJsonBody(request);
    const uid = await verifyUser(request.headers.get('authorization'), resolved.verifyIdToken);
    checkPrivateFileRequestRate(uid);
    const scope = parseScope(body.path);
    const action = body.action === 'upload' || body.action === 'download' ? body.action : '';
    if (!action) throw new HttpsError('invalid-argument', 'Invalid private file path');
    const issued =
      action === 'upload'
        ? await issueUpload(resolved, uid, scope, body)
        : await issueDownload(resolved, uid, scope);
    return jsonResponse(
      200,
      {
        path: scope.path,
        url: issued.signed.url,
        method: issued.signed.method,
        headers: issued.signed.headers,
        expiresAt: issued.signed.expiresAt,
        maxBytes: issued.maxBytes,
      },
      cors,
    );
  } catch (error) {
    const mapped = mapError(error);
    return jsonResponse(mapped.status, mapped.body, cors);
  }
}
