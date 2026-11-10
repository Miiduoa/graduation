import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, getStateFromPath } from '@react-navigation/native';
import { rewriteLegacyShopsPath, socialPostHttpsPrefixes } from '../app/legacyShopsPath';
import { preAuthLinking } from '../app/preAuthLinking';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RefreshControl, Text } from 'react-native';
import { PostDetailScreen } from '../screens/social/PostDetailScreen';
import { getCampusPostById } from '../services/feed';
import { listCampusReplies } from '../services/threads';

let mockIncomingInitialURL: string | null = null;
let mockPublicLinkListener: ((event: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  createURL: () => 'campus://',
  getInitialURL: jest.fn(async () => mockIncomingInitialURL),
  addEventListener: jest.fn((_type: string, handler: (event: { url: string }) => void) => {
    mockPublicLinkListener = handler;
    return { remove: jest.fn() };
  }),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { release: { deepLinkHost: 'nuni.tw' } } } },
}));

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchoolId = 'pu';
let mockAuthLoading = false;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockAuthLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../firebase', () => ({ getDb: () => ({}), isFirebaseMockMode: () => false }));
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: ({ uid }: { uid: string | null }) => !uid,
  isDemoUid: () => false,
}));
jest.mock('../ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (factory: () => unknown) => factory() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/feed', () => ({
  getCampusPostById: jest.fn(), toggleCampusPostLike: jest.fn(), updateCampusPost: jest.fn(), deleteCampusPost: jest.fn(),
}));
jest.mock('../services/threads', () => ({
  listCampusReplies: jest.fn(), addCampusReply: jest.fn(), softDeleteCampusReply: jest.fn(),
}));
jest.mock('../services/aliasService', () => ({ getOrCreateBoardAlias: jest.fn() }));
jest.mock('../services/memberDirectory', () => ({ fetchSchoolDirectoryProfiles: jest.fn(async () => []) }));
jest.mock('../services/reportSystem', () => ({ submitCampusReport: jest.fn() }));
jest.mock('../services/campusPostBookmarks', () => ({
  isCampusPostBookmarked: jest.fn(async () => false),
  saveCampusPostBookmark: jest.fn(), removeCampusPostBookmark: jest.fn(),
}));
jest.mock('../utils/campusReplyThread', () => ({ flattenCampusRepliesThread: (rows: unknown[]) => rows }));

const read = jest.mocked(getCampusPostById);
const replies = jest.mocked(listCampusReplies);
const row = (schoolId = 'pu', title = '舊學期的二手書') => ({
  id: 'old-1', schoolId, boardId: 'general', anonymous: true, title, content: '只限本校閱讀的內容',
});
const error = (code: string) => Object.assign(new Error(code), { code });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function screen() {
  const goBack = jest.fn();
  const view = render(<PostDetailScreen route={{ params: { postId: 'old-1' } }}
    navigation={{ goBack, setOptions: jest.fn() }} />);
  return { ...view, goBack };
}
function refresh(view: ReturnType<typeof screen>) {
  return act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' }; mockSchoolId = 'pu'; mockAuthLoading = false;
  read.mockReset().mockResolvedValue(row());
  replies.mockReset().mockResolvedValue([]);
});

test('a deleted detail gives an accessible route back instead of a dead end', async () => {
  read.mockResolvedValueOnce(null);
  const view = screen();
  await view.findByText('找不到貼文，可能已被刪除。');
  fireEvent.press(view.getByLabelText('返回校園社群'));
  expect(view.goBack).toHaveBeenCalledTimes(1);
});

test('an unavailable first read is not misreported as deleted and can retry', async () => {
  read.mockRejectedValueOnce(error('unavailable')).mockResolvedValueOnce(row());
  const view = screen();
  await view.findByText('目前無法連線確認貼文，請重試。');
  expect(view.queryByText('找不到貼文，可能已被刪除。')).toBeNull();
  fireEvent.press(view.getByLabelText('重新載入貼文詳情'));
  await view.findByText('舊學期的二手書');
});

test('a revoked member cannot keep viewing previously loaded detail on refresh', async () => {
  read.mockResolvedValueOnce(row()).mockRejectedValueOnce(error('permission-denied'));
  const view = screen();
  await view.findByText('舊學期的二手書');
  await refresh(view);
  expect(view.queryByText('舊學期的二手書')).toBeNull();
  expect(view.getByText('校籍或貼文權限已變更，無法查看這篇貼文。')).toBeTruthy();
  expect(view.getByLabelText('返回校園社群')).toBeTruthy();
});

test('offline refresh preserves the already visible post and offers explicit retry', async () => {
  read.mockResolvedValueOnce(row()).mockRejectedValueOnce(error('unavailable'))
    .mockResolvedValueOnce(row('pu', '更新後的二手書'));
  const view = screen();
  await view.findByText('舊學期的二手書');
  await refresh(view);
  expect(view.getByText('舊學期的二手書')).toBeTruthy();
  expect(view.getByText('暫時無法確認貼文最新狀態，仍顯示先前讀取的內容。')).toBeTruthy();
  fireEvent.press(view.getByLabelText('重新載入貼文詳情'));
  await view.findByText('更新後的二手書');
});

test('changing school while a read is pending never displays the old school response', async () => {
  const old = deferred<ReturnType<typeof row>>();
  read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(row('other', '另一所學校貼文'));
  const view = screen();
  mockSchoolId = 'other';
  view.rerender(<PostDetailScreen route={{ params: { postId: 'old-1' } }}
    navigation={{ goBack: view.goBack, setOptions: jest.fn() }} />);
  await view.findByText('另一所學校貼文');
  await act(async () => old.resolve(row('pu', '舊校不得顯示')));
  expect(view.queryByText('舊校不得顯示')).toBeNull();
});

test('auth revalidation immediately hides already displayed school detail', async () => {
  const view = screen();
  await view.findByText('舊學期的二手書');
  mockAuthLoading = true;
  view.rerender(<PostDetailScreen route={{ params: { postId: 'old-1' } }}
    navigation={{ goBack: view.goBack, setOptions: jest.fn() }} />);
  expect(view.queryByText('舊學期的二手書')).toBeNull();
  expect(view.getByText('正在確認登入狀態…')).toBeTruthy();
});


test('a stalled first detail server read releases loading at 15 seconds and an old reply cannot replace retry', async () => {
  const stalled = deferred<ReturnType<typeof row> | null>();
  read.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce(row('pu', '重新確認成功的二手書'));
  jest.useFakeTimers();
  try {
    const view = screen();
    expect(view.queryByLabelText('重新載入貼文詳情')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(view.getByText('目前無法連線確認貼文，請重試。')).toBeTruthy();
    fireEvent.press(view.getByLabelText('重新載入貼文詳情'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByText('重新確認成功的二手書')).toBeTruthy();
    await act(async () => { stalled.resolve(null); });
    expect(view.getByText('重新確認成功的二手書')).toBeTruthy();
    expect(view.queryByText('找不到貼文，可能已被刪除。')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});

test('a stalled detail refresh can finish with retry and ignores late permission rejection', async () => {
  const stalled = deferred<ReturnType<typeof row> | null>();
  read.mockResolvedValueOnce(row()).mockReturnValueOnce(stalled.promise)
    .mockResolvedValueOnce(row('pu', '刷新後的新內容'));
  const view = screen();
  await view.findByText('舊學期的二手書');
  jest.useFakeTimers();
  try {
    // Do not await the stalled refresh: a student needs an independent recovery path.
    void view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    await act(async () => { jest.advanceTimersByTime(15_000); await Promise.resolve(); });
    expect(view.getByText('暫時無法確認貼文最新狀態，仍顯示先前讀取的內容。')).toBeTruthy();
    fireEvent.press(view.getByLabelText('重新載入貼文詳情'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByText('刷新後的新內容')).toBeTruthy();
    await act(async () => { stalled.reject(error('permission-denied')); });
    expect(view.getByText('刷新後的新內容')).toBeTruthy();
    expect(view.queryByText('校籍或貼文權限已變更，無法查看這篇貼文。')).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  } finally { jest.useRealTimers(); }
});


test('renders the confirmed post before replies finish, then retries a stalled reply read without stale denial', async () => {
  const stalled = deferred<Awaited<ReturnType<typeof listCampusReplies>>>();
  replies.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce([
    { id: 'reply-1', schoolId: 'pu', postId: 'old-1', anonymous: true, content: '有補充的二手書資訊' },
  ] as Awaited<ReturnType<typeof listCampusReplies>>);
  jest.useFakeTimers();
  try {
    const view = screen();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByText('舊學期的二手書')).toBeTruthy();
    expect(view.getByText('正在載入留言…')).toBeTruthy();
    expect(view.queryByText('尚無留言，當第一人吧。')).toBeNull();
    act(() => { jest.advanceTimersByTime(15_000); });
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('留言暫時無法載入，貼文仍可閱讀。')).toBeTruthy();
    fireEvent.press(view.getByLabelText('重試留言'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(view.getByText('有補充的二手書資訊')).toBeTruthy();
    expect(replies).toHaveBeenCalledTimes(2);
    await act(async () => { stalled.reject(error('permission-denied')); });
    expect(view.getByText('舊學期的二手書')).toBeTruthy();
    expect(view.getByText('有補充的二手書資訊')).toBeTruthy();
    expect(view.queryByText('校籍或貼文權限已變更，無法查看這篇貼文。')).toBeNull();
  } finally { jest.useRealTimers(); }
});

test('offline reply fetch is not reported as an empty discussion while the main post stays readable', async () => {
  replies.mockRejectedValueOnce(error('unavailable'));
  const view = screen();
  await view.findByText('舊學期的二手書');
  expect(await view.findByText('留言暫時無法載入，貼文仍可閱讀。')).toBeTruthy();
  expect(view.queryByText('尚無留言，當第一人吧。')).toBeNull();
  expect(view.getByLabelText('重試留言')).toBeTruthy();
});

test('a server rejection of replies still revokes the whole post instead of showing comments', async () => {
  replies.mockRejectedValueOnce(error('permission-denied'));
  const view = screen();
  await view.findByText('校籍或貼文權限已變更，無法查看這篇貼文。');
  expect(view.queryByText('舊學期的二手書')).toBeNull();
  expect(view.queryByLabelText('重試留言')).toBeNull();
});


test('a historical route refuses the same post ID when current campus differs from the searched campus', async () => {
  mockSchoolId = 'other';
  read.mockResolvedValueOnce(row('other', '其他學校同 ID 的文章'));
  const goBack = jest.fn();
  const route = { params: { postId: 'old-1', schoolId: 'pu' } };
  const navigation = { goBack, setOptions: jest.fn() };
  const view = render(<PostDetailScreen route={route} navigation={navigation} />);
  expect(view.getByText('搜尋文章的學校已切換，請返回校園社群重新搜尋。')).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
  expect(view.queryByText('其他學校同 ID 的文章')).toBeNull();
  fireEvent.press(view.getByLabelText('返回校園社群'));
  expect(goBack).toHaveBeenCalledTimes(1);
});

test('switching schools after historical detail rendered hides the old post and blocks a new-school same-ID read', async () => {
  read.mockResolvedValueOnce(row('pu', '靜宜學生的文章'))
    .mockResolvedValueOnce(row('other', '別校同 ID 的文章'));
  const route = { params: { postId: 'old-1', schoolId: 'pu' } };
  const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
  const view = render(<PostDetailScreen route={route} navigation={navigation} />);
  await view.findByText('靜宜學生的文章');
  expect(read).toHaveBeenCalledTimes(1);
  mockSchoolId = 'other';
  view.rerender(<PostDetailScreen route={route} navigation={navigation} />);
  expect(view.getByText('搜尋文章的學校已切換，請返回校園社群重新搜尋。')).toBeTruthy();
  expect(view.queryByText('靜宜學生的文章')).toBeNull();
  await act(async () => { await Promise.resolve(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(view.queryByText('別校同 ID 的文章')).toBeNull();
});

const ActualSocialStack = createNativeStackNavigator<any, undefined>();
function ActualCommunityDestination() {
  return <Text>回到校園社群列表</Text>;
}
async function coldOpenedPost(params: { postId: string; schoolId: string }) {
  const nav = createNavigationContainerRef<any>();
  const view = render(
    <NavigationContainer ref={nav}>
      <ActualSocialStack.Navigator id={undefined} initialRouteName="PostDetail">
        <ActualSocialStack.Screen name="PostDetail" component={PostDetailScreen} initialParams={params} />
        <ActualSocialStack.Screen name="CampusSocialScreen" component={ActualCommunityDestination} />
      </ActualSocialStack.Navigator>
    </NavigationContainer>,
  );
  await waitFor(() => expect(nav.isReady()).toBe(true));
  return { ...view, nav };
}

test('an external cold-start link to a deleted post returns to Community via the actual native stack', async () => {
  read.mockResolvedValueOnce(null);
  const view = await coldOpenedPost({ postId: 'old-1', schoolId: 'pu' });
  await view.findByText('找不到貼文，可能已被刪除。');
  expect(view.nav.canGoBack()).toBe(false);
  fireEvent.press(view.getByLabelText('返回校園社群'));
  expect(await view.findByText('回到校園社群列表')).toBeTruthy();
  expect(view.nav.getCurrentRoute()?.name).toBe('CampusSocialScreen');
  expect(view.nav.canGoBack()).toBe(false);
});

test('an external cold-start link to another campus never reads the same ID and can return to Community', async () => {
  mockSchoolId = 'other';
  const view = await coldOpenedPost({ postId: 'old-1', schoolId: 'pu' });
  expect(view.getByText('搜尋文章的學校已切換，請返回校園社群重新搜尋。')).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
  expect(view.nav.canGoBack()).toBe(false);
  fireEvent.press(view.getByLabelText('返回校園社群'));
  expect(await view.findByText('回到校園社群列表')).toBeTruthy();
  expect(view.nav.getCurrentRoute()?.name).toBe('CampusSocialScreen');
  expect(view.nav.canGoBack()).toBe(false);
});


test('a canonical shared HTTPS post path becomes the native PostDetail route with its original campus', () => {
  const path = rewriteLegacyShopsPath('community/post/old-1?schoolId=pu&utm_source=share');
  expect(path).toBe('post/old-1?schoolId=pu');
  const state = getStateFromPath(path, {
    screens: { Today: { screens: { PostDetail: 'post/:postId', CampusSocialScreen: 'community' } } },
  });
  expect(state?.routes[0]?.state?.routes[0]).toMatchObject({
    name: 'PostDetail',
    params: { postId: 'old-1', schoolId: 'pu' },
  });
});

test('a shared post path without a single valid school is not reinterpreted as current-campus content', () => {
  for (const path of [
    'community/post/old-1',
    'community/post/old-1?schoolId=pu&schoolId=other',
    'community/post/old-1?schoolId=',
    'community/post/%2Fsecret?schoolId=pu',
  ]) {
    expect(rewriteLegacyShopsPath(path)).toBe(path);
  }
});


test('only the release-configured HTTPS app-link host is eligible for native shared-post routing', () => {
  expect(socialPostHttpsPrefixes('nuni.tw')).toEqual(['https://nuni.tw']);
  expect(socialPostHttpsPrefixes('NUNI.TW')).toEqual(['https://nuni.tw']);
  expect(socialPostHttpsPrefixes(null)).toEqual([]);
  expect(socialPostHttpsPrefixes('https://nuni.tw')).toEqual([]);
  expect(socialPostHttpsPrefixes('nuni.tw.evil.test/path')).toEqual([]);
  expect(socialPostHttpsPrefixes('nuni.tw:443')).toEqual([]);
});

test('canonical share parser does not change normal native post paths or unrelated URLs', () => {
  expect(rewriteLegacyShopsPath('post/old-1?schoolId=pu')).toBe('post/old-1?schoolId=pu');
  expect(rewriteLegacyShopsPath('community/poster/old-1?schoolId=pu')).toBe('community/poster/old-1?schoolId=pu');
  expect(rewriteLegacyShopsPath('community/post/old-1?schoolId=pu#fragment')).toBe('community/post/old-1?schoolId=pu#fragment');
});


test('a signed-out cold HTTPS post share waits for school login instead of being dropped', async () => {
  const incoming = 'https://nuni.tw/community/post/old-1?schoolId=pu&utm_source=share';
  mockIncomingInitialURL = incoming;
  const publicInitial = await preAuthLinking.getInitialURL?.();
  expect(publicInitial).toBeNull();
  const { takePendingSharedPostLink } = require('../app/pendingSharedPostLink');
  expect(takePendingSharedPostLink()).toBe('https://nuni.tw/community/post/old-1?schoolId=pu');
  expect(takePendingSharedPostLink()).toBeNull();
  mockIncomingInitialURL = null;
});

test('a signed-out warm post share is retained once without opening a private screen in public navigation', () => {
  const delivered = jest.fn();
  const subscription = preAuthLinking.subscribe?.(delivered);
  mockPublicLinkListener?.({ url: 'https://nuni.tw/community/post/old-2?schoolId=pu&utm_campaign=mobile' });
  expect(delivered).not.toHaveBeenCalled();
  const { takePendingSharedPostLink } = require('../app/pendingSharedPostLink');
  expect(takePendingSharedPostLink()).toBe('https://nuni.tw/community/post/old-2?schoolId=pu');
  expect(takePendingSharedPostLink()).toBeNull();
  subscription?.();
});

test('public entry rejects untrusted, ambiguous and expired shared posts while preserving normal public links', () => {
  const { stagePendingSharedPostLink, takePendingSharedPostLink, clearPendingSharedPostLink } =
    require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  expect(stagePendingSharedPostLink('https://nuni.tw/community/post/old-3?schoolId=pu', 'nuni.tw', 1000)).toBe(true);
  expect(takePendingSharedPostLink(1000 + 10 * 60 * 1000 + 1)).toBeNull();
  for (const url of [
    'https://nuni.tw.evil.test/community/post/old-3?schoolId=pu',
    'http://nuni.tw/community/post/old-3?schoolId=pu',
    'https://nuni.tw/community/post/old-3',
    'https://nuni.tw/community/post/old-3?schoolId=pu&schoolId=other',
    'https://nuni.tw/community/post/%2Fsecret?schoolId=pu',
    'https://nuni.tw/community/post/old-3?schoolId=pu#fragment',
  ]) {
    expect(stagePendingSharedPostLink(url, 'nuni.tw', 2000)).toBe(false);
  }
  expect(takePendingSharedPostLink(2001)).toBeNull();
  mockPublicLinkListener = null;
  const delivered = jest.fn();
  const subscription = preAuthLinking.subscribe?.(delivered);
  mockPublicLinkListener?.({ url: 'campus://library' });
  expect(delivered).toHaveBeenCalledWith('campus://library');
  subscription?.();
});


test('remounting public navigation cannot renew an expired cold-share intent from the same OS URL', async () => {
  const { clearPendingSharedPostLink, takePendingSharedPostLink } = require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  const date = jest.spyOn(Date, 'now');
  try {
    date.mockReturnValue(1_000_000);
    mockIncomingInitialURL = 'https://nuni.tw/community/post/remount-1?schoolId=pu&utm_source=cold';
    expect(await preAuthLinking.getInitialURL?.()).toBeNull();
    date.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
    // PublicNavigation can remount during authentication or an interrupted login.
    expect(await preAuthLinking.getInitialURL?.()).toBeNull();
    expect(takePendingSharedPostLink()).toBeNull();
  } finally {
    date.mockRestore();
    mockIncomingInitialURL = null;
    clearPendingSharedPostLink();
  }
});

test('private navigation never replays a publicly handled expired or canceled initial HTTPS share', async () => {
  const {
    clearPendingSharedPostLink, takePendingSharedPostLink, resolvePrivateInitialSharedPostURL,
  } = require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  const date = jest.spyOn(Date, 'now');
  try {
    const incoming = 'https://nuni.tw/community/post/expired-1?schoolId=pu&utm_source=campus';
    mockIncomingInitialURL = incoming;
    date.mockReturnValue(2_000_000);
    expect(await preAuthLinking.getInitialURL?.()).toBeNull();
    date.mockReturnValue(2_000_000 + 10 * 60 * 1000 + 1);
    // Expo Linking.getInitialURL() can still return the launch URL later.
    expect(resolvePrivateInitialSharedPostURL(incoming, 'nuni.tw')).toBeNull();
    expect(takePendingSharedPostLink()).toBeNull();
    expect(resolvePrivateInitialSharedPostURL(incoming, 'nuni.tw')).toBeNull();
  } finally {
    date.mockRestore();
    mockIncomingInitialURL = null;
    clearPendingSharedPostLink();
  }
});

test('private navigation retains a fresh authenticated cold share and takes staged public intent once', async () => {
  const {
    clearPendingSharedPostLink, resolvePrivateInitialSharedPostURL,
  } = require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  const date = jest.spyOn(Date, 'now');
  try {
    date.mockReturnValue(3_000_000);
    // A direct authenticated cold launch does not pass through the public stack.
    const authenticated = 'https://nuni.tw/community/post/direct-1?schoolId=pu';
    expect(resolvePrivateInitialSharedPostURL(authenticated, 'nuni.tw')).toBe(authenticated);
    mockIncomingInitialURL = 'https://nuni.tw/community/post/public-1?schoolId=pu&utm_ref=abc';
    expect(await preAuthLinking.getInitialURL?.()).toBeNull();
    expect(resolvePrivateInitialSharedPostURL(mockIncomingInitialURL, 'nuni.tw'))
      .toBe('https://nuni.tw/community/post/public-1?schoolId=pu');
    // Subsequent private stack recreation cannot open a consumed share again.
    expect(resolvePrivateInitialSharedPostURL(mockIncomingInitialURL, 'nuni.tw')).toBeNull();
    expect(resolvePrivateInitialSharedPostURL('campus://library', 'nuni.tw')).toBe('campus://library');
  } finally {
    date.mockRestore();
    mockIncomingInitialURL = null;
    clearPendingSharedPostLink();
  }
});


test('a later public library link supersedes a pending signed-out shared post', async () => {
  const { clearPendingSharedPostLink, resolvePrivateInitialSharedPostURL } =
    require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  const cold = 'https://nuni.tw/community/post/old-superseded-cold?schoolId=pu';
  mockIncomingInitialURL = cold;
  const forwarded = jest.fn();
  try {
    expect(await preAuthLinking.getInitialURL?.()).toBeNull();
    const unsubscribe = preAuthLinking.subscribe?.(forwarded);
    mockPublicLinkListener?.({ url: 'campus://library' });
    expect(forwarded).toHaveBeenCalledWith('campus://library');
    // A newer explicit public destination wins; login must not reopen the older share.
    expect(resolvePrivateInitialSharedPostURL('campus://library', 'nuni.tw'))
      .toBe('campus://library');
    expect(resolvePrivateInitialSharedPostURL(cold, 'nuni.tw')).toBeNull();
    unsubscribe?.();
  } finally {
    mockIncomingInitialURL = null;
    clearPendingSharedPostLink();
  }
});

test('a later public route cancels a warm shared post while a newer shared post still replaces it', () => {
  const { clearPendingSharedPostLink, resolvePrivateInitialSharedPostURL } =
    require('../app/pendingSharedPostLink');
  clearPendingSharedPostLink();
  const delivered = jest.fn();
  const unsubscribe = preAuthLinking.subscribe?.(delivered);
  try {
    mockPublicLinkListener?.({ url: 'https://nuni.tw/community/post/warm-a?schoolId=pu' });
    mockPublicLinkListener?.({ url: 'https://nuni.tw/community/post/warm-b?schoolId=pu' });
    expect(delivered).not.toHaveBeenCalled();
    mockPublicLinkListener?.({ url: 'campus://library' });
    expect(delivered).toHaveBeenCalledWith('campus://library');
    expect(resolvePrivateInitialSharedPostURL('campus://library', 'nuni.tw'))
      .toBe('campus://library');
  } finally {
    unsubscribe?.();
    clearPendingSharedPostLink();
  }
});
