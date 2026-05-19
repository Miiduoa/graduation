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
  { id: 'pu-library', name: '主圖書館', category: 'library', hint: '主圖書館 · 自習區' },
  { id: 'pu-providence', name: '主顧樓', category: 'academic', hint: '外語學院教學大樓' },
  { id: 'pu-renyuan', name: '任垣樓', category: 'academic', hint: '理工學院 · 計中' },
  { id: 'pu-boduo', name: '伯鐸樓', category: 'academic', hint: '文學院/社科' },
  { id: 'pu-jingan', name: '靜安樓', category: 'academic', hint: '管理學院' },
  { id: 'pu-gelun', name: '格倫樓', category: 'academic', hint: '法律學院' },
  { id: 'pu-gym', name: '體育館', category: 'sports', hint: '球類/重量訓練' },
  { id: 'pu-track', name: '田徑場', category: 'sports', hint: '操場跑道' },
  { id: 'pu-student-center', name: '學生中心', category: 'social', hint: '集合地點' },
  { id: 'pu-arts', name: '藝術中心', category: 'academic', hint: '展演空間' },
  { id: 'pu-7eleven', name: '7-ELEVEN', category: 'cafeteria', hint: '校內超商' },
  { id: 'pu-ok-mart', name: 'OK mart', category: 'cafeteria', hint: '校內超商' },
  { id: 'pu-bus-stop', name: '校門公車站', category: 'transit', hint: '臺灣大道' },
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

export function findSocialPoi(id?: string | null): SocialPoi | null {
  if (!id) return null;
  return SOCIAL_POIS.find((p) => p.id === id) ?? null;
}

export function defaultSocialPoiId(): string {
  return SOCIAL_POIS[0]?.id ?? 'lbs-other-quad';
}
