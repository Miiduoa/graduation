import React from 'react';
import { Modal } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TitleHistoryLauncher, TitleHistorySearch } from '../screens/social/TitleHistorySearch';
import { CommunityScreen } from '../screens/CommunityScreen';
import { searchCampusPostTitles, type TitleSearchPage, type TitleSearchPost, type TitleSearchCursor } from '../services/titleSearch';

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = 'pu';
let mockLoading = false;
let mockDemo = false;
let mockFirebaseMock = false;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => mockFirebaseMock }));
jest.mock('../services/demoSession', () => ({ isDemoUid: () => mockDemo }));
jest.mock('../ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (factory: () => unknown) => factory() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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
}));
const search = jest.mocked(searchCampusPostTitles);
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
  search.mockReset().mockResolvedValue(result());
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
  expect(view.open).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' });
});

test('opening the same historical result twice rapidly navigates only once', async () => {
  const view = panel(); enter(view);
  await view.findByText('二手書 one');
  const target = view.getByLabelText('開啟貼文：二手書 one');
  fireEvent.press(target);
  fireEvent.press(target);
  expect(view.open).toHaveBeenCalledTimes(1);
  expect(view.open).toHaveBeenCalledWith({ id: 'one', schoolId: 'pu' });
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
  expect(navigate).toHaveBeenCalledWith('PostDetail', { postId: 'one' });
  expect(view.getByText('原動態保留')).toBe(timeline);
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
});

test('a confirmed empty page has an explicit empty state', async () => {
  search.mockResolvedValueOnce(result([])); const view = panel(); enter(view);
  expect(await view.findByText('沒有符合這個標題開頭的貼文。')).toBeTruthy();
});
