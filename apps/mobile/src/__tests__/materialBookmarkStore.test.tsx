import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { materialBookmarkStorageKey } from '@campus/shared/src/materialBookmarks';
import { useMaterialBookmarks } from '../state/materialBookmarks';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const first = { courseId: 'cw_database', materialId: 'cwm_relations', savedAt: '2026-11-01T08:00:00.000Z' };
const second = { courseId: 'cw_design', materialId: 'cwm_sketches', savedAt: '2026-11-01T09:00:00.000Z' };
const serialized = (items: typeof first[]) => JSON.stringify({ version: 1, items });

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('收藏寫入裝置儲存，離開畫面再回來仍能找到且會重讀最新資料', async () => {
  const account = 'pa_mobile_reopen';
  const screen = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(screen.result.current.ready).toBe(true));
  await act(async () => {
    expect(await screen.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(JSON.parse((await AsyncStorage.getItem(materialBookmarkStorageKey(account)))!).items)
    .toEqual([{ courseId: first.courseId, materialId: first.materialId, savedAt: expect.any(String) }]);
  screen.unmount();
  await AsyncStorage.setItem(materialBookmarkStorageKey(account), serialized([second, first]));
  const reopened = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(reopened.result.current.items).toEqual([second, first]));
  expect(reopened.result.current.error).toBeNull();
});

test('不同教材卡訂閱同一帳號，新增與移除即時一致', async () => {
  const account = 'pa_mobile_subscribe';
  const card = renderHook(() => useMaterialBookmarks(account));
  const list = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(card.result.current.ready && list.result.current.ready).toBe(true));
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(list.result.current.items).toEqual(card.result.current.items);
  expect(list.result.current.items).toHaveLength(1);
  await act(async () => {
    expect(await list.result.current.setBookmark(first.courseId, first.materialId, false)).toBe(true);
  });
  expect(card.result.current.items).toEqual([]);
});

test('前一帳號讀取尚未完成就切換時，遲到收藏不出現在新帳號', async () => {
  const account = 'pa_mobile_late_read_a';
  const nextAccount = 'pa_mobile_late_read_b';
  await AsyncStorage.setItem(materialBookmarkStorageKey(nextAccount), serialized([second]));
  const read = deferred<string | null>();
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => read.promise);
  const screen = renderHook(({ id }) => useMaterialBookmarks(id), { initialProps: { id: account } });
  await waitFor(() => expect(getItem).toHaveBeenCalledWith(materialBookmarkStorageKey(account)));
  screen.rerender({ id: nextAccount });
  expect(screen.result.current.items).toEqual([]);
  await waitFor(() => expect(screen.result.current.items).toEqual([second]));
  await act(async () => { read.resolve(serialized([first])); });
  expect(screen.result.current.items).toEqual([second]);
  expect(await AsyncStorage.getItem(materialBookmarkStorageKey(nextAccount))).toBe(serialized([second]));
});

test('前一帳號寫入尚未完成就切換時，完成狀態與收藏留在原帳號', async () => {
  const account = 'pa_mobile_late_write_a';
  const nextAccount = 'pa_mobile_late_write_b';
  await AsyncStorage.setItem(materialBookmarkStorageKey(nextAccount), serialized([second]));
  const screen = renderHook(({ id }) => useMaterialBookmarks(id), { initialProps: { id: account } });
  await waitFor(() => expect(screen.result.current.ready).toBe(true));
  const write = deferred<void>();
  const originalWrite = AsyncStorage.setItem;
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await write.promise;
    await originalWrite(key, value);
  });
  let saving!: Promise<boolean>;
  act(() => { saving = screen.result.current.setBookmark(first.courseId, first.materialId, true); });
  await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
  screen.rerender({ id: nextAccount });
  await waitFor(() => expect(screen.result.current.items).toEqual([second]));
  expect(screen.result.current.pending).toEqual([]);
  await act(async () => { write.resolve(); expect(await saving).toBe(true); });
  expect(screen.result.current.items).toEqual([second]);
  expect(screen.result.current.error).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(materialBookmarkStorageKey(account)))!).items)
    .toEqual([{ courseId: first.courseId, materialId: first.materialId, savedAt: expect.any(String) }]);
});

test('裝置寫入失敗不標記已收藏，保留重試並在成功後通知所有畫面', async () => {
  const account = 'pa_mobile_write_failure';
  const card = renderHook(() => useMaterialBookmarks(account));
  const list = renderHook(() => useMaterialBookmarks(account));
  await waitFor(() => expect(card.result.current.ready && list.result.current.ready).toBe(true));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('儲存空間不足'));
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(false);
  });
  expect(card.result.current.items).toEqual([]);
  expect(list.result.current.items).toEqual([]);
  expect(card.result.current.error).toContain('未儲存');
  expect(card.result.current.pending).toEqual([]);
  expect(await AsyncStorage.getItem(materialBookmarkStorageKey(account))).toBeNull();
  await act(async () => {
    expect(await card.result.current.setBookmark(first.courseId, first.materialId, true)).toBe(true);
  });
  expect(card.result.current.error).toBeNull();
  expect(list.result.current.items).toHaveLength(1);
});
