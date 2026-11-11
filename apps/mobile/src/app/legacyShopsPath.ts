const CAMPUS_HINT_KEYS = ['school', 'schoolId', 'campus'];

function campusHints(query: string): string[] {
  const values = new Map<string, string | null>();
  // React Native's URLSearchParams throws on malformed escapes and splits values at '='.
  // Decode only the allowlisted hints; a bad or repeated hint never changes the destination.
  for (const field of query.split('&')) {
    const separator = field.indexOf('=');
    let key: string;
    try {
      key = decodeURIComponent((separator < 0 ? field : field.slice(0, separator)).replace(/\+/g, ' '));
    } catch {
      continue;
    }
    if (!CAMPUS_HINT_KEYS.includes(key)) continue;
    if (values.has(key)) {
      values.set(key, null);
      continue;
    }
    try {
      const value = decodeURIComponent((separator < 0 ? '' : field.slice(separator + 1)).replace(/\+/g, ' '));
      values.set(key, /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : null);
    } catch {
      values.set(key, null);
    }
  }
  // Accepted values contain only unreserved URL characters.
  return CAMPUS_HINT_KEYS.flatMap((key) => {
    const value = values.get(key);
    return value ? [`${key}=${value}`] : [];
  });
}

/** 舊 /shops 根入口改走 Google 平台點餐；已下架功能深鏈改走今天。 */
export function rewriteLegacyShopsPath(path: string): string {
  const shops = /^(\/?)shops\/?(?:\?([^#]*))?(?:#.*)?$/.exec(path);
  if (shops) {
    // Campus hints are not school membership, account identity, or food authorization.
    // Never forward a legacy role, credential, return target, or workspace/account override.
    const query = ['tab=food', ...campusHints(shops[2] ?? '')].join('&');
    return `${shops[1]}campus-one?${query}`;
  }
  // No legacy vendor/detail mapping exists; do not turn an unsupported link into a food root.
  if (/^\/?shops\//.test(path)) return path;
  return path.replace(/(^|\/)(?:staff|department)(?=\/|\?|$)/, '$1home');
}
