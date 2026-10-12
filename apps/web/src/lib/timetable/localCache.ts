export const TIMETABLE_CACHE_PREFIX = 'campus-one-personal-timetable';

export type CacheValue = {
  schoolId: string;
  courses: unknown[];
  updatedAt: string;
};

export type TimetableCache<T extends CacheValue = CacheValue> = {
  version: 2;
  revision: string;
  pending: boolean;
  value: T;
};

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export class TimetableLocalReadError extends Error {
  constructor(readonly reason: 'unavailable' | 'invalid', readonly cause?: unknown) {
    super(reason === 'invalid' ? '本機課表格式異常，原始資料已保留。' : '目前無法讀取這台瀏覽器的課表。');
    this.name = 'TimetableLocalReadError';
  }
}

export function timetableCacheKey(uid: string | null, schoolId: string): string {
  return `${TIMETABLE_CACHE_PREFIX}:v2:${JSON.stringify([uid, schoolId])}`;
}

function isCacheValue(value: unknown): value is CacheValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CacheValue>;
  return typeof item.schoolId === 'string' && item.schoolId.length > 0 &&
    Array.isArray(item.courses) && typeof item.updatedAt === 'string' &&
    Number.isFinite(Date.parse(item.updatedAt));
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new TimetableLocalReadError('invalid', error);
  }
}

export function readTimetableCache(
  storage: StorageAccess,
  uid: string | null,
  schoolId: string,
): TimetableCache | null {
  let raw: string | null;
  try {
    raw = storage.getItem(timetableCacheKey(uid, schoolId));
  } catch (error) {
    throw new TimetableLocalReadError('unavailable', error);
  }
  if (raw !== null) {
    const parsed = parse(raw) as Partial<TimetableCache> | null;
    if (!parsed || parsed.version !== 2 || typeof parsed.revision !== 'string' ||
      !parsed.revision || typeof parsed.pending !== 'boolean' ||
      !isCacheValue(parsed.value) || parsed.value.schoolId !== schoolId) {
      throw new TimetableLocalReadError('invalid');
    }
    return parsed as TimetableCache;
  }

  // 舊格式沒有校園分區，只接回已明確標記為目前校園的資料，不刪除原檔。
  // 舊訪客鍵與 uid="local" 無法區分，該帳號不可認領舊訪客資料。
  if (uid === 'local') return null;
  try {
    raw = storage.getItem(`${TIMETABLE_CACHE_PREFIX}:${uid || 'local'}`);
  } catch (error) {
    throw new TimetableLocalReadError('unavailable', error);
  }
  if (raw === null) return null;
  const value = parse(raw);
  if (!isCacheValue(value)) throw new TimetableLocalReadError('invalid');
  if (value.schoolId !== schoolId) return null;
  return { version: 2, revision: `legacy:${value.updatedAt}`, pending: false, value };
}

export function writeTimetableCache<T extends CacheValue>(
  storage: StorageAccess,
  uid: string | null,
  copy: TimetableCache<T>,
): void {
  storage.setItem(timetableCacheKey(uid, copy.value.schoolId), JSON.stringify(copy));
}

export function acknowledgeTimetableCache(
  storage: StorageAccess,
  uid: string,
  schoolId: string,
  revision: string,
): boolean {
  const latest = readTimetableCache(storage, uid, schoolId);
  // 舊請求的成功回覆不能把之後的修改標記成已同步。
  if (!latest || latest.revision !== revision) return false;
  writeTimetableCache(storage, uid, { ...latest, pending: false });
  return true;
}

export function preferLocalTimetable(copy: TimetableCache | null, cloudUpdatedAt: number): boolean {
  return !!copy && (copy.pending || Date.parse(copy.value.updatedAt) > cloudUpdatedAt);
}
