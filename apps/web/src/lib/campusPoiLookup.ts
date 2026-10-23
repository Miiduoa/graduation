/**
 * Web-side POI lookup table for map deep links (?route= / ?focus=).
 *
 * 不再另外維護一份靜宜清單：直接衍生自校園地圖逐筆核對過的資料
 * （apps/web/src/app/map/providenceCampus.ts，2026-10-19 核對），
 * id、名稱、座標、來源與可信程度都以那份為準，避免兩份座標互相矛盾。
 * 舊清單中對不上核對資料的地點已移除，不沿用偏離校園約 1.6 公里的
 * 舊座標；逐筆紀錄見 docs/campus-map-providence.md。
 */
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  type ProvidenceVerification,
} from '../app/map/providenceCampus';

export interface CampusPoiLite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  verification: ProvidenceVerification;
  sourceUrl: string;
}

const CATEGORY_BY_MAP_CATEGORY: Record<string, string> = {
  教學: 'academic',
  圖書館: 'library',
  宗教: 'religious',
  餐飲: 'cafeteria',
  住宿: 'dormitory',
  運動: 'sports',
  健康: 'medical',
  生活: 'other',
  停車: 'parking',
  交通: 'gate',
  公車站: 'transit',
};

export const CAMPUS_POIS_LITE: CampusPoiLite[] = [
  ...PROVIDENCE_CAMPUS_PLACES,
  ...PROVIDENCE_BUS_STOPS,
].map((place) => ({
  id: place.id,
  name: place.name,
  lat: place.lat,
  lng: place.lng,
  category: CATEGORY_BY_MAP_CATEGORY[place.category] ?? 'other',
  verification: place.verification,
  sourceUrl: place.sourceUrl,
}));

const POI_BY_ID = new Map(CAMPUS_POIS_LITE.map((p) => [p.id, p]));

export function getCampusPoiLite(id: string): CampusPoiLite | undefined {
  return POI_BY_ID.get(id);
}

/** Approx Haversine distance in meters (for ETA). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aH =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
}
