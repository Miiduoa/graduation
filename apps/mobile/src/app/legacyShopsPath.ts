/** Accept only a configured plain DNS host for an iOS/Android verified HTTPS
 * app link. Without a release-configured host the OS must keep HTTPS on web.
 */
export function socialPostHttpsPrefixes(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const host = value.trim().toLowerCase();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return [];
  return [`https://${host}`];
}

/** The website shares /community/post/<id>?schoolId=<campus> while the native
 * HomeStack route is /post/<id>. Preserve the verified source campus; never
 * reinterpret a missing/duplicate campus or malformed ID under the active school.
 * Only route selection changes; PostDetail still fetches from the server.
 */
function rewriteCanonicalSharedPostPath(path: string): string {
  const match = path.match(/^(\/?)community\/post\/([^/?#]+)(\?[^#]*)?$/);
  if (!match) return path;
  let postId: string;
  try {
    postId = decodeURIComponent(match[2]);
  } catch {
    return path;
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(postId)) return path;
  const params = new URLSearchParams((match[3] ?? '').slice(1));
  const sourceSchools = params.getAll('schoolId');
  if (sourceSchools.length !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(sourceSchools[0])) return path;
  return `${match[1]}post/${encodeURIComponent(postId)}?schoolId=${encodeURIComponent(sourceSchools[0])}`;
}

/** Shared native linking pipeline: legacy locations and the website's post URL. */
export function rewriteLegacyShopsPath(path: string): string {
  return rewriteCanonicalSharedPostPath(path)
    .replace(/(^|\/)shops(?=\/|\?|$)/, '$1sso-login')
    .replace(/(^|\/)(?:staff|department|dormitory)(?=\/|\?|$)/, '$1home');
}
