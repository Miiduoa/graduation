import { NuniError, nuniRecord, parseNuniPrincipal } from '@campus/shared/src/nuni';

const API = 'https://api.nuni.tw/v1/auth/platform/';
export const NUNI_HANDLE = /^ps_[A-Za-z0-9_-]{43}$/;
export type NuniTransport = (
  path: string,
  handle?: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;

/** Credentials are sent only to the platform API, never to a supplied URL. */
export const nuniPlatformRequest: NuniTransport = async (path, handle, input, signal) => {
  if (!/^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) || (handle && !NUNI_HANDLE.test(handle)))
    throw new NuniError(400, 'INVALID_REQUEST');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 12000);
  try {
    const response = await fetch(`${API}${path}`, {
      method: input ? 'POST' : 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(handle ? { Authorization: `Platform ${handle}` } : {}),
        ...(input ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
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
    throw new NuniError(0, controller.signal.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
};

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
