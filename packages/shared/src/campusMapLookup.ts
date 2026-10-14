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
    Array.from(name).some((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127; }) ||
    name === '請先選擇校園' ||
    name === '所選校園尚未接入' ||
    /^所選校園[（(]/.test(name)
  ) return null;
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${name} 校園`);
  return url.toString();
}


export const PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL =
  'https://b028.pu.edu.tw/p/426-1054-34.php?Lang=zh-tw';

export function hasOfficialProvidenceLibraryGuide(
  schoolId: string,
  place: { name: string; category: string },
): boolean {
  return schoolId === 'pu' && place.category === '圖書館' && place.name.includes('蓋夏');
}
