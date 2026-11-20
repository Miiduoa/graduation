/**
 * 校園社群 — Realtime LBS 用 POI 清單（Web）
 *
 * 與 apps/mobile/src/services/campusSocialPois.ts 一致的 schema，
 * 但 web 端不引用 puCampusData（過於龐大、純資料），改為內嵌一份精簡 POI
 * seed。新增 POI 時請與 mobile 端同步。
 */

export type SocialPoiCategory =
  | 'library'
  | 'cafeteria'
  | 'sports'
  | 'academic'
  | 'social'
  | 'transit';

export type SocialPoi = {
  id: string;
  name: string;
  category: SocialPoiCategory;
  hint?: string;
};

export const SOCIAL_POIS: SocialPoi[] = [
  { id: 'pu-library', name: '蓋夏圖書館', category: 'library', hint: '蓋夏圖書館 · 自習區' },
  { id: 'pu-zhugu', name: '主顧樓', category: 'academic', hint: '外語學院教學大樓' },
  { id: 'pu-renyuan', name: '任垣樓', category: 'academic', hint: '理工學院 · 計中' },
  { id: 'pu-boduo', name: '伯鐸樓', category: 'academic', hint: '文學院/社科' },
  { id: 'pu-jingan', name: '靜安樓', category: 'academic', hint: '管理學院' },
  { id: 'pu-gelun', name: '格倫樓', category: 'academic', hint: '法律學院' },
  { id: 'pu-gym', name: '若望保祿二世體育館', category: 'sports', hint: '球類/重量訓練' },
  { id: 'pu-pool', name: '溫水游泳池', category: 'sports', hint: '溫水游泳池' },
  { id: 'pu-jingyuan', name: '靜園餐廳', category: 'cafeteria', hint: '校內餐廳' },
  { id: 'pu-yiyuan', name: '宜園餐廳', category: 'cafeteria', hint: '校內餐廳' },
  { id: 'pu-bus-gate', name: '靜宜大學（校門）', category: 'transit', hint: '校門公車站' },
  { id: 'lbs-other-quad', name: '校園中庭', category: 'social', hint: '一般集合' },
  { id: 'lbs-other-study', name: '自習空間', category: 'library', hint: '不限館內外' },
];

export const SOCIAL_POI_CATEGORY_LABEL: Record<SocialPoiCategory, string> = {
  library: '圖書館',
  cafeteria: '學餐',
  sports: '運動',
  academic: '教學',
  social: '社交',
  transit: '通勤',
};

/**
 * Fixed PU campus-place IDs are not reusable across other universities.
 * Unverified campuses can still publish stories without a place check-in.
 */
export function verifiedSocialPoisForSchool(schoolId: string): readonly SocialPoi[] {
  return schoolId === 'pu' || schoolId === 'tw-pu' ? SOCIAL_POIS : [];
}

export function findSocialPoi(id?: string | null): SocialPoi | null {
  if (!id) return null;
  return SOCIAL_POIS.find((p) => p.id === id) ?? null;
}

export function defaultSocialPoiId(): string {
  return SOCIAL_POIS[0]?.id ?? 'lbs-other-quad';
}
