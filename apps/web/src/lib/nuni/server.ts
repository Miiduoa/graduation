import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { NuniError, nuniRecord } from '@campus/shared/src/nuni';

export const SESSION_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-campus-platform-session'
    : 'campus-platform-session';
export const LOGIN_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-campus-one-login' : 'campus-one-login';
export const HANDLE = /^ps_[A-Za-z0-9_-]{43}$/;
export type PlatformSession = { sessionHandle: string; expiresAt: number; pendingLogout?: true };

export function nuniEnabled() {
  // The legacy flag remains an API compatibility gate; it never selects the application shell.
  return process.env.NUNI_CLASSROOM_ENABLED === 'true' || process.env.CAMPUS_BACKEND === 'nuni';
}

export function publicOrigin(): string {
  const value = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (!value) throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  }
  const local =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  }
  return url.origin;
}

export function requireSameOrigin(request: NextRequest): void {
  if (
    request.headers.get('origin') !== publicOrigin() ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new NuniError(403, 'ORIGIN_REJECTED');
  }
}

function key(): Buffer {
  const secret = process.env.BFF_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  return createHash('sha256').update(secret).digest();
}

export function sealCookie(name: string, value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(name));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, ...value }), 'utf8'),
    cipher.final(),
  ]);
  const result = `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  if (result.length > 3800) throw new NuniError(503, 'COOKIE_TOO_LARGE');
  return result;
}

export function openCookie(name: string, value?: string): Record<string, unknown> | null {
  if (!value || value.length > 3800) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const bytes = parts.map((part) => Buffer.from(part, 'base64url'));
    if (
      bytes[0].length !== 12 ||
      bytes[2].length !== 16 ||
      bytes.some((part, index) => part.toString('base64url') !== parts[index])
    )
      return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes[0]);
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes[2]);
    const result = nuniRecord(
      JSON.parse(Buffer.concat([decipher.update(bytes[1]), decipher.final()]).toString('utf8')),
    );
    return result.v === 1 ? result : null;
  } catch (error) {
    if (error instanceof NuniError && error.code === 'CONFIGURATION_REQUIRED') throw error;
    return null;
  }
}

export function setCookie(
  response: NextResponse,
  name: string,
  value: object | null,
  expiresAt = 0,
): void {
  response.cookies.set(name, value ? sealCookie(name, value) : '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: value ? Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) : 0,
  });
}

export function readSession(request: NextRequest): PlatformSession | null {
  const value = openCookie(SESSION_COOKIE, request.cookies.get(SESSION_COOKIE)?.value);
  if (
    !value ||
    typeof value.sessionHandle !== 'string' ||
    !HANDLE.test(value.sessionHandle) ||
    typeof value.expiresAt !== 'number' ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 31 * 86400_000 ||
    (value.pendingLogout !== undefined && value.pendingLogout !== true)
  )
    return null;
  return {
    sessionHandle: value.sessionHandle,
    expiresAt: value.expiresAt,
    ...(value.pendingLogout === true ? { pendingLogout: true } : {}),
  };
}

export function sessionContext(session: PlatformSession): string {
  return createHmac('sha256', key())
    .update(`campus-one-view:${session.sessionHandle}`)
    .digest('base64url');
}

export function equalSecret(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || left.length !== right.length) return false;
  const bytes = Buffer.from(left);
  const expected = Buffer.from(right);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

export function requireSession(request: NextRequest): PlatformSession {
  const session = readSession(request);
  if (!session || session.pendingLogout) throw new NuniError(401, 'SIGN_IN_REQUIRED');
  if (!equalSecret(request.headers.get('x-campus-session'), sessionContext(session)))
    throw new NuniError(409, 'SESSION_CHANGED');
  return session;
}

export async function boundedJson(
  source: Request | Response,
  limit = 1024 * 1024,
): Promise<unknown> {
  if (!source.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new NuniError(502, 'INVALID_RESPONSE');
  const declared = source.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new NuniError(413, 'BODY_TOO_LARGE');
  if (!source.body) throw new NuniError(502, 'INVALID_RESPONSE');
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NuniError(503, 'READ_TIMEOUT')), 8000);
  });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new NuniError(413, 'BODY_TOO_LARGE');
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof NuniError) throw error;
    throw new NuniError(502, 'INVALID_RESPONSE');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function apiOrigin(): string {
  const url = new URL(process.env.NUNI_API_BASE_URL || 'https://api.nuni.tw');
  const local =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new NuniError(503, 'CONFIGURATION_REQUIRED');
  }
  return url.origin;
}

export async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new NuniError(response.status >= 500 ? 503 : response.status, 'REQUEST_FAILED');
    }
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof NuniError) throw error;
    throw new NuniError(503, 'SERVICE_UNAVAILABLE');
  }
}

export function platformRequest(
  path: string,
  session?: PlatformSession,
  input?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  if (!/^[a-zA-Z0-9/_-]+$/.test(path)) throw new NuniError(400, 'INVALID_PATH');
  const search = new URLSearchParams(query);
  return fetchJson(`${apiOrigin()}/v1/auth/platform/${path}${search.size ? `?${search}` : ''}`, {
    method: input ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      ...(session ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
      ...(input ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}

export async function revokeSession(session: PlatformSession): Promise<void> {
  try {
    const result = nuniRecord(await platformRequest('logout', session, {}));
    if (result.signedOut !== true) throw new NuniError(502, 'INVALID_RESPONSE');
  } catch (error) {
    if (!(error instanceof NuniError && error.status === 401)) throw error;
  }
}

export function jsonResponse(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie, X-Campus-Session',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function errorResponse(error: unknown): NextResponse {
  return jsonResponse(
    { error: error instanceof NuniError ? error.code : 'SERVICE_UNAVAILABLE' },
    error instanceof NuniError ? error.status : 503,
  );
}
