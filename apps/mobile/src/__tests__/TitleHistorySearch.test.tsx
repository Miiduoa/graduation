import React from 'react';
import { AccessibilityInfo, FlatList, Modal, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { TitleHistoryLauncher, TitleHistorySearch } from '../screens/social/TitleHistorySearch';
import { CommunityScreen } from '../screens/CommunityScreen';
import { confirmCampusPostTitleOpen, resumeCampusPostTitles, searchCampusPostTitles, type TitleSearchPage, type TitleSearchPost, type TitleSearchCursor } from '../services/titleSearch';

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = 'pu';
let mockLoading = false;
let mockDemo = false;
let mockFirebaseMock = false;
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => mockFirebaseMock }));
jest.mock('../services/demoSession', () => ({ isDemoUid: () => mockDemo }));
jest.mock('../ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (factory: () => unknown) => factory() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../screens/social/HomeFeedScreen', () => ({ HomeFeedScreen: () => {
  const React = require('react'); const { Text } = require('react-native');
  return React.createElement(Text, null, '原動態保留');
} }));
jest.mock('../screens/social/BoardsScreen', () => ({ BoardsScreen: () => null }));
jest.mock('../screens/social/RealtimeSocialScreen', () => ({ RealtimeSocialScreen: () => null }));
jest.mock('../screens/community/StudyBuddyPanel', () => ({ StudyBuddyPanel: () => null }));
jest.mock('../services/titleSearch', () => ({
  parseTitlePrefix: jest.requireActual('@campus/shared/src/communityTitleSearch').parseTitlePrefix,
  searchCampusPostTitles: jest.fn(),
  resumeCampusPostTitles: jest.fn(),
  confirmCampusPostTitleOpen: jest.fn(),
}));
const search = jest.mocked(searchCampusPostTitles);
const resume = jest.mocked(resumeCampusPostTitles);
const confirmOpen = jest.mocked(confirmCampusPostTitleOpen);
const row = (id: string, title = `二手書 ${id}`): TitleSearchPost => ({ id, title, schoolId: 'pu', excerpt: '舊學期的課本', anonymous: true });
const result = (posts = [row('one')], hasMore = false): TitleSearchPage => ({
  posts, hasMore, nextCursor: posts.length ? {
    schoolId: 'pu', prefix: '二手書', document: { id: posts.at(-1)!.id } as TitleSearchCursor['document'],
  } : null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function panel() {
  const close = jest.fn(); const open = jest.fn();
  return { ...render(<TitleHistorySearch schoolId="pu" onClose={close} onOpenPost={open} />), close, open };
}
function enter(view: ReturnType<typeof render>, text = '二手書') {
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), text);
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' }; mockSchool = 'pu'; mockLoading = false; mockDemo = false; mockFirebaseMock = false;
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  search.mockReset().mockResolvedValue(result());
  resume.mockReset().mockResolvedValue(result());
  confirmOpen.mockReset().mockResolvedValue(true);
});

test.each(['signed-out', 'loading', 'demo', 'mock', 'no-school'])('does not expose the launcher for %s', (condition) => {
  if (condition === 'signed-out') mockUser = null;
  if (condition === 'loading') mockLoading = true;
  if (condition === 'demo') mockDemo = true;
  if (condition === 'mock') mockFirebaseMock = true;
  if (condition === 'no-school') mockSchool = '';
  const view = render(<TitleHistoryLauncher onOpenPost={jest.fn()} />);
  expect(view.queryByLabelText('找舊貼文')).toBeNull();
  expect(search).not.toHaveBeenCalled();
});

test.each(['', '   ', 'a'.repeat(81), '二手\n書'])('rejects invalid input without a service call: %j', async (text) => {
  const view = panel(); enter(view, text);
  expect(await view.findByText('請輸入 1 至 80 字的標題開頭。')).toBeTruthy();
  expect(search).not.toHaveBeenCalled();
});

test('searches the literal title and opens only the scoped post identifier', async () => {
  const view = panel(); enter(view, '  二手書  ');
  await view.findByText('二手書 one');
  expect(search).toHaveBeenCalledWith('pu', '二手書', null);
  expect(view.getByText('匿名貼文')).toBeTruthy();
  expect(view.getByText(/英文區分大小寫；不搜尋內文/)).toBeTruthy();
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(view.open).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' }));
  expect(confirmOpen).toHaveBeenCalledWith('pu', 'one', '  二手書  ');
});

test('a pending native post confirmation disables the actual card until safe retry', async () => {
  const pending = deferred<boolean>();
  confirmOpen.mockReturnValueOnce(pending.promise);
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  const card = view.getByLabelText('開啟貼文：二手書 one');
  expect(card.props.disabled).toBe(false);
  fireEvent.press(card);
  const waiting = view.getByLabelText('開啟貼文：二手書 one');
  // Announcing disabled without disabling Pressable leaves VoiceOver,
  // Switch Control and touch interactions with contradictory semantics.
  expect(waiting.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  expect(waiting.props.disabled).toBe(true);
  fireEvent.press(waiting);
  expect(confirmOpen).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(false); });
  expect(view.getByLabelText('開啟貼文：二手書 one').props.disabled).toBe(false);
  expect(view.open).not.toHaveBeenCalled();
});

test('opening the same historical result twice rapidly navigates only once', async () => {
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  const target = view.getByLabelText('開啟貼文：二手書 one');
  fireEvent.press(target);
  fireEvent.press(target);
  await waitFor(() => expect(view.open).toHaveBeenCalledTimes(1));
  expect(view.open).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' });
  expect(confirmOpen).toHaveBeenCalledTimes(1);
});

test('closing a result panel prevents its still-mounted card from opening a post', async () => {
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  const target = view.getByLabelText('開啟貼文：二手書 one');
  fireEvent.press(view.getByLabelText('關閉歷史搜尋'));
  fireEvent.press(target);
  expect(view.close).toHaveBeenCalledTimes(1);
  expect(view.open).not.toHaveBeenCalled();
});

test('uses the same cursor on a failed next-page retry and deduplicates returned IDs', async () => {
  const first = result([row('one')], true);
  search.mockResolvedValueOnce(first).mockRejectedValueOnce({ code: 'unavailable' })
    .mockResolvedValueOnce(result([row('one'), row('two'), { ...row('foreign'), schoolId: 'other' }]));
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await view.findByLabelText('重試歷史搜尋');
  expect(view.getByText('二手書 one')).toBeTruthy();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 two');
  expect(search.mock.calls[1]).toEqual(['pu', '二手書', first.nextCursor]);
  expect(search.mock.calls[2]).toEqual(search.mock.calls[1]);
  expect(view.getAllByText('二手書 one')).toHaveLength(1);
  expect(view.queryByText('二手書 foreign')).toBeNull();
  expect(view.queryByLabelText('載入更多歷史貼文')).toBeNull();
});

test('does not mislabel an unavailable first page as an empty result', async () => {
  search.mockRejectedValueOnce({ code: 'unavailable' });
  const view = panel(); enter(view);
  await view.findByLabelText('重試歷史搜尋');
  expect(view.queryByText('沒有符合這個標題開頭的貼文。')).toBeNull();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 one');
});

test.each(['permission-denied', 'firestore/unauthenticated'])('clears displayed data after %s and restarts after revalidation', async (code) => {
  search.mockResolvedValueOnce(result([row('one')], true)).mockRejectedValueOnce({ code }).mockResolvedValueOnce(result([row('restored')]));
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await view.findByText(/搜尋結果已清除/);
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(view.queryByLabelText('載入更多歷史貼文')).toBeNull();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 restored');
  expect(search).toHaveBeenLastCalledWith('pu', '二手書', null);
});

test('issues only one request on repeated submission while pending', async () => {
  const pending = deferred<TitleSearchPage>(); search.mockReturnValueOnce(pending.promise);
  const view = panel(); enter(view);
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  fireEvent(view.getByLabelText('記得的標題開頭'), 'submitEditing');
  expect(search).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('搜尋歷史標題').props.accessibilityState.busy).toBe(true);
  await act(async () => pending.resolve(result()));
  expect(view.getByText('二手書 one')).toBeTruthy();
});

test.each(['resolve', 'reject'] as const)('ignores a late %s after changing the query', async (outcome) => {
  const old = deferred<TitleSearchPage>(); search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result([row('new', '租屋資訊')]));
  const view = panel(); enter(view);
  enter(view, '租屋'); await view.findByText('租屋資訊');
  await act(async () => outcome === 'resolve' ? old.resolve(result()) : old.reject({ code: 'permission-denied' }));
  expect(view.getByText('租屋資訊')).toBeTruthy();
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(view.queryByText(/搜尋結果已清除/)).toBeNull();
});

test('clear invalidates an in-flight page and retains an editable named input', async () => {
  const old = deferred<TitleSearchPage>(); search.mockReturnValueOnce(old.promise);
  const view = panel(); enter(view); fireEvent.press(view.getByLabelText('清除歷史搜尋'));
  await act(async () => old.resolve(result()));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('');
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(search).toHaveBeenCalledTimes(1);
});

test.each(['account', 'school', 'sign-out', 'loading'])('closes the modal and ignores old results after %s changes', async (scope) => {
  const old = deferred<TitleSearchPage>(); search.mockReturnValueOnce(old.promise);
  const onOpenPost = jest.fn();
  const view = render(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  fireEvent.press(view.getByLabelText('找舊貼文')); enter(view);
  if (scope === 'account') mockUser = { uid: 'bob' };
  if (scope === 'school') mockSchool = 'other';
  if (scope === 'sign-out') mockUser = null;
  if (scope === 'loading') mockLoading = true;
  view.rerender(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  await act(async () => old.resolve(result()));
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(onOpenPost).not.toHaveBeenCalled();
});

test('native back dismissal invalidates pending work and reopening starts fresh', async () => {
  const old = deferred<TitleSearchPage>(); search.mockReturnValueOnce(old.promise);
  const view = render(<TitleHistoryLauncher onOpenPost={jest.fn()} />);
  fireEvent.press(view.getByLabelText('找舊貼文')); enter(view);
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  await act(async () => old.resolve(result()));
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('');
  expect(view.queryByText('二手書 one')).toBeNull();
});

test('the actual community entry opens history and routes a result without replacing the timeline', async () => {
  const navigate = jest.fn(); const view = render(<CommunityScreen navigation={{ navigate }} />);
  const timeline = view.getByText('原動態保留');
  fireEvent.press(view.getByLabelText('找舊貼文')); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('PostDetail', { postId: 'one', schoolId: 'pu' }));
  expect(view.getByText('原動態保留')).toBe(timeline);
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
});

test('a confirmed empty page has an explicit empty state', async () => {
  search.mockResolvedValueOnce(result([])); const view = panel(); enter(view);
  expect(await view.findByText('沒有符合這個標題開頭的貼文。')).toBeTruthy();
});


test('a deleted historical result stays in search and is removed after server confirmation', async () => {
  confirmOpen.mockResolvedValueOnce(false);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await view.findByText(/這篇貼文已刪除或不再提供/);
  expect(view.open).not.toHaveBeenCalled();
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(view.getByLabelText('記得的標題開頭')).toBeTruthy();
});

test('an offline confirmation retains the search and can open on the next tap', async () => {
  confirmOpen.mockRejectedValueOnce({ code: 'unavailable' }).mockResolvedValueOnce(true);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await view.findByText(/暫時無法向伺服器確認/);
  expect(view.open).not.toHaveBeenCalled();
  expect(view.getByText('二手書 one')).toBeTruthy();
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(view.open).toHaveBeenCalledTimes(1));
  expect(confirmOpen).toHaveBeenCalledTimes(2);
});

test('allows next-page reading after an offline post check without restarting the history search', async () => {
  const first = result([row('one')], true);
  search.mockResolvedValueOnce(first).mockResolvedValueOnce(result([row('two')]));
  confirmOpen.mockRejectedValueOnce({ code: 'unavailable' });
  const view = panel(); enter(view);
  await view.findByText('二手書 one');

  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await view.findByText(/暫時無法向伺服器確認/);
  expect(view.open).not.toHaveBeenCalled();
  expect(view.getByText('二手書 one')).toBeTruthy();
  // A failed post-open verification is not a failed page query. Students
  // must still be able to continue from their current successful cursor.
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await view.findByText('二手書 two');
  expect(search).toHaveBeenCalledTimes(2);
  expect(search).toHaveBeenLastCalledWith('pu', '二手書', first.nextCursor);
  expect(view.getByText('二手書 one')).toBeTruthy();
  expect(confirmOpen).toHaveBeenCalledTimes(1);
});

test('permission withdrawal during opening clears results and restarts search at page one', async () => {
  confirmOpen.mockRejectedValueOnce({ code: 'permission-denied' });
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await view.findByText(/搜尋結果已清除/);
  expect(view.open).not.toHaveBeenCalled();
  expect(view.queryByText('二手書 one')).toBeNull();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 one');
  expect(search).toHaveBeenLastCalledWith('pu', '二手書', null);
});

test('changing the query invalidates a late confirmation without navigating', async () => {
  const pending = deferred<boolean>(); confirmOpen.mockReturnValueOnce(pending.promise);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '租屋');
  await act(async () => pending.resolve(true));
  expect(view.open).not.toHaveBeenCalled();
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('租屋');
});


test('returning from a historical detail restores the scoped title query without reusing stale result cards', async () => {
  const navigate = jest.fn();
  const view = render(<TitleHistoryLauncher onOpenPost={navigate} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  enter(view, '二手書');
  await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' }));
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();

  // The detail screen goes back to the existing community stack entry.
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
  expect(view.queryByText('二手書 one')).toBeNull();
  expect(search).toHaveBeenCalledTimes(1);
  expect(view.getByText(/重新搜尋.*確認/)).toBeTruthy();
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  await view.findByText('二手書 one');
  expect(search).toHaveBeenCalledTimes(2);
});

test('explicitly closing a historical search discards its draft instead of restoring it', async () => {
  const view = render(<TitleHistoryLauncher onOpenPost={jest.fn()} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '租屋');
  fireEvent.press(view.getByLabelText('關閉歷史搜尋'));
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('');
  expect(search).not.toHaveBeenCalled();
});


test('a revoked membership while a next page is pending must leave the first-page retry usable', async () => {
  const pending = deferred<TitleSearchPage>();
  const first = result([row('one')], true);
  search.mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(result([row('restored')]));
  confirmOpen.mockRejectedValueOnce({ code: 'permission-denied' });
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  expect(search).toHaveBeenCalledTimes(2);
  try {
    // A result from the first page remains tappable while the next page is loading.
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    await view.findByText(/搜尋結果已清除/);
    expect(view.open).not.toHaveBeenCalled();
    expect(view.queryByText('二手書 one')).toBeNull();
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
  } finally {
    await act(async () => pending.resolve(result([row('late')])));
  }
  expect(view.queryByText('二手書 late')).toBeNull();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 restored');
  expect(search).toHaveBeenLastCalledWith('pu', '二手書', null);
});

test('a deleted post during unfinished pagination preserves the exact next-page retry', async () => {
  const first = result([row('one')], true);
  const pending = deferred<TitleSearchPage>();
  search.mockResolvedValueOnce(first).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(result([row('two')]));
  confirmOpen.mockResolvedValueOnce(false);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  expect(search).toHaveBeenCalledTimes(2);
  try {
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    await view.findByText(/這篇貼文已刪除或不再提供/);
    expect(view.open).not.toHaveBeenCalled();
    expect(view.queryByText('二手書 one')).toBeNull();
    // The deleted card is gone, but its interrupted next-page cursor must be retryable.
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
  } finally {
    await act(async () => pending.resolve(result([row('late')])));
  }
  expect(view.queryByText('二手書 late')).toBeNull();
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 two');
  expect(search.mock.calls[2]).toEqual(search.mock.calls[1]);
});

test('offline post confirmation during a pending next page offers both post and page recovery', async () => {
  const pending = deferred<TitleSearchPage>();
  search.mockResolvedValueOnce(result([row('one')], true))
    .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(result([row('two')]));
  confirmOpen.mockRejectedValueOnce({ code: 'unavailable' }).mockResolvedValueOnce(true);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  try {
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    await view.findByText(/暫時無法向伺服器確認/);
    expect(view.open).not.toHaveBeenCalled();
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
  } finally {
    await act(async () => pending.resolve(result([row('late')])));
  }
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 two');
  expect(search.mock.calls[2]).toEqual(search.mock.calls[1]);
  expect(view.queryByText('二手書 late')).toBeNull();
});


test('a stalled first-page request releases the native search and a late denied reply cannot clear a successful retry', async () => {
  const stalled = deferred<TitleSearchPage>();
  search.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce(result([row('fresh')]));
  const view = panel();
  jest.useFakeTimers();
  try {
    enter(view);
    expect(view.getByLabelText('搜尋歷史標題').props.accessibilityState.busy).toBe(true);
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
    expect(view.getByLabelText('搜尋歷史標題').props.accessibilityState.busy).toBe(false);
    fireEvent.press(view.getByLabelText('重試歷史搜尋'));
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('二手書 fresh')).toBeTruthy();
    await act(async () => { stalled.reject({ code: 'permission-denied' }); });
    expect(view.getByText('二手書 fresh')).toBeTruthy();
    expect(view.queryByText(/搜尋結果已清除/)).toBeNull();
    expect(search.mock.calls[1]).toEqual(['pu', '二手書', null]);
  } finally { jest.useRealTimers(); }
});

test('a stalled native next page keeps its exact cursor and existing posts through retry', async () => {
  const first = result([row('one')], true);
  const stalled = deferred<TitleSearchPage>();
  search.mockResolvedValueOnce(first).mockReturnValueOnce(stalled.promise)
    .mockResolvedValueOnce(result([row('two')]));
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  jest.useFakeTimers();
  try {
    fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
    expect(view.getByText('二手書 one')).toBeTruthy();
    fireEvent.press(view.getByLabelText('重試歷史搜尋'));
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('二手書 two')).toBeTruthy();
    expect(search.mock.calls[2]).toEqual(search.mock.calls[1]);
    await act(async () => { stalled.resolve(result([row('late')])); });
    expect(view.queryByText('二手書 late')).toBeNull();
  } finally { jest.useRealTimers(); }
});

test('a stalled native resume retries the same anchor without showing cached search rows', async () => {
  const stalled = deferred<TitleSearchPage>();
  resume.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce(result([row('one')]));
  const view = render(<TitleHistorySearch schoolId="pu" initialQuery="二手書" initialPostId="one"
    onClose={jest.fn()} onOpenPost={jest.fn()} />);
  jest.useFakeTimers();
  try {
    fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
    expect(view.queryByText('二手書 one')).toBeNull();
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByLabelText('重試歷史搜尋')).toBeTruthy();
    fireEvent.press(view.getByLabelText('重試歷史搜尋'));
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('二手書 one')).toBeTruthy();
    expect(resume.mock.calls).toEqual([['pu', '二手書', 'one'], ['pu', '二手書', 'one']]);
    await act(async () => { stalled.reject({ code: 'permission-denied' }); });
    expect(view.getByText('二手書 one')).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

test('a stalled post-opening verification releases the panel and a late revoked reply cannot erase a successful retry', async () => {
  const stalled = deferred<boolean>();
  confirmOpen.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce(true);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  jest.useFakeTimers();
  try {
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    expect(view.getByLabelText('正在確認貼文仍可閱讀')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(7_000); });
    expect(view.getByText(/確認貼文逾時/)).toBeTruthy();
    expect(view.getByText('二手書 one')).toBeTruthy();
    expect(view.queryByLabelText('正在確認貼文仍可閱讀')).toBeNull();
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    await act(async () => { await Promise.resolve(); });
    expect(view.open).toHaveBeenCalledTimes(1);
    expect(view.open).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' });
    await act(async () => { stalled.reject({ code: 'permission-denied' }); });
    expect(view.open).toHaveBeenCalledTimes(1);
    expect(view.queryByText(/搜尋結果已清除/)).toBeNull();
    expect(confirmOpen).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});

test('a stalled post verification during interrupted pagination keeps the cursor retry usable', async () => {
  const first = result([row('one')], true);
  const unfinishedPage = deferred<TitleSearchPage>();
  const unfinishedOpen = deferred<boolean>();
  search.mockResolvedValueOnce(first).mockReturnValueOnce(unfinishedPage.promise)
    .mockResolvedValueOnce(result([row('two')]));
  confirmOpen.mockReturnValueOnce(unfinishedOpen.promise);
  const view = panel(); enter(view); await view.findByText('二手書 one');
  jest.useFakeTimers();
  try {
    fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
    fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
    act(() => { jest.advanceTimersByTime(7_000); });
    expect(view.getByText(/確認貼文逾時/)).toBeTruthy();
    fireEvent.press(view.getByLabelText('重試歷史搜尋'));
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('二手書 two')).toBeTruthy();
    expect(search.mock.calls[2]).toEqual(search.mock.calls[1]);
    await act(async () => {
      unfinishedPage.resolve(result([row('stale')]));
      unfinishedOpen.resolve(true);
    });
    expect(view.open).not.toHaveBeenCalled();
    expect(view.queryByText('二手書 stale')).toBeNull();
  } finally { jest.useRealTimers(); }
});


test('keeps native history input, retry and results in one scroll surface above the bottom safe area', async () => {
  // Regression for short viewports / larger system text: fixed search controls
  // previously left the separate result list with no usable viewport.
  mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
  search.mockRejectedValueOnce({ code: 'unavailable' }).mockResolvedValueOnce(result());
  const view = panel();
  const list = view.UNSAFE_getByType(FlatList);
  expect(list.props.ListHeaderComponent).toBeTruthy();
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
  expect(StyleSheet.flatten(list.props.contentContainerStyle)?.paddingBottom).toBe(50);

  enter(view);
  await view.findByLabelText('重試歷史搜尋');
  fireEvent.press(view.getByLabelText('重試歷史搜尋'));
  await view.findByText('二手書 one');
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
});

test('iOS screen reader announces a successful historical search count without speaking a post title', async () => {
  const previousOS = Platform.OS;
  Platform.OS = 'ios';
  const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  try {
    const view = panel();
    enter(view);
    await view.findByText('二手書 one');
    await waitFor(() => expect(spoken).toHaveBeenCalledWith('已讀到本次搜尋的最後一頁。 目前顯示 1 篇。'));
    expect(spoken).not.toHaveBeenCalledWith(expect.stringContaining('二手書 one'));
  } finally {
    spoken.mockRestore();
    Platform.OS = previousOS;
  }
});

test('iOS screen reader announces revoked history access but ignores a late outdated result', async () => {
  const previousOS = Platform.OS;
  Platform.OS = 'ios';
  const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const outdated = deferred<TitleSearchPage>();
  search.mockReturnValueOnce(outdated.promise).mockRejectedValueOnce({ code: 'permission-denied' });
  try {
    const view = panel();
    enter(view);
    fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '二手書 ');
    fireEvent.press(view.getByLabelText('搜尋歷史標題'));
    await view.findByText('校籍或存取權限已變更，搜尋結果已清除。確認校籍後可重試搜尋。');
    await waitFor(() => expect(spoken).toHaveBeenCalledWith('校籍或存取權限已變更，搜尋結果已清除。確認校籍後可重試搜尋。'));
    const count = spoken.mock.calls.length;
    await act(async () => { outdated.resolve(result([row('outdated')])); });
    expect(spoken).toHaveBeenCalledTimes(count);
    expect(view.queryByText('二手書 outdated')).toBeNull();
  } finally {
    spoken.mockRestore();
    Platform.OS = previousOS;
  }
});


test('a confirmed post whose native navigation throws stays retryable without a false reading position', async () => {
  const onOpenPost = jest.fn().mockImplementationOnce(() => { throw new Error('native router unavailable'); });
  const remember = jest.fn();
  const view = render(<TitleHistorySearch schoolId="pu" onClose={jest.fn()} onOpenPost={onOpenPost} onRememberQuery={remember} />);
  enter(view);
  await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  expect(await view.findByText(/貼文已通過伺服器確認.*頁面開啟失敗/)).toBeTruthy();
  expect(remember).not.toHaveBeenCalled();
  expect(view.getByText('二手書 one')).toBeTruthy();
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(onOpenPost).toHaveBeenCalledTimes(2));
  expect(confirmOpen).toHaveBeenCalledTimes(2);
  expect(remember).toHaveBeenCalledWith('二手書', 'one');
});

test('missing community stack navigation never counts as a successful reading', async () => {
  // The actual CommunityScreen used to silently optional-chain navigate().
  // Authorization succeeded but no detail opened, and the modal still closed.
  const view = render(<CommunityScreen />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  enter(view);
  await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  expect(await view.findByText(/貼文已通過伺服器確認.*頁面開啟失敗/)).toBeTruthy();
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
  expect(confirmOpen).toHaveBeenCalledTimes(1);

  // Restoring the genuine stack navigator allows a fresh server check and a
  // successful detail route without saving a false previous-reading marker.
  const navigate = jest.fn();
  view.rerender(<CommunityScreen navigation={{ navigate }} />);
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('PostDetail', { postId: 'one', schoolId: 'pu' }));
  expect(confirmOpen).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
  expect(view.getByLabelText('回到上次閱讀位置')).toBeTruthy();
});

test('a thrown community navigation keeps native history open for a retry', async () => {
  const navigate = jest.fn().mockImplementationOnce(() => { throw new Error('native router unavailable'); });
  const view = render(<TitleHistoryLauncher onOpenPost={navigate} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  enter(view);
  await view.findByText('二手書 one');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  expect(await view.findByText(/貼文已通過伺服器確認.*頁面開啟失敗/)).toBeTruthy();
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 one'));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('二手書');
  expect(view.getByLabelText('回到上次閱讀位置')).toBeTruthy();
});


test('warns before searching an overlong native title, but accepts 80 Unicode code points', async () => {
  const view = panel();
  const field = view.getByLabelText('記得的標題開頭');
  fireEvent.changeText(field, 'a'.repeat(81));
  expect(view.getByText('標題開頭最多 80 字，請刪減後搜尋。')).toBeTruthy();
  expect(search).not.toHaveBeenCalled();
  fireEvent.changeText(field, '😀'.repeat(80));
  expect(view.queryByText('標題開頭最多 80 字，請刪減後搜尋。')).toBeNull();
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  await waitFor(() => expect(search).toHaveBeenCalledWith('pu', '😀'.repeat(80), null));
});

test('iOS VoiceOver announces an overlong title exactly once per invalid entry without speaking the draft', async () => {
  const previousOS = Platform.OS;
  Platform.OS = 'ios';
  const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  const warning = '標題開頭最多 80 字，請刪減後搜尋。';
  try {
    const view = panel();
    const field = view.getByLabelText('記得的標題開頭');
    fireEvent.changeText(field, 'a'.repeat(81));
    expect(view.getByText(warning)).toBeTruthy();
    await waitFor(() => expect(spoken).toHaveBeenCalledWith(warning));
    const count = spoken.mock.calls.length;
    fireEvent.changeText(field, 'a'.repeat(82));
    expect(spoken).toHaveBeenCalledTimes(count);
    expect(spoken.mock.calls.flat().join(' ')).not.toContain('a'.repeat(81));

    fireEvent.changeText(field, '😀'.repeat(80));
    expect(view.queryByText(warning)).toBeNull();
    fireEvent.changeText(field, '😀'.repeat(81));
    await waitFor(() => expect(spoken).toHaveBeenCalledTimes(count + 1));
  } finally {
    spoken.mockRestore();
    Platform.OS = previousOS;
  }
});
