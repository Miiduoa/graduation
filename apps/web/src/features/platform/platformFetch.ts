import { NuniError } from '@campus/shared/src/nuni';

export type PlatformResponse = {
  status: number;
  ok: boolean;
  body: Record<string, unknown>;
};

const NUNI_PATH = /^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/;
const ADMIN_PATH = /^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z][A-Za-z0-9]{0,31}=[^#]*)?$/;

async function send(
  url: string,
  method: 'GET' | 'POST',
  input: Record<string, unknown> | undefined,
  context?: string,
): Promise<PlatformResponse> {
  const sendJson = method !== 'GET';
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      ...(context ? { 'X-Campus-Session': context } : {}),
      ...(sendJson ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(sendJson ? { body: JSON.stringify(input ?? {}) } : {}),
  });
  const body = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { status: response.status, ok: response.ok, body };
}

export async function platformFetch(
  path: string,
  method: 'GET' | 'POST',
  input?: Record<string, unknown>,
  context?: string,
): Promise<PlatformResponse> {
  if (!NUNI_PATH.test(path)) return { status: 400, ok: false, body: { error: 'INVALID_REQUEST' } };
  return send(`/api/nuni/${path}`, method, input, context);
}

export async function adminFetch(
  path: string,
  method: 'GET' | 'POST',
  input?: Record<string, unknown>,
  context?: string,
): Promise<PlatformResponse> {
  if (!ADMIN_PATH.test(path)) return { status: 400, ok: false, body: { error: 'INVALID_REQUEST' } };
  return send(`/api/platform-admin/${path}`, method, input, context);
}

export function platformError(result: PlatformResponse, fallback: string): Error {
  const message =
    typeof result.body.error === 'string'
      ? result.body.error
      : typeof result.body.message === 'string'
        ? result.body.message
        : fallback;
  return new NuniError(result.status, message || fallback);
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}
