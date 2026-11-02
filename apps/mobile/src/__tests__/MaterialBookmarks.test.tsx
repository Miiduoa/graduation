import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  createMaterialBookmarkStore,
  materialBookmarkStorageKey,
  type MaterialBookmark,
} from '@campus/shared/src/materialBookmarks';
import { NuniError, type NuniMaterial } from '@campus/shared/src/nuni';
import { MaterialBookmarkButton, MaterialBookmarks } from '../screens/nuni/MaterialBookmarks';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));

const entry: MaterialBookmark = {
  courseId: 'course-one',
  materialId: 'material-one',
  savedAt: '2026-10-30T03:00:00.000Z',
};
const material: NuniMaterial = {
  id: entry.materialId,
  workspaceId: entry.courseId,
  title: '期中複習',
  body: '教材內容',
  unitId: 'unit-one',
  unitTitle: '第一單元',
  createdAt: entry.savedAt,
  createdByPlatformAccountId: 'teacher',
};
function storageFixture(account = 'first', items: MaterialBookmark[] = []) {
  const values = new Map<string, string>([
    [materialBookmarkStorageKey(account), JSON.stringify({ version: 1, items })],
  ]);
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Store = ReturnType<typeof createMaterialBookmarkStore>;
type Classes = Parameters<typeof MaterialBookmarks>[0]['classes'];
function Scope({
  store,
  account = 'first',
  scopeKey = account,
  list = false,
  active = true,
  classes = { materialsPage: async () => ({ materials: [material], nextCursor: null }) },
  open = jest.fn(),
  browse = jest.fn(),
}: {
  store: Store;
  account?: string;
  scopeKey?: string;
  list?: boolean;
  active?: boolean;
  classes?: Classes;
  open?: (courseId: string, materialId: string) => void;
  browse?: () => void;
}) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(account, listener),
    [account, store],
  );
  const snapshot = useSyncExternalStore(subscribe, () => store.getSnapshot(account));
  useEffect(() => {
    void store.load(account);
  }, [account, store]);
  const bookmarks = {
    ...snapshot,
    setBookmark: (courseId: string, materialId: string, saved: boolean) =>
      store.setBookmark(account, courseId, materialId, saved),
    reload: () => store.load(account),
  };
  return list ? (
    <MaterialBookmarks
      classes={classes}
      store={bookmarks}
      scopeKey={scopeKey}
      active={active}
      open={open}
      onBrowse={browse}
    />
  ) : (
    <MaterialBookmarkButton
      courseId={entry.courseId}
      materialId={entry.materialId}
      title={material.title}
      store={bookmarks}
      scopeKey={scopeKey}
      active={active}
    />
  );
}

afterEach(() => jest.restoreAllMocks());

it('acknowledges a tap immediately, confirms only durable writes, and restores the list after a cold store restart', async () => {
  const storage = storageFixture();
  const pending = deferred<void>();
  storage.setItem.mockImplementationOnce(async (key, value) => {
    await pending.promise;
    storage.values.set(key, value);
  });
  const view = render(<Scope store={createMaterialBookmarkStore(storage)} />);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '收藏到此裝置：期中複習' })).toBeEnabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '收藏到此裝置：期中複習' }));
  expect(view.getByText('正在儲存收藏…')).toBeTruthy();
  expect(view.queryByText('已收藏在此裝置。')).toBeNull();
  fireEvent.press(view.getByText('正在儲存收藏…'));
  await act(async () => pending.resolve());
  await waitFor(() => expect(view.getByText('已收藏在此裝置。')).toBeTruthy());
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.values.get(materialBookmarkStorageKey('first'))!).items[0]).toEqual({
    courseId: entry.courseId,
    materialId: entry.materialId,
    savedAt: expect.any(String),
  });
  view.unmount();
  const reopened = render(<Scope store={createMaterialBookmarkStore(storage)} list />);
  await waitFor(() =>
    expect(reopened.getByRole('button', { name: '回到原教材：期中複習' })).toBeTruthy(),
  );
});

it('keeps failed saves unselected and offers the same action for retry', async () => {
  const storage = storageFixture();
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  const view = render(<Scope store={createMaterialBookmarkStore(storage)} />);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '收藏到此裝置：期中複習' })).toBeEnabled(),
  );
  fireEvent.press(view.getByRole('button', { name: '收藏到此裝置：期中複習' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/收藏未儲存/));
  expect(view.queryByText('已收藏在此裝置。')).toBeNull();
  expect(
    view.getByRole('button', { name: '收藏到此裝置：期中複習' }).props.accessibilityState.selected,
  ).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '收藏到此裝置：期中複習' }));
  await waitFor(() => expect(view.getByText('已收藏在此裝置。')).toBeTruthy());
});

it('revalidates on opening, removes a revoked title, and keeps the invalid entry removable', async () => {
  const storage = storageFixture('first', [entry]);
  const classes = {
    materialsPage: jest
      .fn()
      .mockResolvedValueOnce({ materials: [material], nextCursor: null })
      .mockRejectedValue(new NuniError(403, 'FORBIDDEN')),
  };
  const open = jest.fn();
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} open={open} />,
  );
  await waitFor(() =>
    expect(view.getByRole('button', { name: '回到原教材：期中複習' })).toBeTruthy(),
  );
  fireEvent.press(view.getByRole('button', { name: '回到原教材：期中複習' }));
  expect(view.queryByText('期中複習')).toBeNull();
  await waitFor(() => expect(view.getByText('目前無法開啟的教材')).toBeTruthy());
  expect(open).not.toHaveBeenCalled();
  expect(classes.materialsPage).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByRole('button', { name: /^移除此裝置收藏：/ }));
  await waitFor(() => expect(view.getByText(/還沒有收藏教材/)).toBeTruthy());
  expect(JSON.parse(storage.values.get(materialBookmarkStorageKey('first'))!).items).toEqual([]);
});

it('opens the exact original material after a second fresh authorization check', async () => {
  const storage = storageFixture('first', [entry]);
  const classes = {
    materialsPage: jest.fn(async () => ({ materials: [material], nextCursor: null })),
  };
  const open = jest.fn();
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} open={open} />,
  );
  await waitFor(() =>
    expect(view.getByRole('button', { name: '回到原教材：期中複習' })).toBeTruthy(),
  );
  fireEvent.press(view.getByRole('button', { name: '回到原教材：期中複習' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(entry.courseId, entry.materialId));
  expect(classes.materialsPage).toHaveBeenCalledTimes(2);
});

it('locks removal while opening is being revalidated so the two intents cannot race', async () => {
  const storage = storageFixture('first', [entry]);
  const delayed = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  const classes = {
    materialsPage: jest
      .fn()
      .mockResolvedValueOnce({ materials: [material], nextCursor: null })
      .mockImplementationOnce(() => delayed.promise),
  };
  const open = jest.fn();
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} open={open} />,
  );
  fireEvent.press(await view.findByRole('button', { name: '回到原教材：期中複習' }));
  const remove = view.getByRole('button', { name: /^移除此裝置收藏：/ });
  expect(remove).toBeDisabled();
  fireEvent.press(remove);
  expect(storage.setItem).not.toHaveBeenCalled();
  await act(async () => delayed.resolve({ materials: [material], nextCursor: null }));
  expect(open).toHaveBeenCalledWith(entry.courseId, entry.materialId);
});

it('does not open an entry while its removal is awaiting durable storage', async () => {
  const storage = storageFixture('first', [entry]);
  const delayed = deferred<void>();
  storage.setItem.mockImplementationOnce(async (key, value) => {
    await delayed.promise;
    storage.values.set(key, value);
  });
  const classes = {
    materialsPage: jest.fn(async () => ({ materials: [material], nextCursor: null })),
  };
  const open = jest.fn();
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} open={open} />,
  );
  await view.findByRole('button', { name: '回到原教材：期中複習' });
  fireEvent.press(view.getByRole('button', { name: '移除此裝置收藏：期中複習' }));
  const original = view.getByRole('button', { name: '回到原教材：期中複習' });
  expect(original).toBeDisabled();
  fireEvent.press(original);
  expect(classes.materialsPage).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  await act(async () => delayed.resolve());
  await waitFor(() => expect(view.getByText(/還沒有收藏教材/)).toBeTruthy());
});

it('hides previous account content and drops its delayed results without touching the new account', async () => {
  const storage = storageFixture('first', [entry]);
  const store = createMaterialBookmarkStore(storage);
  const delayed = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  const oldClasses = { materialsPage: jest.fn(() => delayed.promise) };
  const newClasses = { materialsPage: jest.fn() };
  const view = render(<Scope store={store} list classes={oldClasses} />);
  await waitFor(() => expect(oldClasses.materialsPage).toHaveBeenCalledTimes(1));
  view.rerender(<Scope store={store} list account="second" classes={newClasses} />);
  await waitFor(() => expect(view.getByText(/還沒有收藏教材/)).toBeTruthy());
  await act(async () => delayed.resolve({ materials: [material], nextCursor: null }));
  expect(view.queryByText('期中複習')).toBeNull();
  expect(newClasses.materialsPage).not.toHaveBeenCalled();
  expect(JSON.parse(storage.values.get(materialBookmarkStorageKey('first'))!).items).toEqual([
    entry,
  ]);
  expect(storage.values.has(materialBookmarkStorageKey('second'))).toBe(false);
});

it('masks titles on background, refreshes on foreground, and rejects the stale open response', async () => {
  let changed!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    changed = listener;
    return { remove: jest.fn() };
  });
  const storage = storageFixture('first', [entry]);
  const delayed = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  const classes = {
    materialsPage: jest
      .fn()
      .mockResolvedValueOnce({ materials: [material], nextCursor: null })
      .mockImplementationOnce(() => delayed.promise)
      .mockRejectedValue(new NuniError(403, 'FORBIDDEN')),
  };
  const open = jest.fn();
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} open={open} />,
  );
  await waitFor(() =>
    expect(view.getByRole('button', { name: '回到原教材：期中複習' })).toBeTruthy(),
  );
  fireEvent.press(view.getByRole('button', { name: '回到原教材：期中複習' }));
  act(() => changed('background'));
  expect(view.queryByText('期中複習')).toBeNull();
  act(() => changed('active'));
  await waitFor(() => expect(view.getByText('目前無法開啟的教材')).toBeTruthy());
  await act(async () => delayed.resolve({ materials: [material], nextCursor: null }));
  expect(open).not.toHaveBeenCalled();
  expect(view.queryByText('期中複習')).toBeNull();
});

it('refreshes on return to the course tab and after session replacement', async () => {
  const storage = storageFixture('first', [entry]);
  const store = createMaterialBookmarkStore(storage);
  const classes = {
    materialsPage: jest.fn(async () => ({ materials: [material], nextCursor: null })),
  };
  const view = render(<Scope store={store} list classes={classes} />);
  await waitFor(() => expect(view.getByText('期中複習')).toBeTruthy());
  view.rerender(<Scope store={store} list classes={classes} active={false} />);
  expect(view.queryByText('期中複習')).toBeNull();
  view.rerender(<Scope store={store} list classes={classes} active />);
  await waitFor(() => expect(classes.materialsPage).toHaveBeenCalledTimes(2));
  view.rerender(<Scope store={store} list classes={classes} scopeKey="renewed-session" />);
  await waitFor(() => expect(classes.materialsPage).toHaveBeenCalledTimes(3));
});

it('retains a missing material when removal fails and lets the user retry', async () => {
  const storage = storageFixture('first', [entry]);
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  const classes = { materialsPage: jest.fn(async () => ({ materials: [], nextCursor: null })) };
  const view = render(
    <Scope store={createMaterialBookmarkStore(storage)} list classes={classes} />,
  );
  await waitFor(() => expect(view.getByText(/這份教材已不存在/)).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: /^移除此裝置收藏：/ }));
  await waitFor(() => expect(view.getAllByText(/收藏未儲存/).length).toBeGreaterThan(0));
  expect(view.queryByText(/還沒有收藏教材/)).toBeNull();
  expect(JSON.parse(storage.values.get(materialBookmarkStorageKey('first'))!).items).toEqual([
    entry,
  ]);
  fireEvent.press(view.getByRole('button', { name: /^移除此裝置收藏：/ }));
  await waitFor(() => expect(view.getByText(/還沒有收藏教材/)).toBeTruthy());
});

it('provides recovery for unreadable storage and an actionable empty list', async () => {
  const storage = storageFixture();
  storage.getItem.mockRejectedValueOnce(new Error('unavailable'));
  const browse = jest.fn();
  const view = render(<Scope store={createMaterialBookmarkStore(storage)} list browse={browse} />);
  await waitFor(() => expect(view.getByRole('button', { name: '重試讀取收藏' })).toBeTruthy());
  expect(view.queryByText(/還沒有收藏教材/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重試讀取收藏' }));
  await waitFor(() => expect(view.getByText(/還沒有收藏教材/)).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '回我的課程找教材' }));
  expect(browse).toHaveBeenCalled();
});

it.each([50, 100, 500])('同課程 %s 份收藏每頁只讀一次，更新清單重新讀取', async (count) => {
  const materials = Array.from({ length: count }, (_, index) => ({ ...material, id: `saved-${index}`, title: `教材 ${index}` }));
  const items = materials.map((item) => ({ ...entry, materialId: item.id }));
  const classes = { materialsPage: jest.fn(async (_courseId: string, cursor?: string) => {
    const offset = Number(cursor ?? 0);
    return { materials: materials.slice(offset, offset + 50), nextCursor: offset + 50 < count ? String(offset + 50) : null };
  }) };
  const view = render(<Scope store={createMaterialBookmarkStore(storageFixture('first', items))} list classes={classes} />);
  await view.findByRole('button', { name: `回到原教材：教材 ${count - 1}` }, { timeout: 20000 });
  expect(view.getAllByRole('button', { name: /^回到原教材：/ })).toHaveLength(count);
  expect(classes.materialsPage).toHaveBeenCalledTimes(count / 50);
  fireEvent.press(view.getByRole('button', { name: '重新確認教材' }));
  await view.findByRole('button', { name: `回到原教材：教材 ${count - 1}` }, { timeout: 20000 });
  expect(classes.materialsPage).toHaveBeenCalledTimes(count / 50 * 2);
}, 60000);
