import { getDataSource } from "../data/source";
import { getCacheSize } from "../data/cachedSource";

export type CacheWarmingConfig = {
  schoolId: string;
  priority?: "high" | "normal" | "low";
  maxConcurrent?: number;
  onProgress?: (completed: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error, resource: string) => void;
};

export type CacheWarmingResult = {
  success: boolean;
  warmedResources: string[];
  failedResources: string[];
  duration: number;
};

const HIGH_PRIORITY_RESOURCES = [
  "announcements",
  "events",
  "menu",
];

const NORMAL_PRIORITY_RESOURCES = [
  "pois",
  "courses",
];

const LOW_PRIORITY_RESOURCES = [
  "clubs",
  "library",
];

export async function warmCache(config: CacheWarmingConfig): Promise<CacheWarmingResult> {
  const {
    schoolId,
    priority = "normal",
    maxConcurrent = 3,
    onProgress,
    onComplete,
    onError,
  } = config;

  const startTime = Date.now();
  const warmedResources: string[] = [];
  const failedResources: string[] = [];

  let resources: string[];
  switch (priority) {
    case "high":
      resources = HIGH_PRIORITY_RESOURCES;
      break;
    case "normal":
      resources = [...HIGH_PRIORITY_RESOURCES, ...NORMAL_PRIORITY_RESOURCES];
      break;
    case "low":
      resources = [...HIGH_PRIORITY_RESOURCES, ...NORMAL_PRIORITY_RESOURCES, ...LOW_PRIORITY_RESOURCES];
      break;
  }

  const ds = getDataSource();
  const total = resources.length;
  let completed = 0;

  const fetchResource = async (resource: string): Promise<void> => {
    try {
      switch (resource) {
        case "announcements":
          await ds.listAnnouncements(schoolId);
          break;
        case "events":
          await ds.listEvents(schoolId);
          break;
        case "menu":
          await ds.listMenus(schoolId);
          break;
        case "pois":
          await ds.listPois(schoolId);
          break;
        case "courses":
          await ds.listCourses(schoolId);
          break;
        default:
          console.warn(`[CacheWarming] 未知的資源類型: ${resource}`);
          return;
      }
      warmedResources.push(resource);
    } catch (error) {
      failedResources.push(resource);
      onError?.(error instanceof Error ? error : new Error(String(error)), resource);
    } finally {
      completed++;
      onProgress?.(completed, total);
    }
  };

  const chunks: string[][] = [];
  for (let i = 0; i < resources.length; i += maxConcurrent) {
    chunks.push(resources.slice(i, i + maxConcurrent));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(fetchResource));
  }

  onComplete?.();

  return {
    success: failedResources.length === 0,
    warmedResources,
    failedResources,
    duration: Date.now() - startTime,
  };
}

export async function shouldWarmCache(): Promise<boolean> {
  const cacheInfo = await getCacheSize();
  return cacheInfo.count < 3;
}

export async function getCacheStatus(): Promise<{
  size: number;
  count: number;
  isWarmed: boolean;
  lastWarmedAt?: number;
}> {
  const cacheInfo = await getCacheSize();
  
  return {
    size: cacheInfo.approximateBytes,
    count: cacheInfo.count,
    isWarmed: cacheInfo.count >= 3,
    lastWarmedAt: undefined,
  };
}

let isWarmingInProgress = false;
let warmingPromise: Promise<CacheWarmingResult> | null = null;

export async function warmCacheIfNeeded(schoolId: string): Promise<CacheWarmingResult | null> {
  if (isWarmingInProgress && warmingPromise) {
    return warmingPromise;
  }

  const shouldWarm = await shouldWarmCache();
  if (!shouldWarm) {
    return null;
  }

  isWarmingInProgress = true;
  
  warmingPromise = warmCache({
    schoolId,
    priority: "high",
    onComplete: () => {
      isWarmingInProgress = false;
      warmingPromise = null;
    },
    onError: (error, resource) => {
      console.warn(`[CacheWarming] 預熱 ${resource} 失敗:`, error.message);
    },
  });

  return warmingPromise;
}

export function cancelCacheWarming(): void {
  isWarmingInProgress = false;
  warmingPromise = null;
}
