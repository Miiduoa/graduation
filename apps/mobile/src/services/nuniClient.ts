import { NuniError, nuniRecord, parseNuniPrincipal } from '@campus/shared/src/nuni';
import { WAKE_REQUEST_TIMEOUT_MS, withWakeRetry } from '@campus/shared/src/wakeAwareRequest';

import { PERSONAL_IMPORT_SYNC_BODY_LIMIT } from '@campus/shared/src/imports/sync';

const API = 'https://api.nuni.tw/v1/auth/platform/';
const PUBLIC_API = 'https://api.nuni.tw/v1/public/';
export const NUNI_HANDLE = /^ps_[A-Za-z0-9_-]{43}$/;
const PUBLIC_CAFETERIA_PATH =
  /^schools\/[a-z0-9][a-z0-9-]{0,78}[a-z0-9]\/cafeterias(?:\/[A-Za-z0-9_-]{1,100})?$/;
export type NuniTransport = (
  path: string,
  handle?: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
  method?: 'PUT',
  query?: Record<string, string>,
) => Promise<unknown>;

/** Credentials are sent only to the platform API, never to a supplied URL. */
export const nuniPlatformRequest: NuniTransport = async (
  path,
  handle,
  input,
  signal,
  method,
  query,
) => {
  if (!/^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) || (handle && !NUNI_HANDLE.test(handle)))
    throw new NuniError(400, 'INVALID_REQUEST');
  if (
    query &&
    (input ||
      method ||
      Object.keys(query).length > 10 ||
      Object.entries(query).some(
        ([key, value]) =>
          !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key) ||
          typeof value !== 'string' ||
          value.length > 500,
      ))
  )
    throw new NuniError(400, 'INVALID_REQUEST');
  if (signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  const search = new URLSearchParams(query).toString();
  return withWakeRetry(
    async (attemptSignal) => {
      try {
        const response = await fetch(`${API}${path}${search ? `?${search}` : ''}`, {
          method: method ?? (input ? 'POST' : 'GET'),
          redirect: 'error',
          cache: 'no-store',
          signal: attemptSignal,
          headers: {
            Accept: 'application/json',
            ...(handle ? { Authorization: `Platform ${handle}` } : {}),
            ...(input ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(input ? { body: JSON.stringify(input) } : {}),
        });
        const body = await response.text();
        const limit =
          path === 'personal-imports/read' || path === 'personal-imports/write'
            ? PERSONAL_IMPORT_SYNC_BODY_LIMIT
            : 2_000_000;
        if (body.length > limit) throw new NuniError(502, 'INVALID_RESPONSE');
        let value: unknown;
        try {
          value = JSON.parse(body);
        } catch {
          throw new NuniError(response.ok ? 502 : response.status, 'INVALID_RESPONSE');
        }
        if (!response.ok) {
          const record = nuniRecord(value);
          const failure = typeof record.error === 'object' && record.error ? record.error : record;
          const code = nuniRecord(failure).code;
          throw new NuniError(
            response.status,
            typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REQUEST_FAILED',
          );
        }
        return value;
      } catch (error) {
        if (error instanceof NuniError) throw error;
        throw new NuniError(0, signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR');
      }
    },
    {
      timeoutMs: Math.max(12000, WAKE_REQUEST_TIMEOUT_MS),
      externalSignal: signal,
      // Check-in has no idempotency contract; the caller must read sessions after an uncertain result.
      retry: !path.endsWith('/check-in'),
    },
  );
};

export async function nuniPublicRequest(path: string, signal?: AbortSignal): Promise<unknown> {
  if (!PUBLIC_CAFETERIA_PATH.test(path)) throw new NuniError(400, 'INVALID_REQUEST');
  if (signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  return withWakeRetry(
    async (attemptSignal) => {
      try {
        const response = await fetch(`${PUBLIC_API}${path}`, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: attemptSignal,
          headers: { Accept: 'application/json' },
        });
        const body = await response.text();
        if (body.length > 2_000_000) throw new NuniError(502, 'INVALID_RESPONSE');
        let value: unknown;
        try {
          value = JSON.parse(body);
        } catch {
          throw new NuniError(response.ok ? 502 : response.status, 'INVALID_RESPONSE');
        }
        if (!response.ok) {
          const record = nuniRecord(value);
          const failure = typeof record.error === 'object' && record.error ? record.error : record;
          const code = nuniRecord(failure).code;
          throw new NuniError(
            response.status,
            typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REQUEST_FAILED',
          );
        }
        return value;
      } catch (error) {
        if (error instanceof NuniError) throw error;
        throw new NuniError(0, signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR');
      }
    },
    { timeoutMs: Math.max(12000, WAKE_REQUEST_TIMEOUT_MS), externalSignal: signal },
  );
}

function nuniBffFailure(value: unknown, status: number): never {
  const record = nuniRecord(value);
  const failure = typeof record.error === 'object' && record.error ? record.error : record;
  const code = nuniRecord(failure).code;
  throw new NuniError(
    status,
    typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REQUEST_FAILED',
  );
}

async function parseNuniBffJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 2_000_000) throw new NuniError(502, 'INVALID_RESPONSE');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NuniError(response.ok ? 502 : response.status, 'INVALID_RESPONSE');
  }
  if (!response.ok) nuniBffFailure(value, response.status);
  return value;
}

export async function nuniBffRequest(
  path: string,
  handle: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!/^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) || !NUNI_HANDLE.test(handle))
    throw new NuniError(400, 'INVALID_REQUEST');
  if (signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  return withWakeRetry(
    async (attemptSignal) => {
      try {
        const response = await fetch(`https://nuni.tw/api/nuni/${path}`, {
          method: input ? 'POST' : 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: attemptSignal,
          headers: {
            Accept: 'application/json',
            Authorization: `Platform ${handle}`,
            ...(input ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(input ? { body: JSON.stringify(input) } : {}),
        });
        return await parseNuniBffJson(response);
      } catch (error) {
        if (error instanceof NuniError) throw error;
        throw new NuniError(0, signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR');
      }
    },
    { timeoutMs: Math.max(12000, WAKE_REQUEST_TIMEOUT_MS), externalSignal: signal },
  );
}

export async function nuniBffFilePut(
  path: string,
  handle: string,
  body: Uint8Array,
  contentType: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!/^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) || !NUNI_HANDLE.test(handle))
    throw new NuniError(400, 'INVALID_REQUEST');
  if (signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  try {
    const response = await fetch(`https://nuni.tw/api/nuni/${path}`, {
      method: 'PUT',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Platform ${handle}`,
        'Content-Type': contentType,
      },
      body: body as unknown as BodyInit,
    });
    return await parseNuniBffJson(response);
  } catch (error) {
    if (error instanceof NuniError) throw error;
    throw new NuniError(0, signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR');
  }
}

export function parseNuniLoginTransaction(value: unknown) {
  const row = nuniRecord(value);
  if (
    row.kind !== 'google-consumer' ||
    typeof row.transactionId !== 'string' ||
    !/^pt_[A-Za-z0-9_-]{43}$/.test(row.transactionId) ||
    typeof row.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(row.nonce) ||
    typeof row.clientId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,240}\.apps\.googleusercontent\.com$/.test(row.clientId) ||
    row.issuer !== 'https://accounts.google.com' ||
    row.authorizationEndpoint !== 'https://accounts.google.com/o/oauth2/v2/auth' ||
    row.tokenEndpoint !== 'https://oauth2.googleapis.com/token' ||
    typeof row.expiresInSeconds !== 'number' ||
    !Number.isInteger(row.expiresInSeconds) ||
    row.expiresInSeconds < 1 ||
    row.expiresInSeconds > 600
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    transactionId: row.transactionId,
    nonce: row.nonce,
    clientId: row.clientId,
    expiresInSeconds: row.expiresInSeconds,
  };
}

export function parseNuniLoginSession(value: unknown) {
  const row = nuniRecord(value);
  if (
    typeof row.sessionHandle !== 'string' ||
    !NUNI_HANDLE.test(row.sessionHandle) ||
    typeof row.expiresInSeconds !== 'number' ||
    !Number.isInteger(row.expiresInSeconds) ||
    row.expiresInSeconds < 1 ||
    row.expiresInSeconds > 86400
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  return {
    ...parseNuniPrincipal({ ...row, authenticated: true }),
    sessionHandle: row.sessionHandle,
    expiresInSeconds: row.expiresInSeconds,
  };
}
