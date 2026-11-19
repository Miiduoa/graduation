import {
  parsePublicSocialArguments, parsePublicSocialFeed, parsePublicSocialResult,
  publicSocialHref, type PublicSocialRead,
} from './publicSocial';

export type PublicSocialTransport = (
  path: string,
  input?: Record<string, unknown>,
  query?: Record<string, string>,
) => Promise<unknown>;

/** Reuse the existing authenticated public-social GET. This reader never reads
 * school-private communities, accepts caller tenant IDs, or submits a post. The
 * caller owns the verified session, cancellation and shared API budget. */
export async function readPublicSocial(
  schoolId: string,
  args: unknown,
  transport: PublicSocialTransport,
  now = Date.now(),
): Promise<PublicSocialRead> {
  const query = parsePublicSocialArguments(args);
  const href = publicSocialHref(schoolId);
  const result: PublicSocialRead = { version: 1, source: 'platform-public-social', sourcePath: 'social/feed',
    schoolId, checkedAt: new Date(now).toISOString(), query, status: 'ready', items: [],
    nextCursor: null, partial: false, href };
  try {
    const raw = await transport('social/feed', undefined, { tenantId: schoolId, limit: String(query.limit) });
    const page = parsePublicSocialFeed(raw, schoolId, query.limit);
    result.items = page.items;
    result.nextCursor = page.nextCursor;
    result.partial = page.nextCursor !== null;
  } catch (error) {
    if (!error || typeof error !== 'object') throw error;
    const failure = error as { status?: number; code?: string };
    if (failure.status === 401 || failure.status === 403 ||
        ['ABORTED', 'API_BUDGET_EXCEEDED', 'CONFIGURATION_REQUIRED', 'INVALID_RESPONSE', 'INVALID_PUBLIC_SOCIAL_RESULT', 'TOOL_TIMEOUT'].includes(failure.code ?? ''))
      throw error;
    if (failure.status === 404) {
      result.status = 'unavailable';
      result.unavailable = 'NOT_CONNECTED';
    } else if (failure.status === 503) {
      result.status = 'unavailable';
      result.unavailable = 'SOURCE_UNAVAILABLE';
    } else throw error;
  }
  return parsePublicSocialResult(result, schoolId, query);
}
