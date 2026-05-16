/* eslint-disable */
/**
 * 儲存地點 — 「家」「學校」「最常去」管理
 *
 * 對應 Google Maps 的「儲存」功能。資料持久化在 AsyncStorage。
 * 提供 React Hook 與純函式 API 雙介面。
 */

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMPUS_POIS, getCampusPoi, type CampusPoi } from '../data/puCampusData';

const STORAGE_KEY = '@savedPlaces:v1';

export type SavedPlaceKind = 'home' | 'school' | 'work' | 'custom';

export type SavedPlace = {
  id: string;
  kind: SavedPlaceKind;
  /** 顯示名稱（家 / 學校 / 自訂） */
  label: string;
  /** 實際地址或 POI 名稱 */
  name: string;
  lat: number;
  lng: number;
  /** 對應的校園 POI ID（如果有的話） */
  poiId?: string;
  /** Emoji 圖示 */
  emoji: string;
  /** 建立時間 */
  createdAt: string;
  /** 使用次數 */
  usageCount: number;
  /** 最近一次使用時間 */
  lastUsedAt: string | null;
};

// ═════════════════════════════════════════════════════
// 預設常用地點（首次使用時 seed）
// ═════════════════════════════════════════════════════

const DEFAULT_PLACES: SavedPlace[] = [
  {
    id: 'default-library',
    kind: 'custom',
    label: '蓋夏圖書館',
    name: '蓋夏圖書館',
    lat: 24.2276,
    lng: 120.56353,
    poiId: 'pu-library',
    emoji: '📚',
    createdAt: new Date().toISOString(),
    usageCount: 0,
    lastUsedAt: null,
  },
  {
    id: 'default-jingyuan',
    kind: 'custom',
    label: '靜園餐廳',
    name: '靜園餐廳',
    lat: 24.2258,
    lng: 120.5648,
    poiId: 'pu-jingyuan',
    emoji: '🍱',
    createdAt: new Date().toISOString(),
    usageCount: 0,
    lastUsedAt: null,
  },
  {
    id: 'default-7eleven',
    kind: 'custom',
    label: '7-ELEVEN',
    name: '靜宜門市 7-ELEVEN',
    lat: 24.22540,
    lng: 120.56560,
    poiId: 'pu-7eleven',
    emoji: '🏪',
    createdAt: new Date().toISOString(),
    usageCount: 0,
    lastUsedAt: null,
  },
];

const KIND_EMOJI: Record<SavedPlaceKind, string> = {
  home: '🏠',
  school: '🎓',
  work: '💼',
  custom: '⭐',
};

const KIND_LABEL: Record<SavedPlaceKind, string> = {
  home: '家',
  school: '學校',
  work: '工作',
  custom: '常去',
};

// ═════════════════════════════════════════════════════
// 純函式 API
// ═════════════════════════════════════════════════════

export async function getAllSavedPlaces(): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PLACES));
      return DEFAULT_PLACES;
    }
    const parsed = JSON.parse(raw) as SavedPlace[];
    return Array.isArray(parsed) ? parsed : DEFAULT_PLACES;
  } catch {
    return DEFAULT_PLACES;
  }
}

export async function getSavedPlace(id: string): Promise<SavedPlace | null> {
  const all = await getAllSavedPlaces();
  return all.find((p) => p.id === id) ?? null;
}

export async function upsertSavedPlace(place: Omit<SavedPlace, 'createdAt' | 'usageCount' | 'lastUsedAt' | 'emoji'> & {
  emoji?: string;
}): Promise<SavedPlace> {
  const all = await getAllSavedPlaces();
  const existing = all.find((p) => p.id === place.id);
  const final: SavedPlace = existing
    ? { ...existing, ...place, emoji: place.emoji ?? existing.emoji ?? KIND_EMOJI[place.kind] }
    : {
        ...place,
        emoji: place.emoji ?? KIND_EMOJI[place.kind],
        createdAt: new Date().toISOString(),
        usageCount: 0,
        lastUsedAt: null,
      };
  const next = existing ? all.map((p) => (p.id === final.id ? final : p)) : [...all, final];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return final;
}

export async function removeSavedPlace(id: string): Promise<void> {
  const all = await getAllSavedPlaces();
  const next = all.filter((p) => p.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function recordPlaceUsage(id: string): Promise<void> {
  const all = await getAllSavedPlaces();
  const next = all.map((p) =>
    p.id === id
      ? { ...p, usageCount: p.usageCount + 1, lastUsedAt: new Date().toISOString() }
      : p,
  );
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * 用 POI 直接建立一個 saved place
 */
export async function savePoi(poiId: string, label?: string): Promise<SavedPlace | null> {
  const poi = getCampusPoi(poiId);
  if (!poi) return null;
  const place: Parameters<typeof upsertSavedPlace>[0] = {
    id: `poi-${poi.id}`,
    kind: 'custom',
    label: label ?? poi.name,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    poiId: poi.id,
    emoji: '⭐',
  };
  return upsertSavedPlace(place);
}

/**
 * 取得排序後（最近用過優先 → 使用次數 → 建立時間）的清單
 */
export async function getRankedSavedPlaces(): Promise<SavedPlace[]> {
  const all = await getAllSavedPlaces();
  return [...all].sort((a, b) => {
    // home / school 永遠優先
    const kindRank = (k: SavedPlaceKind) => (k === 'home' ? 0 : k === 'school' ? 1 : k === 'work' ? 2 : 3);
    const ka = kindRank(a.kind);
    const kb = kindRank(b.kind);
    if (ka !== kb) return ka - kb;
    if (a.lastUsedAt && b.lastUsedAt) {
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    }
    if (a.lastUsedAt) return -1;
    if (b.lastUsedAt) return 1;
    return b.usageCount - a.usageCount;
  });
}

// ═════════════════════════════════════════════════════
// React Hook
// ═════════════════════════════════════════════════════

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await getRankedSavedPlaces();
    setPlaces(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      await removeSavedPlace(id);
      await reload();
    },
    [reload],
  );

  const upsert = useCallback(
    async (place: Parameters<typeof upsertSavedPlace>[0]) => {
      const result = await upsertSavedPlace(place);
      await reload();
      return result;
    },
    [reload],
  );

  const useNow = useCallback(
    async (id: string) => {
      await recordPlaceUsage(id);
      await reload();
    },
    [reload],
  );

  return { places, loading, reload, remove, upsert, useNow };
}

export { KIND_EMOJI, KIND_LABEL };
