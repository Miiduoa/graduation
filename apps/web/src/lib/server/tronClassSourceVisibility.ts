/**
 * Source lists can include metadata for unpublished or hidden activities.
 * Missing flags preserve older tenant responses; supplied flags must use the
 * known boolean or 0/1 encoding. A positive flag never overrides a denial in
 * another field, and unrecognised supplied values do not establish visibility.
 * This does not replace course ownership or explicit attachment permissions.
 */
export function isTronClassSourceVisible(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const field of ['is_hidden', 'hidden'] as const) {
    const flag = row[field];
    if (flag !== undefined && flag !== false && flag !== 0) return false;
  }
  const published = row.published;
  return published === undefined || published === true || published === 1;
}
