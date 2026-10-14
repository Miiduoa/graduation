/**
 * Search a third-party map by university name when the school's own POI
 * collection has no confirmed locations. This is not a verified POI source.
 */
export function buildCampusMapSearchUrl(schoolName?: string | null): string | null {
  if (typeof schoolName !== 'string') return null;
  const name = schoolName.trim();
  if (
    !name ||
    name.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    name === '請先選擇校園' ||
    name === '所選校園尚未接入' ||
    /^所選校園[（(]/.test(name)
  ) return null;
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${name} 校園`);
  return url.toString();
}
