import { NuniError } from '@campus/shared/src/nuni';

export type PlatformResponse = {
  status: number;
  ok: boolean;
  body: Record<string, unknown>;
};

export async function platformFetch(
  path: string,
  input?: Record<string, unknown>,
  method?: 'GET' | 'POST',
): Promise<PlatformResponse> {
  const verb = method ?? (input ? 'POST' : 'GET');
  const response = await fetch(path, {
    method: verb,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: input ? { 'Content-Type': 'application/json' } : undefined,
    body: input ? JSON.stringify(input) : undefined,
  });
  const body = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { status: response.status, ok: response.ok, body };
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
