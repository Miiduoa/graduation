import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { materialBookmarkStorageKey } from '@campus/shared/src/materialBookmarks';
import { useMaterialBookmarks } from './materialBookmarks';

const first = { courseId: 'cw_database', materialId: 'cwm_relations', savedAt: '2026-11-01T08:00:00.000Z' };
const second = { courseId: 'cw_design', materialId: 'cwm_sketches', savedAt: '2026-11-01T09:00:00.000Z' };
const serialized = (items: typeof first[]) => JSON.stringify({ version: 1, items });
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

it('收藏存入瀏覽器，重新進入畫面仍找得到並重讀裝置資料', async () => {
  const account = 'pa_web_reopen';
  const screen = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(screen.result.current.ready).toBe(true));
  await act(async () => {
    expect(await screen.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(JSON.parse(localStorage.getItem(materialBookmarkStorageKey(account))!).items)
    .toEqual([{ courseId: first.courseId, materialId: first.materialId, savedAt: expect.any(String) }]);
  screen.unmount();
  localStorage.setItem(materialBookmarkStorageKey(account), serialized([second, first]));
  const reopened = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(reopened.result.current.items).toEqual([second, first]));
  expect(reopened.result.current.error).toBeNull();
});

it('同帳號教材卡與收藏清單同步新增移除，其他帳號不受影響', async () => {
  const account = 'pa_web_subscribe';
  const card = renderHook(() => useMaterialBookmarks(account));
  const list = renderHook(() => useMaterialBookmarks(account));
  const other = renderHook(() => useMaterialBookmarks('pa_web_subscribe_other'));
  await waitFor(() => expect(card.result.current.ready && list.result.current.ready && other.result.current.ready).toBe(true));
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(list.result.current.items).toEqual(card.result.current.items);
  expect(list.result.current.items).toHaveLength(1);
  expect(other.result.current.items).toEqual([]);
  await act(async () => {
    expect(await list.result.current.setBookmark(first.courseId, first.materialId, false)).toBe(true);
  });
  expect(card.result.current.items).toEqual([]);
});

it('讀取排程尚未完成就切換帳號時不帶入前一帳號收藏', async () => {
  const account = 'pa_web_read_a';
  const nextAccount = 'pa_web_read_b';
  localStorage.setItem(materialBookmarkStorageKey(account), serialized([first]));
  localStorage.setItem(materialBookmarkStorageKey(nextAccount), serialized([second]));
  const screen = renderHook(({ id }) => useMaterialBookmarks(id), { initialProps: { id: account } });
  expect(screen.result.current.loading).toBe(true);
  screen.rerender({ id: nextAccount });
  expect(screen.result.current.items).toEqual([]);
  await waitFor(() => expect(screen.result.current.items).toEqual([second]));
  expect(screen.result.current.error).toBeNull();
  expect(localStorage.getItem(materialBookmarkStorageKey(account))).toBe(serialized([first]));
});

it('等待瀏覽器儲存鎖時切換帳號，舊寫入完成只更新原帳號', async () => {
  const account = 'pa_web_write_a';
  const nextAccount = 'pa_web_write_b';
  localStorage.setItem(materialBookmarkStorageKey(nextAccount), serialized([second]));
  const lock = deferred<void>();
  const request = vi.fn(async (_key: string, operation: () => Promise<boolean>) => {
    await lock.promise;
    return operation();
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const screen = renderHook(({ id }) => useMaterialBookmarks(id), { initialProps: { id: account } });
  await waitFor(() => expect(screen.result.current.ready).toBe(true));
  let saving!: Promise<boolean>;
  act(() => { saving = screen.result.current.setBookmark(first.courseId, first.materialId, true); });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(screen.result.current.items).toEqual([]);
  expect(screen.result.current.pending).toHaveLength(1);
  screen.rerender({ id: nextAccount });
  await waitFor(() => expect(screen.result.current.items).toEqual([second]));
  expect(screen.result.current.pending).toEqual([]);
  await act(async () => { lock.resolve(); expect(await saving).toBe(true); });
  expect(screen.result.current.items).toEqual([second]);
  expect(JSON.parse(localStorage.getItem(materialBookmarkStorageKey(account))!).items)
    .toEqual([{ courseId: first.courseId, materialId: first.materialId, savedAt: expect.any(String) }]);
});

it('瀏覽器拒絕儲存時不顯示已收藏，重試成功才同步到清單', async () => {
  const account = 'pa_web_write_failure';
  const card = renderHook(() => useMaterialBookmarks(account));
  const list = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(card.result.current.ready && list.result.current.ready).toBe(true));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('儲存空間不足', 'QuotaExceededError'); });
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(false);
  });
  expect(card.result.current.items).toEqual([]);
  expect(list.result.current.items).toEqual([]);
  expect(card.result.current.error).toContain('未儲存');
  expect(card.result.current.pending).toEqual([]);
  expect(localStorage.getItem(materialBookmarkStorageKey(account))).toBeNull();
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(card.result.current.error).toBeNull();
  expect(list.result.current.items).toHaveLength(1);
});

it('其他分頁修改同帳號收藏會重讀，只收到別帳號事件時不改變清單', async () => {
  const account = 'pa_web_storage_events';
  localStorage.setItem(materialBookmarkStorageKey(account), serialized([first]));
  const screen = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(screen.result.current.items).toEqual([first]));
  localStorage.setItem(materialBookmarkStorageKey(account), serialized([second]));
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: materialBookmarkStorageKey('pa_other'), newValue: serialized([second]) }));
  });
  expect(screen.result.current.items).toEqual([first]);
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: materialBookmarkStorageKey(account), newValue: serialized([second]) }));
  });
  await waitFor(() => expect(screen.result.current.items).toEqual([second]));
  localStorage.clear();
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
  await waitFor(() => expect(screen.result.current.items).toEqual([]));
});
