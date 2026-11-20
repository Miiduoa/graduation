import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniMaterialPage } from '@campus/shared/src/nuni';
import {
  createMaterialBookmarkBatchResolver,
  createMaterialBookmarkStore,
  materialBookmarkId,
  materialBookmarkStorageKey,
  parseMaterialBookmarks,
  resolveMaterialBookmark,
  updateMaterialBookmarks,
  type MaterialBookmark,
} from '@campus/shared/src/materialBookmarks';

const account = 'pa_student';
const otherAccount = 'pa_teacher';
const first = { courseId: 'cw_database', materialId: 'cwm_relations' };
const second = { courseId: 'cw_design', materialId: 'cwm_sketches' };
const earlier = '2026-10-31T08:00:00.000Z';
const later = '2026-11-01T08:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function memoryStorage(initial: MaterialBookmark[] = []) {
  const values = new Map<string, string>();
  if (initial.length) {
    values.set(materialBookmarkStorageKey(account), JSON.stringify({ version: 1, items: initial }));
  }
  return {
    values,
    getItem: vi.fn((key: string): string | null => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string): void => { values.set(key, value); }),
  };
}

function material(changes: Partial<NuniMaterial> = {}): NuniMaterial {
  return {
    id: first.materialId,
    workspaceId: first.courseId,
    title: '關聯與主鍵',
    body: '這是重新驗證後讀取的教材內容。',
    unitId: null,
    unitTitle: null,
    createdByPlatformAccountId: 'pa_teacher',
    createdAt: earlier,
    ...changes,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('此裝置教材收藏資料', () => {
  it('以課程與教材的完整組合識別收藏，避免分隔符碰撞', () => {
    expect(materialBookmarkId(first)).toBe(JSON.stringify([first.courseId, first.materialId]));
    expect(materialBookmarkId({ courseId: 'a:b', materialId: 'c' }))
      .not.toBe(materialBookmarkId({ courseId: 'a', materialId: 'b:c' }));
    expect(materialBookmarkId(first)).not.toBe(materialBookmarkId({ ...first, courseId: second.courseId }));
  });

  it('收藏新增排在最前面，重複收藏不改時間，移除保留其他課程的同名教材', () => {
    const original = [{ ...first, savedAt: earlier }];
    const added = updateMaterialBookmarks(original, second, true, later);
    expect(added).toEqual([{ ...second, savedAt: later }, ...original]);
    expect(updateMaterialBookmarks(added, first, true, later)).toEqual(added);
    const sameId = { ...first, courseId: second.courseId };
    const newest = '2026-11-01T09:00:00.000Z';
    const withSameId = updateMaterialBookmarks(added, sameId, true, newest);
    expect(updateMaterialBookmarks(withSameId, first, false)).toEqual([
      { ...sameId, savedAt: newest }, { ...second, savedAt: later },
    ]);
    expect(original).toEqual([{ ...first, savedAt: earlier }]);
  });

  it('讀取空儲存或有效版本資料，並依收藏時間由新到舊排列', () => {
    expect(parseMaterialBookmarks(null)).toEqual([]);
    expect(parseMaterialBookmarks(JSON.stringify({ version: 1, items: [
      { ...first, savedAt: earlier }, { ...second, savedAt: later },
    ] }))).toEqual([{ ...second, savedAt: later }, { ...first, savedAt: earlier }]);
  });

  it.each([
    '{broken',
    JSON.stringify([]),
    JSON.stringify({ version: 2, items: [] }),
    JSON.stringify({ version: 1, items: [{ ...first, savedAt: '昨天' }] }),
    JSON.stringify({ version: 1, items: [{ courseId: '', materialId: 'm', savedAt: earlier }] }),
  ])('損壞或不支援的儲存資料不視為空清單：%s', (raw) => {
    expect(() => parseMaterialBookmarks(raw)).toThrow();
  });

  it('帳號儲存鍵分區且完整編碼，不與已讀或社群收藏共用', () => {
    expect(materialBookmarkStorageKey('pa/a:b')).toBe('nuni-material-bookmarks:v1:pa%2Fa%3Ab');
    expect(materialBookmarkStorageKey(account)).not.toBe(materialBookmarkStorageKey(otherAccount));
  });
});

describe('此裝置教材收藏儲存', () => {
  it('重新建立儲存器後找回教材，寫入僅含課程、教材與收藏時間', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(later);
    const storage = memoryStorage();
    const store = createMaterialBookmarkStore(storage);
    expect(await store.setBookmark(account, first.courseId, first.materialId, true)).toBe(true);
    const written = JSON.parse(storage.values.get(materialBookmarkStorageKey(account))!);
    expect(written).toEqual({ version: 1, items: [{ ...first, savedAt: later }] });
    const reopened = createMaterialBookmarkStore(storage);
    await reopened.load(account);
    expect(reopened.getSnapshot(account)).toMatchObject({
      items: [{ ...first, savedAt: later }], ready: true, loading: false, error: null, pending: [],
    });
  });

  it('切換帳號與重新開啟皆不會看到另一帳號的收藏', async () => {
    const storage = memoryStorage();
    const store = createMaterialBookmarkStore(storage);
    await store.setBookmark(account, first.courseId, first.materialId, true);
    await store.load(otherAccount);
    expect(store.getSnapshot(otherAccount).items).toEqual([]);
    await store.setBookmark(otherAccount, second.courseId, second.materialId, true);
    expect(store.getSnapshot(account).items.map(materialBookmarkId)).toEqual([materialBookmarkId(first)]);
    const reopened = createMaterialBookmarkStore(storage);
    await Promise.all([reopened.load(account), reopened.load(otherAccount)]);
    expect(reopened.getSnapshot(account).items.map(materialBookmarkId)).toEqual([materialBookmarkId(first)]);
    expect(reopened.getSnapshot(otherAccount).items.map(materialBookmarkId)).toEqual([materialBookmarkId(second)]);
  });

  it('點擊立刻提供處理狀態，持久化成功前不顯示已收藏', async () => {
    const write = deferred<void>();
    const storage = memoryStorage();
    const store = createMaterialBookmarkStore({ ...storage, setItem: vi.fn(() => write.promise) });
    await store.load(account);
    const saving = store.setBookmark(account, first.courseId, first.materialId, true);
    await vi.waitFor(() => expect(store.getSnapshot(account).pending).toContain(materialBookmarkId(first)));
    expect(store.getSnapshot(account).items).toEqual([]);
    write.resolve();
    expect(await saving).toBe(true);
    expect(store.getSnapshot(account).items.map(materialBookmarkId)).toEqual([materialBookmarkId(first)]);
    expect(store.getSnapshot(account).pending).toEqual([]);
  });

  it('同帳號重疊新增與移除依序保存，不覆蓋另一筆收藏', async () => {
    const firstWrite = deferred<void>();
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    const write = vi.fn(async (key: string, value: string) => {
      if (write.mock.calls.length === 1) await firstWrite.promise;
      storage.values.set(key, value);
    });
    const store = createMaterialBookmarkStore({ ...storage, setItem: write });
    await store.load(account);
    const saves = [
      store.setBookmark(account, second.courseId, second.materialId, true),
      store.setBookmark(account, first.courseId, first.materialId, false),
    ];
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    firstWrite.resolve();
    expect(await Promise.all(saves)).toEqual([true, true]);
    expect(store.getSnapshot(account).items.map(materialBookmarkId)).toEqual([materialBookmarkId(second)]);
    expect(parseMaterialBookmarks(storage.values.get(materialBookmarkStorageKey(account))!).map(materialBookmarkId))
      .toEqual([materialBookmarkId(second)]);
  });

  it('同一教材儲存中不重複提交，並明確回傳未完成', async () => {
    const write = deferred<void>();
    const storage = memoryStorage();
    const setItem = vi.fn(() => write.promise);
    const store = createMaterialBookmarkStore({ ...storage, setItem });
    await store.load(account);
    const saving = store.setBookmark(account, first.courseId, first.materialId, true);
    expect(await store.setBookmark(account, first.courseId, first.materialId, true)).toBe(false);
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    write.resolve();
    expect(await saving).toBe(true);
    expect(store.getSnapshot(account).items.map(materialBookmarkId)).toEqual([materialBookmarkId(first)]);
  });

  it('取得儲存鎖失敗時保留收藏、解除處理中狀態且允許重試', async () => {
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    let lockFails = true;
    const store = createMaterialBookmarkStore({
      ...storage,
      withLock: async (_key, operation) => {
        if (lockFails) throw new Error('無法取得儲存鎖');
        return operation();
      },
    });
    await store.load(account);
    expect(await store.setBookmark(account, first.courseId, first.materialId, false)).toBe(false);
    expect(store.getSnapshot(account)).toMatchObject({ items: [{ ...first, savedAt: earlier }], pending: [] });
    expect(store.getSnapshot(account).error).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    lockFails = false;
    expect(await store.setBookmark(account, first.courseId, first.materialId, false)).toBe(true);
  });

  it('重新掛載讀取與儲存交錯時不把已移除的收藏加回畫面', async () => {
    const read = deferred<string | null>();
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    const store = createMaterialBookmarkStore({
      ...storage,
      getItem: vi.fn<(key: string) => string | null | Promise<string | null>>()
        .mockImplementationOnce(() => read.promise)
        .mockImplementation((key) => storage.values.get(key) ?? null),
    });
    const loading = store.load(account);
    const removal = store.setBookmark(account, first.courseId, first.materialId, false);
    read.resolve(storage.values.get(materialBookmarkStorageKey(account))!);
    await loading;
    expect(await removal).toBe(true);
    await store.load(account);
    expect(store.getSnapshot(account)).toMatchObject({ items: [], ready: true, pending: [] });
    expect(parseMaterialBookmarks(storage.values.get(materialBookmarkStorageKey(account))!)).toEqual([]);
  });

  it('重新掛載會重讀儲存，找回另一畫面已經保存的變更', async () => {
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    const store = createMaterialBookmarkStore(storage);
    await store.load(account);
    storage.values.set(materialBookmarkStorageKey(account), JSON.stringify({ version: 1, items: [{ ...second, savedAt: later }] }));
    await store.load(account);
    expect(store.getSnapshot(account).items).toEqual([{ ...second, savedAt: later }]);
  });

  it('前一帳號的儲存尚未完成也不阻塞另一帳號或把結果帶到新帳號', async () => {
    const write = deferred<void>();
    const storage = memoryStorage();
    const store = createMaterialBookmarkStore({
      ...storage,
      setItem: async (key, value) => {
        if (key === materialBookmarkStorageKey(account)) await write.promise;
        storage.values.set(key, value);
      },
    });
    await Promise.all([store.load(account), store.load(otherAccount)]);
    const previousSave = store.setBookmark(account, first.courseId, first.materialId, true);
    expect(await store.setBookmark(otherAccount, second.courseId, second.materialId, true)).toBe(true);
    expect(store.getSnapshot(otherAccount).items.map(materialBookmarkId)).toEqual([materialBookmarkId(second)]);
    write.resolve();
    expect(await previousSave).toBe(true);
    expect(store.getSnapshot(otherAccount).items.map(materialBookmarkId)).toEqual([materialBookmarkId(second)]);
  });

  it('寫入失敗保留原本狀態，清除處理中狀態並允許重試', async () => {
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    storage.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError'); });
    const store = createMaterialBookmarkStore(storage);
    await store.load(account);
    expect(await store.setBookmark(account, first.courseId, first.materialId, false)).toBe(false);
    expect(store.getSnapshot(account)).toMatchObject({ items: [{ ...first, savedAt: earlier }], pending: [] });
    expect(store.getSnapshot(account).error).toBeTruthy();
    expect(await store.setBookmark(account, first.courseId, first.materialId, false)).toBe(true);
    expect(store.getSnapshot(account)).toMatchObject({ items: [], error: null, pending: [] });
  });

  it('讀取失敗不覆寫未知資料，恢復儲存後可以重試', async () => {
    const storage = memoryStorage([{ ...first, savedAt: earlier }]);
    storage.getItem.mockImplementationOnce(() => { throw new Error('讀取失敗'); });
    const store = createMaterialBookmarkStore(storage);
    await store.load(account);
    expect(store.getSnapshot(account).error).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    await store.load(account);
    expect(store.getSnapshot(account)).toMatchObject({ items: [{ ...first, savedAt: earlier }], error: null, ready: true });
  });

  it('損壞的儲存不會因為按收藏被靜默清空', async () => {
    const storage = memoryStorage();
    storage.values.set(materialBookmarkStorageKey(account), '{broken');
    const store = createMaterialBookmarkStore(storage);
    await store.load(account);
    expect(await store.setBookmark(account, first.courseId, first.materialId, true)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.get(materialBookmarkStorageKey(account))).toBe('{broken');
    expect(store.getSnapshot(account).error).toBeTruthy();
  });

  it('尚未登入時不建立共用收藏，也不存取任何儲存鍵', async () => {
    const storage = memoryStorage();
    const store = createMaterialBookmarkStore(storage);
    await store.load('');
    expect(await store.setBookmark('', first.courseId, first.materialId, true)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.getSnapshot('').items).toEqual([]);
  });

  it('達到收藏上限不刪除舊收藏，仍可移除後再新增', async () => {
    const initial = Array.from({ length: 500 }, (_, index) => ({
      courseId: first.courseId, materialId: `cwm_${index}`, savedAt: earlier,
    }));
    const storage = memoryStorage(initial);
    const store = createMaterialBookmarkStore(storage);
    await store.load(account);
    expect(await store.setBookmark(account, first.courseId, first.materialId, true)).toBe(false);
    expect(store.getSnapshot(account).items).toHaveLength(500);
    expect(store.getSnapshot(account).error).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(await store.setBookmark(account, first.courseId, 'cwm_0', false)).toBe(true);
    expect(await store.setBookmark(account, first.courseId, first.materialId, true)).toBe(true);
    expect(store.getSnapshot(account).items).toHaveLength(500);
  });

  it('訂閱只通知自己的帳號，取消訂閱後不再通知', async () => {
    const store = createMaterialBookmarkStore(memoryStorage());
    await Promise.all([store.load(account), store.load(otherAccount)]);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(account, listener);
    await store.setBookmark(otherAccount, second.courseId, second.materialId, true);
    expect(listener).not.toHaveBeenCalled();
    await store.setBookmark(account, first.courseId, first.materialId, true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await store.setBookmark(account, first.courseId, first.materialId, false);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('收藏教材重新驗證', () => {
  it('每次開啟都重新取得教材，跨頁找到教材後使用新內容', async () => {
    const current = material();
    const materialsPage = vi.fn<(id: string, pageToken?: string) => Promise<NuniMaterialPage>>()
      .mockResolvedValueOnce({ materials: [], nextCursor: 'page-two' })
      .mockResolvedValueOnce({ materials: [current], nextCursor: null })
      .mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toEqual({ status: 'available', material: current });
    expect(materialsPage.mock.calls).toEqual([[first.courseId, undefined], [first.courseId, 'page-two']]);
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toMatchObject({ status: 'unavailable' });
    expect(materialsPage).toHaveBeenCalledTimes(3);
  });

  it('相同教材編號出現在別的課程時不開啟', async () => {
    const materialsPage = vi.fn().mockResolvedValue({
      materials: [material({ workspaceId: second.courseId })], nextCursor: null,
    });
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toMatchObject({ status: 'unavailable' });
  });

  it.each([401, 403])('權限被撤銷或登入失效時不回傳舊教材：%s', async (status) => {
    const materialsPage = vi.fn().mockRejectedValue(new NuniError(status, 'FORBIDDEN'));
    const result = await resolveMaterialBookmark({ materialsPage }, first);
    expect(result).toMatchObject({ status: 'unavailable' });
    expect('message' in result && result.message).toContain('權限');
    expect(result).not.toHaveProperty('material');
  });

  it.each([404, 410])('課程或教材被刪除時提供失效狀態：%s', async (status) => {
    const result = await resolveMaterialBookmark({ materialsPage: vi.fn().mockRejectedValue(new NuniError(status, 'NOT_FOUND')) }, first);
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(result).not.toHaveProperty('material');
  });

  it('完整讀完仍找不到教材才回傳已失效', async () => {
    const materialsPage = vi.fn().mockResolvedValueOnce({ materials: [], nextCursor: 'last-page' })
      .mockResolvedValueOnce({ materials: [], nextCursor: null });
    const result = await resolveMaterialBookmark({ materialsPage }, first);
    expect(result).toMatchObject({ status: 'unavailable' });
    expect('message' in result && result.message).toContain('移除');
    expect(materialsPage).toHaveBeenCalledTimes(2);
  });

  it('網路故障提供重試錯誤，不誤判教材已刪除', async () => {
    const result = await resolveMaterialBookmark({ materialsPage: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }, first);
    expect(result).toMatchObject({ status: 'error' });
    expect('message' in result && result.message).toContain('連線');
  });

  it('逾時結束等待，遲到的成功結果不改變已回傳的錯誤', async () => {
    vi.useFakeTimers();
    const response = deferred<NuniMaterialPage>();
    const resolving = resolveMaterialBookmark({ materialsPage: vi.fn(() => response.promise) }, first);
    await vi.advanceTimersByTimeAsync(30001);
    const result = await resolving;
    expect(result).toMatchObject({ status: 'error' });
    response.resolve({ materials: [material()], nextCursor: null });
    await Promise.resolve();
    expect(result).toMatchObject({ status: 'error' });
  });

  it('頁碼循環停止且回報錯誤，不誤判教材失效', async () => {
    const materialsPage = vi.fn().mockResolvedValue({ materials: [], nextCursor: 'same-page' });
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toMatchObject({ status: 'error' });
    expect(materialsPage).toHaveBeenCalledTimes(2);
  });

  it('持續回傳新頁碼也有讀取上限，不誤判教材失效', async () => {
    let page = 0;
    const materialsPage = vi.fn(async () => ({ materials: [], nextCursor: `page-${++page}` }));
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toMatchObject({ status: 'error' });
    expect(materialsPage).toHaveBeenCalledTimes(100);
  });

  it('切換帳號後不發出新讀取，也不採用前一帳號的遲到結果', async () => {
    const response = deferred<NuniMaterialPage>();
    let cancelled = false;
    const materialsPage = vi.fn(() => response.promise);
    const resolving = resolveMaterialBookmark({ materialsPage }, first, () => cancelled);
    cancelled = true;
    response.resolve({ materials: [material()], nextCursor: 'next-page' });
    expect(await resolving).toEqual({ status: 'cancelled' });
    expect(materialsPage).toHaveBeenCalledTimes(1);
    expect(await resolveMaterialBookmark({ materialsPage }, first, () => true)).toEqual({ status: 'cancelled' });
    expect(materialsPage).toHaveBeenCalledTimes(1);
  });

  it('切換帳號後的遲到權限錯誤不帶入新畫面', async () => {
    const response = deferred<NuniMaterialPage>();
    let cancelled = false;
    const resolving = resolveMaterialBookmark({ materialsPage: vi.fn(() => response.promise) }, first, () => cancelled);
    cancelled = true;
    response.reject(new NuniError(403, 'FORBIDDEN'));
    expect(await resolving).toEqual({ status: 'cancelled' });
  });
});


describe('收藏清單批次共用分頁', () => {
  it('同課程同頁共用尚未完成的請求，取消一列不會取消其他列', async () => {
    const pending = deferred<NuniMaterialPage>();
    const materialsPage = vi.fn(() => pending.promise);
    const resolve = createMaterialBookmarkBatchResolver({ materialsPage });
    let cancelled = false;
    const one = resolve(first, () => cancelled);
    const two = resolve({ ...first, materialId: 'second' });
    await Promise.resolve();
    expect(materialsPage).toHaveBeenCalledTimes(1);
    cancelled = true;
    pending.resolve({ materials: [material(), material({ id: 'second' })], nextCursor: null });
    expect(await one).toEqual({ status: 'cancelled' });
    expect(await two).toMatchObject({ status: 'available', material: { id: 'second' } });
  });

  it('不同課程的相同頁碼與教材編號不共用結果', async () => {
    const materialsPage = vi.fn(async (courseId: string) => ({
      materials: [material({ workspaceId: courseId })], nextCursor: null,
    }));
    const resolve = createMaterialBookmarkBatchResolver({ materialsPage });
    const results = await Promise.all([resolve(first), resolve({ ...first, courseId: second.courseId })]);
    expect(materialsPage).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { status: 'available', material: material() },
      { status: 'available', material: material({ workspaceId: second.courseId }) },
    ]);
  });

  it('一頁失敗只讀一次，新批次與開啟教材仍各自重新驗權', async () => {
    const materialsPage = vi.fn().mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'))
      .mockResolvedValueOnce({ materials: [material()], nextCursor: null })
      .mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
    const resolve = createMaterialBookmarkBatchResolver({ materialsPage });
    const results = await Promise.all([resolve(first), resolve({ ...first, materialId: 'second' })]);
    expect(results.every((result) => result.status === 'unavailable')).toBe(true);
    expect(materialsPage).toHaveBeenCalledTimes(1);
    expect(await createMaterialBookmarkBatchResolver({ materialsPage })(first)).toMatchObject({ status: 'available' });
    expect(await resolveMaterialBookmark({ materialsPage }, first)).toMatchObject({ status: 'unavailable' });
    expect(materialsPage).toHaveBeenCalledTimes(3);
  });

  it('共用逾時結果且忽略遲到回應，新批次可以恢復', async () => {
    vi.useFakeTimers();
    const pending = deferred<NuniMaterialPage>();
    const materialsPage = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ materials: [material()], nextCursor: null });
    const resolve = createMaterialBookmarkBatchResolver({ materialsPage });
    const reads = Promise.all([resolve(first), resolve({ ...first, materialId: 'second' })]);
    await vi.advanceTimersByTimeAsync(30001);
    expect((await reads).every((result) => result.status === 'error')).toBe(true);
    pending.resolve({ materials: [material()], nextCursor: null });
    expect(await resolve(first)).toMatchObject({ status: 'error' });
    expect(materialsPage).toHaveBeenCalledTimes(1);
    expect(await createMaterialBookmarkBatchResolver({ materialsPage })(first)).toMatchObject({ status: 'available' });
  });

  it('取消的批次不讀下一頁，也不把舊批次結果帶入替換的 session', async () => {
    const pending = deferred<NuniMaterialPage>();
    const oldPages = vi.fn(() => pending.promise);
    let cancelled = false;
    const oldRead = createMaterialBookmarkBatchResolver({ materialsPage: oldPages })(first, () => cancelled);
    await Promise.resolve();
    cancelled = true;
    const newPages = vi.fn().mockRejectedValue(new NuniError(403, 'FORBIDDEN'));
    expect(await createMaterialBookmarkBatchResolver({ materialsPage: newPages })(first)).toMatchObject({ status: 'unavailable' });
    pending.resolve({ materials: [], nextCursor: 'older' });
    expect(await oldRead).toEqual({ status: 'cancelled' });
    expect(oldPages).toHaveBeenCalledTimes(1);
    expect(newPages).toHaveBeenCalledTimes(1);
  });
});
