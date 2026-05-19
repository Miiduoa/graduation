/* eslint-disable */
/**
 * 儲存地點 — 「家」「學校」「最常去」管理（個人化版）
 *
 * 對應 Google Maps 的「儲存」功能。資料持久化在 AsyncStorage。
 *
 * V2 改動：
 *  - storage key 改為 `@savedPlaces:v2:${uid}`，不同帳號分開
 *  - 預設 seed 不再固定，改為依登入 persona 從 personaContext 取個人化地點
 *  - 沒登入 demo 帳號時退回通用 fallback（不會 crash）
 *
 * 提供 React Hook 與純函式 API 雙介面。
 */

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../state/auth';
import { CAMPUS_POIS, getCampusPoi, type CampusPoi } from '../data/puCampusData';
import { getDemoStory, getPersonaPlaces, type PersonaPlace } from './personaContext';

const STORAGE_PREFIX = '@savedPlaces:v2';

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
// 預設 seed —— 改為依 persona 動態產生
// ═════════════════════════════════════════════════════

function fallbackPlaces(): SavedPlace[] {
  return [
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
  ];
}

function personaPlaceToSaved(p: PersonaPlace): SavedPlace {
  const kind: SavedPlaceKind =
    p.id.startsWith('home-') ? 'home' :
    p.id.startsWith('school-') ? 'school' :
    p.id === 'home-office' ? 'work' :
    'custom';
  return {
    id: p.id,
    kind,
    label: p.label,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    poiId: p.poiId,
    emoji: p.emoji,
    createdAt: new Date().toISOString(),
    usageCount: 0,
    lastUsedAt: null,
  };
}

function seedForUid(uid: string | null): SavedPlace[] {
  const story = getDemoStory(uid);
  if (!story) return fallbackPlaces();
  const places = getPersonaPlaces(story);
  return places.map(personaPlaceToSaved);
}

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
// 純函式 API — 全部接受 uid 參數
// ═════════════════════════════════════════════════════

function storageKey(uid: string | null): string {
  return `${STORAGE_PREFIX}:${uid ?? 'guest'}`;
}

export async function getAllSavedPlaces(uid: string | null): Promise<SavedPlace[]> {
  const key = storageKey(uid);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      const seed = seedForUid(uid);
      await AsyncStorage.setItem(key, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as SavedPlace[];
    return Array.isArray(parsed) ? parsed : seedForUid(uid);
  } catch {
    return seedForUid(uid);
  }
}

export async function getSavedPlace(uid: string | null, id: string): Promise<SavedPlace | null> {
  const all = await getAllSavedPlaces(uid);
  return all.find((p) => p.id === id) ?? null;
}

export async function upsertSavedPlace(
  uid: string | null,
  place: Omit<SavedPlace, 'createdAt' | 'usageCount' | 'lastUsedAt' | 'emoji'> & { emoji?: string },
): Promise<SavedPlace> {
  const all = await getAllSavedPlaces(uid);
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
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(next));
  return final;
}

export async function removeSavedPlace(uid: string | null, id: string): Promise<void> {
  const all = await getAllSavedPlaces(uid);
  const next = all.filter((p) => p.id !== id);
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(next));
}

export async function recordPlaceUsage(uid: string | null, id: string): Promise<void> {
  const all = await getAllSavedPlaces(uid);
  const next = all.map((p) =>
    p.id === id
      ? { ...p, usageCount: p.usageCount + 1, lastUsedAt: new Date().toISOString() }
      : p,
  );
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(next));
}

/**
 * 用 POI 直接建立一個 saved place
 */
export async function savePoi(uid: string | null, poiId: string, label?: string): Promise<SavedPlace | null> {
  const poi = getCampusPoi(poiId);
  if (!poi) return null;
  const place: Parameters<typeof upsertSavedPlace>[1] = {
    id: `poi-${poi.id}`,
    kind: 'custom',
    label: label ?? poi.name,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    poiId: poi.id,
    emoji: '⭐',
  };
  return upsertSavedPlace(uid, place);
}

/**
 * 取得排序後（家/學校/工作優先 → 最近用過 → 使用次數）的清單
 */
export async function getRankedSavedPlaces(uid: string | null): Promise<SavedPlace[]> {
  const all = await getAllSavedPlaces(uid);
  return [...all].sort((a, b) => {
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
// React Hook — 內部抓 uid，畫面不用煩
// ═════════════════════════════════════════════════════

export function useSavedPlaces() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await getRankedSavedPlaces(uid);
    setPlaces(list);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      await removeSavedPlace(uid, id);
      await reload();
    },
    [uid, reload],
  );

  const upsert = useCallback(
    async (place: Parameters<typeof upsertSavedPlace>[1]) => {
      const result = await upsertSavedPlace(uid, place);
      await reload();
      return result;
    },
    [uid, reload],
  );

  const useNow = useCallback(
    async (id: string) => {
      await recordPlaceUsage(uid, id);
      await reload();
    },
    [uid, reload],
  );

  return { uid, places, loading, reload, remove, upsert, useNow };
}

export { KIND_EMOJI, KIND_LABEL };
