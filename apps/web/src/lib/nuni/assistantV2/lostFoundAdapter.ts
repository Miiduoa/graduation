import { createNuniLostFound, type NuniLostFoundTransport } from '@campus/shared/src/nuniLostFound';
import { lostFoundHref, lostFoundListInput, lostFoundQuery, parseLostFoundResult, type LostFoundRead } from './lostFound';

/** The caller supplies its existing platform transport, including the verified
 * session, abort signals and shared API budget. This adapter never makes a new
 * identity, calls a school reader, or exposes get/export/write operations. */
export async function readLostFound(
  schoolId: string,
  args: unknown,
  transport: NuniLostFoundTransport,
  now = Date.now(),
): Promise<LostFoundRead> {
  const input = lostFoundListInput(args, schoolId);
  const query = lostFoundQuery(input);
  const result: LostFoundRead = { version: 1, source: 'platform-lost-found', schoolId,
    checkedAt: new Date(now).toISOString(), query, status: 'ready', items: [], nextCursor: null,
    partial: false, href: lostFoundHref(schoolId) };
  try {
    const page = await createNuniLostFound(transport).list(input);
    result.items = page.items;
    result.nextCursor = page.nextCursor;
    result.partial = page.nextCursor !== null;
  } catch (error) {
    if (!error || typeof error !== 'object') throw error;
    const failure = error as { status?: number; code?: string };
    if (failure.status === 401 || failure.status === 403 ||
      ['ABORTED', 'API_BUDGET_EXCEEDED', 'CONFIGURATION_REQUIRED', 'INVALID_RESPONSE', 'TOOL_TIMEOUT'].includes(failure.code ?? '')) throw error;
    if (failure.status === 404 || failure.code === 'LOST_FOUND_UNAVAILABLE') {
      result.status = 'unavailable';
      result.unavailable = 'NOT_CONNECTED';
    } else if (failure.status === 503) {
      result.status = 'unavailable';
      result.unavailable = 'SOURCE_UNAVAILABLE';
    } else throw error;
  }
  return parseLostFoundResult(result, schoolId, query);
}
