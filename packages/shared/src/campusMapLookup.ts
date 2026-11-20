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

/** A verified university-operated campus plan, not an imported POI data feed. */
export const PROVIDENCE_CAMPUS_MAP_URL =
  'https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw';

const OFFICIAL_CAMPUS_MAP_URLS = new Map<string, string>([
  ['pu', PROVIDENCE_CAMPUS_MAP_URL],
  ['nthu', 'https://www.nthu.edu.tw/campusmap'],
  ['ncu', 'https://www.ncu.edu.tw/p/412-1000-105.php?Lang=zh-tw'],
  ['ntu', 'https://www.ntu.edu.tw/about/map.html'],
  ['tw-nchu', 'https://www.nchu.edu.tw/about/mid/869'],
  // The public school directory uses nchu; tw-nchu remains a legacy tenant ID.
  ['nchu', 'https://www.nchu.edu.tw/about/mid/869'],
  ['ncku', 'https://web.ncku.edu.tw/p/412-1000-29366.php'],
  ['ntust', 'https://www.ntust.edu.tw/p/412-1000-102.php?Lang=zh-tw'],
  ['nycu', 'https://www.nycu.edu.tw/aa/ch/app/artwebsite/view?id=2454&module=artwebsite&serno=d4bf9e00-384d-4ce7-bdf9-8ff5b2a00375'],
  ['nsysu', 'https://oia.nsysu.edu.tw/p/412-1308-20769.php?Lang=zh-tw'],
  ['ntnu', 'https://ap.itc.ntnu.edu.tw/NtnuMap/map.do'],
  ['nccu', 'https://bdmap.nccu.edu.tw/zh-tw/campus-mapbox'],
  ['ncyu', 'https://www.ncyu.edu.tw/ncyu/Subject?nodeId=552'],
  ['ncue', 'https://freshman.ncue.edu.tw/p/405-1047-22063,c3435.php'],
  ['ntpu', 'https://new.ntpu.edu.tw/about/map-directions'],
  ['tmu', 'https://www.tmu.edu.tw/FrontPointOfEntry.aspx?Sn=18'],
  ['fju', 'https://www.fju.edu.tw/aboutFju.jsp?labelID=7'],
  ['thu', 'https://thupr.thu.edu.tw/download.php'],
  ['cgu', 'https://www.cgu.edu.tw/ch/Contents/?nodeId=14303'],
  ['cycu', 'https://map.cycu.edu.tw/'],
  ['scu', 'https://www-ch.scu.edu.tw/school_map'],
  ['ntub', 'https://info.ntub.edu.tw/p/412-1031-26.php?Lang=zh-tw'],
]);

export function getOfficialCampusMapUrl(schoolId?: string | null): string | null {
  return schoolId ? OFFICIAL_CAMPUS_MAP_URLS.get(schoolId) ?? null : null;
}
