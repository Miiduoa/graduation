import { materialFailureMessage, readMaterialWithDeadline } from './materialAccess';
import { NuniError, type NuniMaterial, type NuniMaterialPage } from './nuni';

export type MaterialBookmark = {
  courseId: string;
  materialId: string;
  savedAt: string;
};
type MaterialIdentity = Pick<MaterialBookmark, 'courseId' | 'materialId'>;
export type MaterialBookmarkSnapshot = {
  items: MaterialBookmark[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  pending: string[];
};
export const EMPTY_MATERIAL_BOOKMARKS: MaterialBookmarkSnapshot = {
  items: [], loading: false, ready: false, error: null, pending: [],
};
export const MATERIAL_BOOKMARK_LIMIT = 500;
const CORRUPT_MESSAGE = '此裝置的收藏資料無法讀取。請重試；原有資料會保留。';
const READ_MESSAGE = '無法讀取此裝置收藏。請確認裝置儲存空間或瀏覽器設定，再重試。';
const WRITE_MESSAGE = '收藏未儲存。請確認裝置儲存空間或瀏覽器設定，再試一次。';

export function materialBookmarkId(item: MaterialIdentity): string {
  return JSON.stringify([item.courseId, item.materialId]);
}

export function materialBookmarkStorageKey(accountId: string): string {
  return `nuni-material-bookmarks:v1:${encodeURIComponent(accountId)}`;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseMaterialBookmarks(raw: string | null): MaterialBookmark[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('items' in value) || !Array.isArray(value.items)) throw new Error();
    const unique = new Map<string, MaterialBookmark>();
    for (const item of value.items) {
      if (!item || typeof item !== 'object' || !validId(item.courseId) || !validId(item.materialId) ||
        typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt))) throw new Error();
      const bookmark = { courseId: item.courseId, materialId: item.materialId, savedAt: item.savedAt };
      const key = materialBookmarkId(bookmark);
      const previous = unique.get(key);
      if (!previous || Date.parse(previous.savedAt) < Date.parse(bookmark.savedAt)) unique.set(key, bookmark);
    }
    return [...unique.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  } catch {
    throw new Error(CORRUPT_MESSAGE);
  }
}

export function updateMaterialBookmarks(
  items: MaterialBookmark[], item: MaterialIdentity, saved: boolean, now = new Date().toISOString(),
): MaterialBookmark[] {
  if (!validId(item.courseId) || !validId(item.materialId) || !Number.isFinite(Date.parse(now))) {
    throw new Error('教材資料不完整，請重新開啟課程後再收藏。');
  }
  const key = materialBookmarkId(item);
  if (saved && items.some((entry) => materialBookmarkId(entry) === key)) return items;
  if (saved && items.length >= MATERIAL_BOOKMARK_LIMIT) {
    throw new Error('此裝置已收藏 500 份教材。請先移除不需要的收藏，再加入這份教材。');
  }
  const next = items.filter((entry) => materialBookmarkId(entry) !== key);
  if (saved) next.push({ courseId: item.courseId, materialId: item.materialId, savedAt: now });
  return next.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

type BookmarkStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  withLock?<T>(key: string, operation: () => Promise<T>): Promise<T>;
};

export function createMaterialBookmarkStore(storage: BookmarkStorage) {
  const snapshots = new Map<string, MaterialBookmarkSnapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const queues = new Map<string, Promise<unknown>>();
  const loads = new Map<string, Promise<void>>();
  const getSnapshot = (accountId: string) => snapshots.get(accountId) ?? EMPTY_MATERIAL_BOOKMARKS;
  function publish(accountId: string, patch: Partial<MaterialBookmarkSnapshot>) {
    snapshots.set(accountId, { ...getSnapshot(accountId), ...patch });
    listeners.get(accountId)?.forEach((listener) => listener());
  }
  function enqueue<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(accountId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    queues.set(accountId, current);
    void current.finally(() => {
      if (queues.get(accountId) === current) queues.delete(accountId);
    }).catch(() => undefined);
    return current;
  }
  async function read(accountId: string) {
    let raw: string | null;
    try {
      raw = await storage.getItem(materialBookmarkStorageKey(accountId));
    } catch {
      throw new Error(READ_MESSAGE);
    }
    return parseMaterialBookmarks(raw);
  }
  function load(accountId: string): Promise<void> {
    if (!validId(accountId)) return Promise.resolve();
    const existing = loads.get(accountId);
    if (existing) return existing;
    publish(accountId, { loading: true, error: null });
    const operation = enqueue(accountId, async () => {
      try {
        publish(accountId, { items: await read(accountId), ready: true, error: null });
      } catch (failure) {
        publish(accountId, { items: [], ready: false, error: failure instanceof Error ? failure.message : READ_MESSAGE });
      } finally {
        publish(accountId, { loading: false });
      }
    });
    loads.set(accountId, operation);
    void operation.finally(() => loads.delete(accountId));
    return operation;
  }
  async function setBookmark(accountId: string, courseId: string, materialId: string, saved: boolean): Promise<boolean> {
    if (!validId(accountId)) return false;
    const key = materialBookmarkId({ courseId, materialId });
    if (getSnapshot(accountId).pending.includes(key)) return false;
    publish(accountId, { pending: [...getSnapshot(accountId).pending, key], error: null });
    return enqueue(accountId, async () => {
      const operation = async () => {
        let previous: MaterialBookmark[];
        try {
          previous = await read(accountId);
        } catch (failure) {
          publish(accountId, { items: [], ready: false, error: failure instanceof Error ? failure.message : READ_MESSAGE });
          return false;
        }
        try {
          const next = updateMaterialBookmarks(previous, { courseId, materialId }, saved);
          try {
            await storage.setItem(materialBookmarkStorageKey(accountId), JSON.stringify({ version: 1, items: next }));
          } catch {
            throw new Error(WRITE_MESSAGE);
          }
          publish(accountId, { items: next, ready: true, error: null });
          return true;
        } catch (failure) {
          publish(accountId, { items: previous, ready: true, error: failure instanceof Error ? failure.message : WRITE_MESSAGE });
          return false;
        }
      };
      try {
        return await (storage.withLock ? storage.withLock(materialBookmarkStorageKey(accountId), operation) : operation());
      } catch {
        publish(accountId, { error: WRITE_MESSAGE });
        return false;
      } finally {
        publish(accountId, { pending: getSnapshot(accountId).pending.filter((item) => item !== key) });
      }
    });
  }
  return {
    getSnapshot, load, setBookmark,
    subscribe(accountId: string, listener: () => void) {
      const group = listeners.get(accountId) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(accountId, group);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(accountId);
      };
    },
  };
}

export type MaterialBookmarkResolution =
  | { status: 'available'; material: NuniMaterial }
  | { status: 'unavailable' | 'error'; message: string }
  | { status: 'cancelled' };

type MaterialPages = {
  materialsPage(courseId: string, pageToken?: string): Promise<NuniMaterialPage>;
};

/** One list validation batch only. Never reuse this reader to authorize opening a material. */
export function createMaterialBookmarkBatchResolver(classes: MaterialPages) {
  const pages = new Map<string, Promise<NuniMaterialPage>>();
  const readPage: MaterialPages['materialsPage'] = (courseId, pageToken) => {
    const key = JSON.stringify([courseId, pageToken ?? null]);
    let page = pages.get(key);
    if (!page) {
      // Share pending reads and their failures too; one cancelled row must not cancel its peers.
      page = Promise.resolve().then(() => readMaterialWithDeadline(classes.materialsPage(courseId, pageToken)));
      pages.set(key, page);
    }
    return page;
  };
  return (bookmark: MaterialIdentity, cancelled: () => boolean = () => false) =>
    resolveBookmark(readPage, bookmark, cancelled);
}

export function resolveMaterialBookmark(
  classes: MaterialPages,
  bookmark: MaterialIdentity,
  cancelled: () => boolean = () => false,
): Promise<MaterialBookmarkResolution> {
  return resolveBookmark(
    (courseId, pageToken) => readMaterialWithDeadline(classes.materialsPage(courseId, pageToken)),
    bookmark, cancelled,
  );
}

async function resolveBookmark(
  readPage: MaterialPages['materialsPage'],
  bookmark: MaterialIdentity,
  cancelled: () => boolean,
): Promise<MaterialBookmarkResolution> {
  const seen = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      if (cancelled()) return { status: 'cancelled' };
      const page = await readPage(bookmark.courseId, pageToken);
      if (cancelled()) return { status: 'cancelled' };
      const material = page.materials.find((item) => item.id === bookmark.materialId && item.workspaceId === bookmark.courseId);
      if (material) return { status: 'available', material };
      if (page.nextCursor === null) return {
        status: 'unavailable', message: '這份教材已不存在。可以移除收藏，或回課程找更新後的版本。',
      };
      if (seen.has(page.nextCursor) || page.nextCursor === pageToken) break;
      seen.add(page.nextCursor);
      pageToken = page.nextCursor;
    }
    return { status: 'error', message: '教材清單尚未讀完，還不能確認這份教材。請重試，或回課程查看。' };
  } catch (failure) {
    if (cancelled()) return { status: 'cancelled' };
    const unavailable = failure instanceof NuniError && [401, 403, 404, 410].includes(failure.status);
    return { status: unavailable ? 'unavailable' : 'error', message: materialFailureMessage(failure) };
  }
}
