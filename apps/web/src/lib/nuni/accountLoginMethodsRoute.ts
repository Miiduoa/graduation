import { NextRequest, NextResponse } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { parseAccountLoginMethods } from './accountLoginMethods';
import { googleAccountLinkEnabled, googleAccountManagementEnabled } from './googleAccountLink';
import {
  apiOrigin,
  fetchJson,
  jsonResponse,
  publicOrigin,
  requireSession,
  sessionContext,
} from './server';

export const ACCOUNT_LOGIN_METHODS_PATH = '/api/nuni/account/login-methods';

/** A session-bound read. It cannot start, finish, cancel or otherwise change a link transaction. */
export async function handleAccountLoginMethods(request: NextRequest): Promise<NextResponse> {
  if (!googleAccountManagementEnabled()) return jsonResponse({ error: 'NOT_FOUND' }, 404);
  try {
    if (request.method !== 'GET') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (
      request.nextUrl.pathname !== ACCOUNT_LOGIN_METHODS_PATH ||
      request.nextUrl.search ||
      request.body !== null
    ) {
      throw new NuniError(400, 'INVALID_INPUT');
    }
    const origin = request.headers.get('origin');
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin !== null && origin !== publicOrigin())
    ) {
      throw new NuniError(403, 'ORIGIN_REJECTED');
    }
    const session = requireSession(request);
    const context = sessionContext(session);
    const inventory = parseAccountLoginMethods(
      await fetchJson(
        apiOrigin() + '/v1/auth/platform/account-links/google/status',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Platform ' + session.sessionHandle,
          },
          signal: request.signal,
        },
        4096,
        { retry: false },
      ),
    );
    if (session.expiresAt <= Date.now()) throw new NuniError(401, 'SIGN_IN_REQUIRED');
    // Provider configuration can stop new links while existing methods remain inspectable.
    if (inventory.googleLink === 'available' && !googleAccountLinkEnabled()) {
      inventory.googleLink = 'unavailable';
    }
    return jsonResponse({ ...inventory, context });
  } catch (error) {
    if (error instanceof NuniError) {
      if (error.status === 401) return jsonResponse({ error: 'SIGN_IN_REQUIRED' }, 401);
      if (error.code === 'SESSION_CHANGED') return jsonResponse({ error: 'SESSION_CHANGED' }, 409);
      if (error.code === 'ORIGIN_REJECTED') return jsonResponse({ error: 'ORIGIN_REJECTED' }, 403);
      if (error.code === 'INVALID_INPUT') return jsonResponse({ error: 'INVALID_INPUT' }, 400);
      if (error.code === 'INVALID_RESPONSE' || error.code === 'BODY_TOO_LARGE') {
        return jsonResponse({ error: 'INVALID_RESPONSE' }, 502);
      }
    }
    return jsonResponse({ error: 'LOGIN_METHODS_UNAVAILABLE' }, 503);
  }
}
