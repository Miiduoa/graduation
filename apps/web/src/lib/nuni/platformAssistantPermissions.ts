import type { NextRequest } from 'next/server';
import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import { parsePlatformAssistantPermissionUpdate } from '@campus/shared/src/platformAssistantPermissions';
import {
  readPlatformAssistantPermissions,
  savePlatformAssistantPermissions,
} from './platformAssistantPermissionStore';
import {
  SESSION_COOKIE,
  boundedJson,
  errorResponse,
  jsonResponse,
  platformRequest,
  readPlatformAuthorization,
  requireSameOrigin,
  requireSession,
} from './server';

export async function handlePlatformAssistantPermissions(request: NextRequest) {
  try {
    if (!['GET', 'POST'].includes(request.method)) throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
    const native = readPlatformAuthorization(request);
    if (request.headers.has('authorization') && !native)
      throw new NuniError(401, 'SIGN_IN_REQUIRED');
    if (native && request.cookies.has(SESSION_COOKIE))
      throw new NuniError(400, 'AMBIGUOUS_AUTHENTICATION');
    // Native requests use the existing Platform bearer transport. Browser cookies
    // still require their origin and exact session context; neither can mask the other.
    if (
      (!native && request.method === 'POST') ||
      request.headers.has('origin') ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      requireSameOrigin(request);
    const session = native ?? requireSession(request);
    // The encrypted browser cookie and a client-supplied account ID cannot replace this check.
    const principal = parseNuniPrincipal(await platformRequest('sessions/current', session));
    const accountId = principal.platformAccountId;
    if (request.method === 'GET')
      return jsonResponse(await readPlatformAssistantPermissions(accountId));
    const input = parsePlatformAssistantPermissionUpdate(await boundedJson(request, 1024));
    return jsonResponse(
      await savePlatformAssistantPermissions(accountId, input.expectedRevision, input.permissions),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
