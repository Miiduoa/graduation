import type { NextRequest } from 'next/server';
import { AccountDemoError, parseAccountDemoMutation } from '@campus/shared/src/accountDemo';
import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import {
  boundedJson,
  jsonResponse,
  platformRequest,
  readPlatformAuthorization,
  requireSameOrigin,
  requireSession,
  SESSION_COOKIE,
  type PlatformSession,
} from './server';
import { resolveAccountDemoStore, type AccountDemoStore } from './accountDemoStore';

type Dependencies = {
  store?: () => AccountDemoStore;
  principal?: (session: PlatformSession) => Promise<unknown>;
};
export function createAccountDemoHandler(deps: Dependencies = {}) {
  return async function handleAccountDemo(request: NextRequest) {
    try {
      if (!['GET', 'POST'].includes(request.method)) throw new NuniError(405, 'METHOD_NOT_ALLOWED');
      if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
      const native = readPlatformAuthorization(request);
      // Do not silently downgrade a malformed bearer to a cookie-authenticated request.
      if (request.headers.has('authorization') && !native)
        throw new NuniError(401, 'SIGN_IN_REQUIRED');
      if (
        native &&
        (request.cookies.has(SESSION_COOKIE) || request.headers.has('x-campus-session'))
      ) {
        throw new NuniError(400, 'AMBIGUOUS_AUTHENTICATION');
      }
      if (request.method === 'POST' && !native) requireSameOrigin(request);
      const session = native ?? requireSession(request);
      let mutation: ReturnType<typeof parseAccountDemoMutation> | undefined;
      if (request.method === 'POST') {
        const mediaType = request.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== 'application/json') throw new NuniError(415, 'UNSUPPORTED_MEDIA_TYPE');
        try {
          mutation = parseAccountDemoMutation(await boundedJson(request, 4096));
        } catch (error) {
          if (error instanceof NuniError && error.code === 'INVALID_RESPONSE') {
            throw new NuniError(400, 'INVALID_INPUT');
          }
          throw error;
        }
      }
      const principal = parseNuniPrincipal(
        await (deps.principal ?? ((value) => platformRequest('sessions/current', value)))(session),
      );
      const store = (deps.store ?? resolveAccountDemoStore)();
      const demo = mutation
        ? await store.mutate(principal.platformAccountId, mutation)
        : await store.read(principal.platformAccountId);
      const response = jsonResponse({ demo });
      response.headers.set('Vary', 'Cookie, X-Campus-Session, Authorization');
      return response;
    } catch (error) {
      const known = error instanceof NuniError || error instanceof AccountDemoError;
      const response = jsonResponse(
        { error: known ? error.code : 'ACCOUNT_DEMO_STORE_UNAVAILABLE' },
        known ? error.status : 503,
      );
      response.headers.set('Vary', 'Cookie, X-Campus-Session, Authorization');
      return response;
    }
  };
}
export const handleAccountDemo = createAccountDemoHandler();
