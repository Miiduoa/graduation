/* eslint-disable */
/**
 * 離線地圖快取
 *
 * 把指定範圍的 OSM tile（標準圖層）預載到 expo-file-system，
 * 之後 Leaflet WebView 可以走 cache://（透過 RNWebView 的本地檔協定）。
 *
 * 簡化策略（demo 用）：
 *   - 預設範圍 = 校園 bbox + persona 個人興趣點 500m
 *   - zoom levels 15, 16, 17, 18
 *   - 每張 tile 約 12-20KB，全部約 80-300 tile，整包 < 5MB
 *
 * 對外 API:
 *   - downloadOfflinePack(opts, onProgress): 啟動下載
 *   - clearCache(): 清除
 *   - getCacheInfo(): 大小 / 是否已下載
 *   - useOfflinePack(): React hook 提供狀態
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Paths, File, Directory } from 'expo-file-system';
import { CAMPUS_BUS_ROUTES, type LatLng } from '../data/campusBusRoutes';
import { CAMPUS_POIS } from '../data/puCampusData';

const META_KEY = '@offlineCache:v1:meta';

// 校園 bbox (大致涵蓋整個靜宜校園)
const CAMPUS_BBOX = {
  north: 24.2305,
  south: 24.2235,
  west: 120.5615,
  east: 120.5685,
};

const TILE_DIR_NAME = 'osm_tiles';

export type OfflinePackMeta = {
  downloadedAt: string;
  /** tile 總數 */
  tileCount: number;
  /** 約略大小（bytes） */
  bytes: number;
  /** 涵蓋區域描述 */
  area: string;
  /** persona uid 標籤（不同帳號可以維護不同 pack） */
  personaUid: string | null;
};

export type DownloadProgress = {
  done: number;
  total: number;
  /** 0..1 */
  ratio: number;
  /** 當前下載中的 tile */
  current?: string;
  status: 'idle' | 'downloading' | 'done' | 'error';
  message?: string;
};

// ═════════════════════════════════════════════════════════
// Tile 計算
// ═════════════════════════════════════════════════════════

function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      n,
  );
  return { x, y };
}

function bboxToTiles(
  bbox: { north: number; south: number; west: number; east: number },
  z: number,
): { x: number; y: number; z: number }[] {
  const min = lonLatToTile(bbox.west, bbox.north, z);
  const max = lonLatToTile(bbox.east, bbox.south, z);
  const xMin = Math.min(min.x, max.x);
  const xMax = Math.max(min.x, max.x);
  const yMin = Math.min(min.y, max.y);
  const yMax = Math.max(min.y, max.y);
  const out: { x: number; y: number; z: number }[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push({ x, y, z });
    }
  }
  return out;
}

function pointToBbox(lat: number, lng: number, deltaM: number) {
  // 1 度 ~ 111 km
  const dLat = deltaM / 111000;
  const dLng = deltaM / (111000 * Math.cos((lat * Math.PI) / 180));
  return {
    north: lat + dLat,
    south: lat - dLat,
    east: lng + dLng,
    west: lng - dLng,
  };
}

// ═════════════════════════════════════════════════════════
// 檔案系統 helpers
// ═════════════════════════════════════════════════════════

function tilesDir(): Directory {
  const dir = new Directory(Paths.cache, TILE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function tileFile(z: number, x: number, y: number): File {
  return new File(tilesDir(), `${z}_${x}_${y}.png`);
}

function tileUrl(z: number, x: number, y: number): string {
  // 用 CartoDB Voyager（同我們地圖頁主要圖層）
  return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}

// ═════════════════════════════════════════════════════════
// Meta 管理
// ═════════════════════════════════════════════════════════

export async function getOfflinePackMeta(): Promise<OfflinePackMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OfflinePackMeta;
  } catch {
    return null;
  }
}

export async function setOfflinePackMeta(meta: OfflinePackMeta | null): Promise<void> {
  if (meta === null) {
    await AsyncStorage.removeItem(META_KEY);
  } else {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  }
}

// ═════════════════════════════════════════════════════════
// 下載 / 清除
// ═════════════════════════════════════════════════════════

export type DownloadOpts = {
  /** 額外個人興趣點 — 會在這些點周圍 500m 也快取 */
  extraPoints?: LatLng[];
  /** 涵蓋區域描述（如 "校園 + 顧晉瑋常用路線"） */
  areaLabel?: string;
  /** persona uid 標籤 */
  personaUid?: string | null;
};

export async function downloadOfflinePack(
  opts: DownloadOpts,
  onProgress?: (p: DownloadProgress) => void,
): Promise<OfflinePackMeta> {
  // 收集所有要下載的 tile
  const tileSet = new Map<string, { z: number; x: number; y: number }>();

  // 校園範圍
  for (const z of [15, 16, 17, 18]) {
    for (const t of bboxToTiles(CAMPUS_BBOX, z)) {
      tileSet.set(`${t.z}/${t.x}/${t.y}`, t);
    }
  }

  // persona 興趣點周圍 500m
  for (const p of opts.extraPoints ?? []) {
    const bbox = pointToBbox(p.lat, p.lng, 500);
    for (const z of [16, 17, 18]) {
      for (const t of bboxToTiles(bbox, z)) {
        tileSet.set(`${t.z}/${t.x}/${t.y}`, t);
      }
    }
  }

  const tiles = Array.from(tileSet.values());
  const total = tiles.length;
  let done = 0;
  let bytes = 0;
  let errCount = 0;

  onProgress?.({ done: 0, total, ratio: 0, status: 'downloading', message: '準備中...' });

  // 並行控制（一次 5 個）
  const concurrency = 5;
  for (let i = 0; i < tiles.length; i += concurrency) {
    const batch = tiles.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (t) => {
        const f = tileFile(t.z, t.x, t.y);
        if (f.exists) {
          done += 1;
          try {
            bytes += f.size ?? 0;
          } catch {}
          onProgress?.({
            done,
            total,
            ratio: done / total,
            status: 'downloading',
            current: `${t.z}/${t.x}/${t.y}`,
            message: `已快取 ${done}/${total}`,
          });
          return;
        }
        try {
          const url = tileUrl(t.z, t.x, t.y);
          await File.downloadFileAsync(url, f);
          done += 1;
          try {
            bytes += f.size ?? 0;
          } catch {}
        } catch (e) {
          errCount += 1;
          done += 1;
        }
        onProgress?.({
          done,
          total,
          ratio: done / total,
          status: 'downloading',
          current: `${t.z}/${t.x}/${t.y}`,
          message: `已下載 ${done}/${total}（失敗 ${errCount}）`,
        });
      }),
    );
  }

  const meta: OfflinePackMeta = {
    downloadedAt: new Date().toISOString(),
    tileCount: total,
    bytes,
    area: opts.areaLabel ?? '校園範圍',
    personaUid: opts.personaUid ?? null,
  };
  await setOfflinePackMeta(meta);

  onProgress?.({
    done: total,
    total,
    ratio: 1,
    status: 'done',
    message: `完成 · ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  });

  return meta;
}

export async function clearCache(): Promise<void> {
  try {
    const dir = tilesDir();
    if (dir.exists) dir.delete();
  } catch (e) {}
  await setOfflinePackMeta(null);
}

export async function getCacheInfo(): Promise<{
  exists: boolean;
  tileCount: number;
  bytes: number;
  meta: OfflinePackMeta | null;
}> {
  const meta = await getOfflinePackMeta();
  let tileCount = 0;
  let bytes = 0;
  try {
    const dir = tilesDir();
    if (dir.exists) {
      const entries = dir.list();
      tileCount = entries.length;
      for (const e of entries) {
        try {
          if (e instanceof File) {
            bytes += e.size ?? 0;
          }
        } catch {}
      }
    }
  } catch {}
  return { exists: tileCount > 0, tileCount, bytes, meta };
}

// ═════════════════════════════════════════════════════════
// React Hook
// ═════════════════════════════════════════════════════════

export function useOfflinePack() {
  const [progress, setProgress] = useState<DownloadProgress>({
    done: 0,
    total: 0,
    ratio: 0,
    status: 'idle',
  });
  const [info, setInfo] = useState<{
    exists: boolean;
    tileCount: number;
    bytes: number;
    meta: OfflinePackMeta | null;
  }>({ exists: false, tileCount: 0, bytes: 0, meta: null });

  const reload = useCallback(async () => {
    setInfo(await getCacheInfo());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const start = useCallback(
    async (opts: DownloadOpts) => {
      await downloadOfflinePack(opts, setProgress);
      await reload();
    },
    [reload],
  );

  const clear = useCallback(async () => {
    await clearCache();
    setProgress({ done: 0, total: 0, ratio: 0, status: 'idle' });
    await reload();
  }, [reload]);

  return { progress, info, start, clear, reload };
}

// ═════════════════════════════════════════════════════════
// 從 persona 推算 extraPoints
// ═════════════════════════════════════════════════════════

export function getPersonaExtraPoints(homeLat?: number, homeLng?: number): LatLng[] {
  const out: LatLng[] = [];
  if (homeLat && homeLng) out.push({ lat: homeLat, lng: homeLng });
  // 加入幾條訂閱路線的起終點站
  for (const r of CAMPUS_BUS_ROUTES.slice(0, 3)) {
    if (r.stops[0]) out.push({ lat: r.stops[0].lat, lng: r.stops[0].lng });
    const last = r.stops[r.stops.length - 1];
    if (last) out.push({ lat: last.lat, lng: last.lng });
  }
  return out;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
