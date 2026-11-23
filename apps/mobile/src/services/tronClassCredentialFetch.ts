import { NuniError } from '@campus/shared/src/nuni';

/** The only endpoint that may receive a school password: nuni's own BFF performs the school login. */
export const TRONCLASS_CREDENTIAL_ENDPOINT = 'https://nuni.tw/api/tronclass';

type CredentialRequestInit = {
  signal?: AbortSignal;
  headers: Record<string, string>;
  body: string;
};

type CredentialResponse = {
  ok: boolean;
  status: number;
  redirected?: boolean;
  text(): Promise<string>;
};

/**
 * Sends a request whose body carries school credentials.
 *
 * React Native's global fetch may follow a 307/308 inside the native network
 * stack and re-send the body before JavaScript sees the response, regardless
 * of `redirect: 'error'`. Expo's native fetch applies the redirect mode in the
 * native layer itself (OkHttp `followRedirects(false)`, URLSession refusing the
 * redirected request), so a redirect can never carry the body anywhere. There is
 * deliberately no fallback to the global fetch.
 */
export async function tronClassCredentialFetch(
  endpoint: string,
  init: CredentialRequestInit,
): Promise<CredentialResponse> {
  if (endpoint !== TRONCLASS_CREDENTIAL_ENDPOINT) throw new NuniError(400, 'INVALID_REQUEST');
  let nativeFetch: unknown;
  try {
    nativeFetch = (require('expo/fetch') as typeof import('expo/fetch')).fetch;
  } catch {
    nativeFetch = undefined;
  }
  if (typeof nativeFetch !== 'function')
    throw new NuniError(0, 'TRONCLASS_SECURE_TRANSPORT_UNAVAILABLE');
  const response = (await (
    nativeFetch as (url: string, init: Record<string, unknown>) => Promise<unknown>
  )(endpoint, {
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    signal: init.signal,
    headers: { ...init.headers, 'Cache-Control': 'no-store' },
    body: init.body,
  })) as CredentialResponse;
  // Defence in depth: never accept a response that reports any redirect.
  if (response.redirected === true || (response.status >= 300 && response.status < 400))
    throw new NuniError(502, 'INVALID_RESPONSE');
  return response;
}
