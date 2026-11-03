import { PublicAgentError } from './contract';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
type FreeOnlyGuard = (signal: AbortSignal) => Promise<boolean>;
type Options = { credential: string; fetch: typeof fetch; freeOnlyGuard: FreeOnlyGuard };
const unavailable = (): never => {
  throw new PublicAgentError('PUBLIC_AGENT_PROVIDER_UNAVAILABLE', 503);
};

/**
 * Candidate only. The host must supply an authoritative no-charge guarantee; a
 * plan-status lookup or an operator-provided boolean cannot make billing atomic.
 * No runtime configuration in this repository enables this transport.
 */
export function createGroqServerTransport(options: Options) {
  if (
    typeof options?.credential !== 'string' ||
    !/^[\x21-\x7e]{1,1024}$/u.test(options.credential) ||
    typeof options.fetch !== 'function' ||
    typeof options.freeOnlyGuard !== 'function'
  )
    return unavailable();
  const credential = options.credential;
  return async (input: string, init: RequestInit, beforeSend: () => Promise<void>) => {
    const headers = new Headers(init?.headers);
    if (
      input !== ENDPOINT ||
      init?.method !== 'POST' ||
      init.redirect !== 'error' ||
      init.cache !== 'no-store' ||
      typeof init.body !== 'string' ||
      !init.signal ||
      typeof beforeSend !== 'function' ||
      headers.get('content-type') !== 'application/json' ||
      headers.get('accept') !== 'application/json' ||
      [...headers.keys()].some((name) => name !== 'accept' && name !== 'content-type')
    )
      return unavailable();
    const signal = init.signal;
    if (signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_PROVIDER_CANCELLED', 503);
    let allowed = false;
    try {
      allowed = (await options.freeOnlyGuard(signal)) === true;
    } catch {
      return unavailable();
    }
    if (signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_PROVIDER_CANCELLED', 503);
    if (!allowed) return unavailable();
    // Recheck the session after the potentially slow guard and immediately before sending.
    await beforeSend();
    if (signal.aborted) throw new PublicAgentError('PUBLIC_AGENT_PROVIDER_CANCELLED', 503);
    try {
      return await options.fetch(ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${credential}`,
        },
        body: init.body,
      });
    } catch {
      return unavailable();
    }
  };
}
