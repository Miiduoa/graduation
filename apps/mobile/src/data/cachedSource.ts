import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DataSource } from "./source";
import type { Announcement, ClubEvent, MenuItem, Poi } from "./types";

const CACHE_PREFIX = "campus.cache.v1";
const DEFAULT_TTL_MS = 1000 * 60 * 30; // 30 minutes

type CachePayload<T> = {
  updatedAt: number;
  data: T[];
};

function buildKey(kind: string, schoolId?: string | null) {
  const sid = (schoolId ?? "all").toString();
  return `${CACHE_PREFIX}.${kind}.${sid}`;
}

async function readCache<T>(key: string, ttlMs = DEFAULT_TTL_MS): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload<T>;
    if (!parsed?.updatedAt || !Array.isArray(parsed.data)) return null;
    const age = Date.now() - parsed.updatedAt;
    if (age > ttlMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T[]) {
  try {
    const payload: CachePayload<T> = { updatedAt: Date.now(), data };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

async function withCache<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  try {
    const data = await fetcher();
    if (Array.isArray(data)) await writeCache<T>(key, data);
    return data;
  } catch (err) {
    const cached = await readCache<T>(key);
    if (cached) return cached;
    throw err;
  }
}

export function createCachedSource(inner: DataSource): DataSource {
  return {
    async listAnnouncements(schoolId) {
      const key = buildKey("announcements", schoolId);
      return withCache<Announcement>(key, () => inner.listAnnouncements(schoolId));
    },
    async listEvents(schoolId) {
      const key = buildKey("events", schoolId);
      return withCache<ClubEvent>(key, () => inner.listEvents(schoolId));
    },
    async listPois(schoolId) {
      const key = buildKey("pois", schoolId);
      return withCache<Poi>(key, () => inner.listPois(schoolId));
    },
    async listMenus(schoolId) {
      const key = buildKey("menus", schoolId);
      return withCache<MenuItem>(key, () => inner.listMenus(schoolId));
    },
  };
}
