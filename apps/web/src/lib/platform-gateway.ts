import { NextRequest } from 'next/server';
import { NuniError, nuniRecord, parseNuniPrincipal } from '@campus/shared/src/nuni';
import {
  HANDLE,
  SESSION_COOKIE,
  apiOrigin,
  boundedJson,
  errorResponse,
  fetchJson,
  jsonResponse,
  nuniEnabled,
  platformRequest,
  readSession,
  requireSameOrigin,
  requireSession,
  revokeSession,
  sessionContext,
  setCookie,
} from './nuni/server';

const tenant = '[a-z0-9][a-z0-9-]{0,78}[a-z0-9]';
const identifier = '[A-Za-z0-9_-]{1,120}';
function adminUpstream(path: string, method: 'GET' | 'POST'): string {
  if (path === 'reports') return 'ops/social/reports';
  if (path === 'boards') return method === 'GET' ? 'social/boards' : 'ops/social/boards';
  if (path.startsWith('reports/')) return `ops/social/${path}`;
  if (
    path === 'school-applications' ||
    path.startsWith('school-applications/') ||
    path === 'class-workspace-affiliation-applications' ||
    path.startsWith('class-workspace-affiliation-applications/')
  )
    return path;
  return `ops/${path}`;
}
function query(request: NextRequest, fields: Record<string, number>) {
  const result: Record<string, string> = {};
  for (const [name, value] of request.nextUrl.searchParams) {
    if (!(name in fields) || name in result || value.length > fields[name])
      throw new NuniError(400, 'INVALID_QUERY');
    result[name] = value;
  }
  return result;
}
async function body(request: NextRequest) {
  try {
    return nuniRecord(await boundedJson(request, 48 * 1024));
  } catch (error) {
    if (error instanceof NuniError && error.code === 'BODY_TOO_LARGE') throw error;
    throw new NuniError(400, 'INVALID_INPUT');
  }
}
function onlyKeys(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new NuniError(400, 'INVALID_INPUT');
}
async function passwordLogin(request: NextRequest) {
  if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
  requireSameOrigin(request);
  if (readSession(request)) throw new NuniError(409, 'SIGN_OUT_REQUIRED');
  const input = await body(request);
  onlyKeys(input, ['email', 'password']);
  if (
    typeof input.email !== 'string' ||
    input.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ||
    typeof input.password !== 'string' ||
    input.password.length < 8 ||
    Buffer.byteLength(input.password, 'utf8') > 256
  )
    throw new NuniError(400, 'INVALID_INPUT');
  const value = nuniRecord(await platformRequest('password/sessions', undefined, input));
  const handle =
    typeof value.sessionHandle === 'string' && HANDLE.test(value.sessionHandle)
      ? value.sessionHandle
      : null;
  try {
    if (
      !handle ||
      !Number.isSafeInteger(value.expiresInSeconds) ||
      (value.expiresInSeconds as number) < 1 ||
      (value.expiresInSeconds as number) > 3600 ||
      value.isPlatformOperator !== true
    )
      throw new NuniError(502, 'INVALID_RESPONSE');
    const principal = parseNuniPrincipal({ ...value, authenticated: true });
    const session = {
      sessionHandle: handle,
      expiresAt: Date.now() + (value.expiresInSeconds as number) * 1000,
    };
    const response = jsonResponse({
      authenticated: true,
      ...principal,
      context: sessionContext(session),
    });
    setCookie(response, SESSION_COOKIE, session, session.expiresAt);
    return response;
  } catch (error) {
    if (handle) await revokeSession({ sessionHandle: handle, expiresAt: Date.now() + 3600_000 });
    throw error;
  }
}

export async function handlePlatformAdmin(request: NextRequest, segments: string[]) {
  try {
    if (!nuniEnabled()) throw new NuniError(503, 'SERVICE_UNAVAILABLE');
    const path = segments.join('/');
    if (path === 'login') {
      query(request, {});
      return await passwordLogin(request);
    }
    if (request.method !== 'GET' && request.method !== 'POST')
      throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.method === 'POST') requireSameOrigin(request);
    const session = requireSession(request);
    const principal = parseNuniPrincipal(await platformRequest('sessions/current', session));
    if (!principal.isPlatformOperator) throw new NuniError(403, 'OPERATOR_REQUIRED');
    if (request.method === 'GET') {
      const fields: Record<string, number> =
        path === 'schools'
          ? { q: 80 }
          : path === 'people'
            ? { tenantId: 80 }
            : path === 'reports'
              ? { state: 20, limit: 3 }
              : path === 'school-applications'
                ? { scope: 20 }
                : {};
      const valid =
        [
          'schools',
          'audit',
          'people',
          'merchants',
          'reports',
          'boards',
          'school-applications',
          'class-workspace-affiliation-applications',
        ].includes(path) || new RegExp(`^schools/${tenant}/proxy$`).test(path);
      if (!valid) throw new NuniError(404, 'NOT_FOUND');
      return jsonResponse(
        await platformRequest(
          adminUpstream(path, 'GET'),
          session,
          undefined,
          query(request, fields),
        ),
      );
    }
    query(request, {});
    const input = await body(request);
    let keys: string[];
    if (path === 'boards') keys = ['tenantId', 'name', 'description', 'idempotencyKey'];
    else if (new RegExp(`^schools/${tenant}/(?:open|suspend)$`).test(path))
      keys = ['reason', 'idempotencyKey'];
    else if (new RegExp(`^schools/${tenant}/profile$`).test(path))
      keys = ['displayName', 'description', 'idempotencyKey'];
    else if (new RegExp(`^schools/${tenant}/modules$`).test(path))
      keys = ['leave', 'identity', 'food', 'idempotencyKey'];
    else if (new RegExp(`^schools/${tenant}/proxy/(?:start|extend|end)$`).test(path)) keys = [];
    else if (new RegExp(`^reports/${identifier}/decision$`).test(path))
      keys = ['decision', 'reason', 'expectedVersion', 'idempotencyKey'];
    else if (new RegExp(`^school-applications/${identifier}/decision$`).test(path))
      keys = ['decision', 'reason', 'idempotencyKey'];
    else if (path === 'people/bind')
      keys = ['tenantId', 'role', 'email', 'personId', 'idempotencyKey'];
    else if (new RegExp(`^merchants/interest/${identifier}/decision$`).test(path))
      keys = ['decision', 'reason', 'idempotencyKey'];
    else if (new RegExp(`^merchants/applications/${tenant}/${identifier}/decision$`).test(path))
      keys = ['decision', 'reason', 'expectedVersion'];
    else if (
      new RegExp(`^class-workspace-affiliation-applications/${identifier}/decision$`).test(path)
    )
      keys = ['decision', 'reason', 'idempotencyKey'];
    else throw new NuniError(404, 'NOT_FOUND');
    onlyKeys(input, keys);
    if (path === 'people/bind') {
      const hasIdentity = ['email', 'personId'].some(
        (key) =>
          typeof input[key] === 'string' &&
          input[key].trim().length > 0 &&
          input[key].length <= 200,
      );
      if (
        typeof input.tenantId !== 'string' ||
        !new RegExp(`^${tenant}$`).test(input.tenantId) ||
        (input.role !== 'school_admin' && input.role !== 'school_staff') ||
        !hasIdentity ||
        typeof input.idempotencyKey !== 'string' ||
        input.idempotencyKey.length < 8 ||
        input.idempotencyKey.length > 100
      )
        throw new NuniError(400, 'INVALID_INPUT');
    }
    if (
      path.startsWith('merchants/applications/') &&
      (typeof input.expectedVersion !== 'number' ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1)
    ) {
      throw new NuniError(400, 'INVALID_INPUT');
    }
    return jsonResponse(await platformRequest(adminUpstream(path, 'POST'), session, input));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handlePlatformSocial(request: NextRequest, segments: string[]) {
  try {
    if (!nuniEnabled()) throw new NuniError(503, 'SERVICE_UNAVAILABLE');
    const path = segments.join('/');
    if (request.method !== 'GET' && request.method !== 'POST')
      throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.method === 'POST') requireSameOrigin(request);
    const session = requireSession(request);
    if (request.method === 'GET') {
      if (!['boards', 'feed', 'blocks', 'reports'].includes(path))
        throw new NuniError(404, 'NOT_FOUND');
      const fields: Record<string, number> =
        path === 'feed' ? { tenantId: 80, communityId: 120, cursor: 2048, limit: 3 } : {};
      return jsonResponse(
        await platformRequest(`social/${path}`, session, undefined, query(request, fields)),
      );
    }
    query(request, {});
    const input = await body(request);
    const allowed: Record<string, string[]> = {
      posts: ['tenantId', 'communityId', 'text', 'idempotencyKey'],
      blocks: ['tenantId', 'postId', 'idempotencyKey'],
      reports: ['tenantId', 'postId', 'reason', 'detail', 'idempotencyKey'],
    };
    const keys =
      allowed[path] ??
      (new RegExp(`^blocks/${identifier}/revoke$`).test(path)
        ? ['expectedVersion', 'idempotencyKey']
        : null);
    if (!keys) throw new NuniError(404, 'NOT_FOUND');
    onlyKeys(input, keys);
    return jsonResponse(await platformRequest(`social/${path}`, session, input));
  } catch (error) {
    return errorResponse(error);
  }
}

const SCHOOL_DIRECTORY_FRESH_MS = 60_000;
const SCHOOL_DIRECTORY_STALE_MS = 10 * 60_000;
type DirectorySchool = { id: string; name: string; status: unknown };
type DirectoryPayload = { schools: DirectorySchool[] };
let directoryCache: { schools: DirectorySchool[]; at: number } | null = null;
let directoryInflight: Promise<DirectoryPayload> | null = null;

export function resetSchoolDirectoryCache() {
  directoryCache = null;
  directoryInflight = null;
}

function isDirectoryUpstreamFailure(error: unknown) {
  return error instanceof NuniError && (error.status === 429 || error.status >= 500);
}

async function readSchoolDirectory(): Promise<DirectoryPayload> {
  const value = nuniRecord(
    await fetchJson(`${apiOrigin()}/v1/auth/schools/directory`, {
      headers: { Accept: 'application/json' },
    }),
  );
  if (!Array.isArray(value.schools) || value.schools.length > 500)
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    schools: value.schools.map((raw) => {
      const school = nuniRecord(raw);
      if (
        typeof school.tenantId !== 'string' ||
        !new RegExp(`^${tenant}$`).test(school.tenantId) ||
        typeof school.displayName !== 'string' ||
        !school.displayName.trim() ||
        school.displayName.length > 160 ||
        !['open', 'not-open'].includes(String(school.status))
      )
        throw new NuniError(502, 'INVALID_RESPONSE');
      return { id: school.tenantId, name: school.displayName, status: school.status };
    }),
  };
}

async function pullSchoolDirectory(): Promise<DirectoryPayload> {
  try {
    const payload = await readSchoolDirectory();
    directoryCache = { schools: payload.schools, at: Date.now() };
    return payload;
  } catch (error) {
    if (
      directoryCache &&
      Date.now() - directoryCache.at < SCHOOL_DIRECTORY_STALE_MS &&
      isDirectoryUpstreamFailure(error)
    ) {
      return { schools: directoryCache.schools };
    }
    throw error;
  }
}

async function loadSchoolDirectory(): Promise<DirectoryPayload> {
  const cached = directoryCache;
  if (cached && Date.now() - cached.at < SCHOOL_DIRECTORY_FRESH_MS) {
    return { schools: cached.schools };
  }
  if (!directoryInflight) {
    directoryInflight = pullSchoolDirectory().finally(() => {
      directoryInflight = null;
    });
  }
  return directoryInflight;
}

export async function schoolDirectory(request: NextRequest) {
  try {
    query(request, {});
    return jsonResponse(await loadSchoolDirectory());
  } catch (error) {
    return errorResponse(error);
  }
}
