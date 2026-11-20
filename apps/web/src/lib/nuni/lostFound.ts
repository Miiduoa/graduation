import type { NextRequest } from 'next/server';
import { NuniError, parseNuniPrincipal } from '@campus/shared/src/nuni';
import {
  NUNI_LOST_FOUND_BODY_LIMIT,
  isNuniLostFoundAction,
  parseNuniLostFoundResponse,
  validateNuniLostFoundRequest,
} from '@campus/shared/src/nuniLostFound';
import {
  boundedJson,
  errorResponse,
  jsonResponse,
  platformRequest,
  requireSameOrigin,
  requireSession,
} from './server';

/** Browser requests keep the same cookie and captured-session boundary as other platform tools. */
export async function handleLostFound(request: NextRequest, segments: string[]) {
  try {
    const action = segments[1];
    if (
      segments.length !== 2 || segments[0] !== 'lost-found' ||
      !isNuniLostFoundAction(action) ||
      request.nextUrl.pathname !== `/api/nuni/lost-found/${action}`
    ) throw new NuniError(404, 'NOT_FOUND');
    if (request.method !== 'POST') throw new NuniError(405, 'METHOD_NOT_ALLOWED');
    if (request.nextUrl.search) throw new NuniError(400, 'INVALID_INPUT');
    requireSameOrigin(request);
    const session = requireSession(request);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json')
      throw new NuniError(415, 'UNSUPPORTED_MEDIA_TYPE');
    let raw: unknown;
    try {
      raw = await boundedJson(request, NUNI_LOST_FOUND_BODY_LIMIT);
    } catch (error) {
      if (error instanceof NuniError && error.code === 'INVALID_RESPONSE')
        throw new NuniError(400, 'INVALID_INPUT');
      throw error;
    }
    const input = validateNuniLostFoundRequest(action, raw);
    let result: unknown;
    try {
      result = await platformRequest(`lost-found/${action}`, session, { ...input });
    } catch (error) {
      if (!(error instanceof NuniError && error.status === 401)) throw error;
      // Older APIs send unknown platform routes through campus authentication.
      // Verify this exact cookie session before calling the module unavailable;
      // the original operation must never be retried as part of this probe.
      try {
        parseNuniPrincipal(await platformRequest('sessions/current', session));
      } catch (probeError) {
        if (probeError instanceof NuniError && probeError.status === 401) throw probeError;
        throw new NuniError(503, 'SERVICE_UNAVAILABLE');
      }
      throw new NuniError(503, 'LOST_FOUND_UNAVAILABLE');
    }
    return jsonResponse(parseNuniLostFoundResponse(action, result, input));
  } catch (error) {
    return errorResponse(error);
  }
}
