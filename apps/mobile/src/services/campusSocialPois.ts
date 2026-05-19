/**
 * 校園社群 — Realtime LBS 用 POI 清單
 *
 * 對應 RealtimeSocialScreen「我在這裡」打卡功能。
 * 不直接讓使用者打字，而是從靜宜大學真實 POI 數據中挑出最常被打卡的場景，
 * 並補上幾個「跨地點」泛用標籤（讀書室、咖啡廳等）。
 *
 * 資料來源：apps/mobile/src/data/puCampusData.ts（CAMPUS_POIS）
 */

import {
  CAMPUS_POIS,
  getCampusPoi,
  type CampusPoi,
  type CampusPoiCategory,
} from '../data/puCampusData';

export type SocialPoi = {
  /** Firestore 寫入的 poiId（穩定字串）。對應 CAMPUS_POIS.id。 */
  id: string;
  /** 顯示名稱（短） */
  name: string;
  /** 區分用標籤（圖書館、學餐、運動、教學） */
  category: SocialPoiCategory;
  /** 額外描述（地點補充） */
  hint?: string;
};

export type SocialPoiCategory =
  | 'library'
  | 'cafeteria'
  | 'sports'
  | 'academic'
  | 'social'
  | 'transit';

const PREFERRED_IDS: { id: string; category: SocialPoiCategory; hint?: string }[] = [
  { id: 'pu-library', category: 'library', hint: '主圖書館' },
  { id: 'pu-providence', category: 'academic', hint: '主顧樓' },
  { id: 'pu-renyuan', category: 'academic', hint: '任垣樓 · 計中' },
  { id: 'pu-boduo', category: 'academic', hint: '伯鐸樓' },
  { id: 'pu-jingan', category: 'academic', hint: '靜安樓 · 管院' },
  { id: 'pu-gelun', category: 'academic', hint: '格倫樓 · 法律' },
  { id: 'pu-gym', category: 'sports', hint: '體育館' },
  { id: 'pu-track', category: 'sports', hint: '田徑場' },
  { id: 'pu-student-center', category: 'social', hint: '學生中心' },
  { id: 'pu-arts', category: 'academic', hint: '藝術中心' },
  { id: 'pu-7eleven', category: 'cafeteria', hint: '7-ELEVEN' },
  { id: 'pu-ok-mart', category: 'cafeteria', hint: 'OK mart' },
  { id: 'pu-bus-stop', category: 'transit', hint: '校門公車站' },
];

const SYNTHETIC_FALLBACK: SocialPoi[] = [
  { id: 'lbs-other-quad', name: '校園中庭', category: 'social', hint: '集合地點' },
  { id: 'lbs-other-study', name: '自習空間', category: 'library', hint: '不限館內外' },
];

let _cache: SocialPoi[] | null = null;

export function getSocialPoiList(): SocialPoi[] {
  if (_cache) return _cache;
  const synthesized = PREFERRED_IDS.flatMap((cfg) => {
    const row = getCampusPoi(cfg.id);
    if (!row) return [];
    return [
      {
        id: row.id,
        name: row.name,
        category: cfg.category,
        hint: cfg.hint ?? row.description?.slice(0, 18),
      } satisfies SocialPoi,
    ];
  });
  _cache = synthesized.length > 0 ? [...synthesized, ...SYNTHETIC_FALLBACK] : SYNTHETIC_FALLBACK;
  return _cache;
}

export function findSocialPoi(id?: string | null): SocialPoi | null {
  if (!id) return null;
  return getSocialPoiList().find((p) => p.id === id) ?? null;
}

export function defaultSocialPoiId(): string {
  return getSocialPoiList()[0]?.id ?? 'lbs-library-main';
}

export const SOCIAL_POI_CATEGORY_LABEL: Record<SocialPoiCategory, string> = {
  library: '圖書館',
  cafeteria: '學餐',
  sports: '運動',
  academic: '教學',
  social: '社交',
  transit: '通勤',
};

/** 反查 CampusPoi 完整資料（給其他模組用，例如導航） */
export function resolveCampusPoiForSocial(id: string): CampusPoi | null {
  return getCampusPoi(id) ?? null;
}

export function categoryFromCampusPoi(cat: CampusPoiCategory): SocialPoiCategory {
  switch (cat) {
    case 'library':
      return 'library';
    case 'cafeteria':
      return 'cafeteria';
    case 'sports':
      return 'sports';
    case 'academic':
    case 'research':
      return 'academic';
    case 'parking':
    case 'gate':
      return 'transit';
    default:
      return 'social';
  }
}

/** 用於除錯：強制清快取（測試用，正式碼通常不會呼叫） */
export function _resetSocialPoiCache() {
  _cache = null;
}
