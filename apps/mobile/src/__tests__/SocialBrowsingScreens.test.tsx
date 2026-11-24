import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { feedChoiceKey } from '@campus/shared/src/communityFeedPreferences';
import { ActivityIndicator, Alert, FlatList, RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { HomeFeedScreen } from '../screens/social/HomeFeedScreen';
import { RealtimeSocialScreen } from '../screens/social/RealtimeSocialScreen';
import { BoardsScreen } from '../screens/social/BoardsScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { fetchRecentCampusPosts, toggleCampusPostLike } from '../services/feed';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import { listBoards, listSubscribedBoardIds, isSubscribedToBoard, subscribeToBoard, unsubscribeFromBoard } from '../services/boards';
import { listActiveStoriesForSchool, markStoryViewed } from '../services/stories';
import { listFollowingIds, followUser } from '../services/follows';
import {
  listCampusPostBookmarkIds,
  loadCampusPostBookmarks,
  saveCampusPostBookmark,
  removeCampusPostBookmark,
} from '../services/campusPostBookmarks';

let savedBookmarks = new Set<string>();
let mockUser = { uid: 'alice' };
let mockSchoolId = 'pu';
let mockAuthLoading = false;
let mockOffline = false;
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      setParams: mockSetParams,
    }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: jest.fn(),
  };
});
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockAuthLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false, getDb: () => ({}) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/components', () => ({
  EmptyState: ({ title, subtitle }: { title: string; subtitle?: string }) => {
    const { Text, View } = require('react-native');
    return (
      <View>
        <Text>{title}</Text>
        {subtitle ? <Text>{subtitle}</Text> : null}
      </View>
    );
  },
}));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOffline: mockOffline }),
}));
jest.mock('../services/feed', () => ({
  fetchRecentCampusPosts: jest.fn(),
  rankFeedPosts: (rows: unknown[]) => rows,
  toggleCampusPostLike: jest.fn(),
}));
jest.mock('../services/boards', () => ({
  listBoards: jest.fn(),
  listSubscribedBoardIds: jest.fn(async () => []),
  isSubscribedToBoard: jest.fn(async () => false),
  subscribeToBoard: jest.fn(),
  unsubscribeFromBoard: jest.fn(),
  groupBoardsByType: (rows: unknown[]) => ({ topic: rows }),
  createBoard: jest.fn(),
  CAMPUS_BOARD_TYPE_LABEL: { department: '系所', course: '課程', topic: '主題', anon: '匿名' },
}));
jest.mock('../services/stories', () => ({
  ...jest.requireActual('../services/stories'),
  listActiveStoriesForSchool: jest.fn(async () => []),
  markStoryViewed: jest.fn(async () => {}),
}));
jest.mock('../services/campusPostBookmarks', () => ({
  listCampusPostBookmarkIds: jest.fn(async () => []),
  loadCampusPostBookmarks: jest.fn(async () => ({ ids: [], posts: [] })),
  saveCampusPostBookmark: jest.fn(async () => undefined),
  removeCampusPostBookmark: jest.fn(async () => undefined),
}));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async () => []),
}));
jest.mock('../services/follows', () => ({
  listFollowingIds: jest.fn(async () => []),
  followUser: jest.fn(async () => undefined),
  unfollowUser: jest.fn(async () => undefined),
}));

const post = {
  id: 'post',
  schoolId: 'pu',
  boardId: 'board',
  anonymous: true,
  aliasSnapshot: '同學',
  title: '讀書會時間',
  content: '週三下午在圖書館',
};
const board = { id: 'board', name: '讀書會', type: 'topic' };
const screens = [
  {
    name: 'feed',
    Component: HomeFeedScreen,
    load: fetchRecentCampusPosts as jest.Mock,
    data: post,
    title: '讀書會時間',
    error: '暫時無法更新校園動態。請確認網路與登入狀態，再試一次。',
    retry: '重新讀取動態',
    empty: '尚無校園貼文',
  },
  {
    name: 'boards',
    Component: BoardsScreen,
    load: listBoards as jest.Mock,
    data: board,
    title: '讀書會',
    error: '暫時無法更新看板。請確認網路與登入狀態，再試一次。',
    retry: '重新讀取看板',
    empty: '尚無任何看板',
  },
];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockOffline = false;
  jest.clearAllMocks();
  mockNavigate.mockReset();
  mockSetParams.mockReset();
  mockSchoolId = 'pu';
  mockUser = { uid: 'alice' };
  mockAuthLoading = false;
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([]);
  jest.mocked(listBoards).mockResolvedValue([]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValue([]);
  jest.mocked(isSubscribedToBoard).mockReset().mockResolvedValue(false);
  jest.mocked(listActiveStoriesForSchool).mockResolvedValue([]);
  jest.mocked(listFollowingIds).mockResolvedValue([]);
  jest.mocked(followUser).mockResolvedValue(undefined);
  jest.mocked(toggleCampusPostLike).mockResolvedValue(undefined);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([]);
  savedBookmarks = new Set();
  jest.mocked(listCampusPostBookmarkIds).mockImplementation(async () => [...savedBookmarks]);
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({ ids: [], posts: [] });
  jest.mocked(saveCampusPostBookmark).mockImplementation(async (_uid, _schoolId, postId) => {
    savedBookmarks.add(postId);
  });
  jest.mocked(removeCampusPostBookmark).mockImplementation(async (_uid, _schoolId, postId) => {
    savedBookmarks.delete(postId);
  });
});

test.each(screens)(
  '$name ends a failed initial load and lets the user retry',
  async ({ Component, load, data, title, error, retry, empty }) => {
    load.mockRejectedValueOnce(new Error('offline'));
    const view = render(<Component />);
    expect(await view.findByText(error)).toBeTruthy();
    expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(view.queryByText(empty)).toBeNull();
    load.mockResolvedValueOnce([data]);
    await act(async () => {
      fireEvent.press(view.getByText(retry));
    });
    expect(view.getByText(title)).toBeTruthy();
    expect(view.queryByText(error)).toBeNull();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  },
);

test.each(screens)(
  '$name retains the displayed content if refresh fails and stops refreshing',
  async ({ Component, load, data, title, error }) => {
    load.mockResolvedValueOnce([data]);
    const view = render(<Component />);
    expect(await view.findByText(title)).toBeTruthy();
    load.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText(error)).toBeTruthy();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  },
);

test.each(screens)(
  '$name rejects a response from the previous school',
  async ({ Component, load, data, title }) => {
    let resolve!: (value: unknown[]) => void;
    load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<Component />);
    mockSchoolId = 'other';
    view.rerender(<Component />);
    await act(async () => {
      resolve([data]);
    });
    expect(view.queryByText(title)).toBeNull();
    expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  },
);

test.each(screens)(
  '$name removes previously shown content when school access is revoked',
  async ({ Component, load, data, title, error }) => {
    load.mockResolvedValueOnce([data]);
    const view = render(<Component />);
    expect(await view.findByText(title)).toBeTruthy();
    load.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(view.queryByText(title)).toBeNull();
    expect(view.getByText(error)).toBeTruthy();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  },
);

test.each(screens)(
  '$name keeps subscriptions when that dependency fails during refresh',
  async ({ Component, load, data, title, error }) => {
    load.mockResolvedValue([data]);
    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
    const view = render(<Component />);
    expect(await view.findByText(title)).toBeTruthy();
    jest.mocked(listSubscribedBoardIds).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText(error)).toBeTruthy();
    expect(listSubscribedBoardIds).toHaveBeenLastCalledWith('alice', 'pu', { throwOnError: true });
    if (Component === BoardsScreen) expect(view.getByText('已訂閱')).toBeTruthy();
  },
);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('a pending board subscription stays undoable and keeps the choice during refresh', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const subscribe = deferred();
  const unsubscribe = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => subscribe.promise);
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => unsubscribe.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  const pending = view.getByLabelText('取消訂閱讀書會');
  expect(pending.props.accessibilityState).toMatchObject({ busy: true });
  expect(pending.props.accessibilityState.disabled).toBeFalsy();
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  // Offline Firestore can keep the first write pending; the student can still undo it.
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
  expect(unsubscribeFromBoard).toHaveBeenCalledWith('alice', 'pu', 'board');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  await act(async () => { subscribe.resolve(); unsubscribe.resolve(); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(1);
  expect(unsubscribeFromBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('訂閱讀書會').props.accessibilityState.busy).toBe(false);
  expect(alertSpy).not.toHaveBeenCalled();
});

test('a server refresh started before a write cannot erase the later confirmed subscription', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const refresh = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => refresh.promise);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  await act(async () => { write.resolve(); });
  expect(view.getByLabelText('取消訂閱讀書會').props.accessibilityState.busy).toBe(false);

  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { refresh.resolve([]); await refreshPromise; });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
  expect(subscribeToBoard).toHaveBeenCalledTimes(1);
});

test('a refresh started during subscribe confirms a later cancellation from another device', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const subscribe = deferred();
  const subs = deferred<string[]>();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => subscribe.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });

  await act(async () => { subscribe.resolve(); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
  expect(isSubscribedToBoard).not.toHaveBeenCalled();

  // The other device removes the subscription before the list returns.
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(false);
  await act(async () => { subs.resolve([]); await refreshPromise; });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(isSubscribedToBoard).toHaveBeenCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('a refresh overlapping one board write still applies server state for other boards', async () => {
  const otherBoard = { id: 'board-b', name: '攝影社', type: 'topic' };
  jest.mocked(listBoards).mockResolvedValue([board, otherBoard]);
  const view = render(<BoardsScreen />);
  await view.findByText('攝影社');

  const refresh = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => refresh.promise);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  // Another device subscribed board-b; the server snapshot predates board A's write.
  await act(async () => { refresh.resolve(['board-b']); await refreshPromise; });
  expect(view.getByLabelText('取消訂閱攝影社')).toBeTruthy();
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { write.resolve(); });
  expect(view.getByLabelText('取消訂閱攝影社')).toBeTruthy();
  expect(view.getByLabelText('取消訂閱讀書會').props.accessibilityState.busy).toBe(false);
});

test('a failed write never trusts a snapshot that may contain its own unconfirmed change', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const refresh = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => refresh.promise);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  // Firestore latency compensation: the cache snapshot echoes the pending local write.
  await act(async () => { refresh.resolve(['board']); await refreshPromise; });
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(false);
  await act(async () => { write.reject(new Error('permission-denied')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'permission-denied');
  expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('訂閱讀書會').props.accessibilityState.busy).toBe(false);
});

test('a failed write re-reads the server so another device\'s subscription is shown', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(isSubscribedToBoard).toHaveBeenCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('an overlapping list after a failed write still confirms another device\'s later subscription', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const refresh = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => refresh.promise);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  // The write fails and the first server confirm still reports unsubscribed.
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(false);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  // Another device then subscribed; the overlapping list includes that membership.
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { refresh.resolve(['board']); await refreshPromise; });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const calls = jest.mocked(isSubscribedToBoard).mock.calls;
  expect(calls).toEqual([
    ['alice', 'pu', 'board', { fromServer: true }],
    ['alice', 'pu', 'board', { fromServer: true }],
  ]);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test.each([true, false])('a list started after a failed subscribe verifies its cached membership (second confirm succeeds: %s)', async (secondSucceeds) => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const firstConfirm = deferred<boolean>();
  const secondConfirm = deferred<boolean>();
  jest.mocked(isSubscribedToBoard)
    .mockImplementationOnce(() => firstConfirm.promise)
    .mockImplementationOnce(() => secondConfirm.promise);
  jest.mocked(subscribeToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(view.getByLabelText('訂閱讀書會').props.accessibilityState.busy).toBe(false);
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);

  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
  expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  if (secondSucceeds) {
    await act(async () => { firstConfirm.resolve(false); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
    await act(async () => { secondConfirm.resolve(true); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
  } else {
    await act(async () => { secondConfirm.reject(new Error('offline')); });
    await act(async () => { firstConfirm.resolve(true); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
  }
});

test('a list omission delivered before confirmation does not trigger another read when rows arrive later', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const firstConfirm = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => firstConfirm.promise);
  jest.mocked(subscribeToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(view.getByLabelText('訂閱讀書會').props.accessibilityState.busy).toBe(false);
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);

  const rows = deferred<typeof board[]>();
  jest.mocked(listBoards).mockImplementationOnce(() => rows.promise);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  let refreshPromise!: Promise<void>;
  await act(async () => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });

  await act(async () => { firstConfirm.resolve(true); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  await act(async () => { rows.resolve([board]); await refreshPromise; });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test.each([false, 'offline'] as const)(
  'a list omission delivered after confirmation of a failed unsubscribe rechecks the board (%s)',
  async (result) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
    const view = render(<BoardsScreen />);
    await view.findByLabelText('取消訂閱讀書會');

    const write = deferred();
    const subs = deferred<string[]>();
    const secondConfirm = deferred<boolean>();
    jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
    jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
    jest.mocked(isSubscribedToBoard)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => secondConfirm.promise);

    fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
    let refreshPromise!: Promise<void>;
    act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    await act(async () => { write.reject(new Error('offline')); });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    await act(async () => { subs.resolve([]); await refreshPromise; });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
    expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    await act(async () => {
      if (result === 'offline') secondConfirm.reject(new Error(result));
      else secondConfirm.resolve(result);
    });
    expect(view.getByLabelText(result === false ? '訂閱讀書會' : '取消訂閱讀書會')).toBeTruthy();
  },
);

test.each(['during confirmation', 'during write, IDs last', 'during write, rows last'])(
  'a list started %s rechecks listed membership after the first confirmation succeeds',
  async (timing) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    const view = render(<BoardsScreen />);
    await view.findByText('讀書會');

    const firstConfirm = deferred<boolean>();
    const secondConfirm = deferred<boolean>();
    jest.mocked(isSubscribedToBoard)
      .mockImplementationOnce(() => firstConfirm.promise)
      .mockImplementationOnce(() => secondConfirm.promise);
    const write = deferred();
    jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
    fireEvent.press(view.getByLabelText('訂閱讀書會'));

    const rows = deferred<typeof board[]>();
    const subs = deferred<string[]>();
    jest.mocked(listBoards).mockImplementationOnce(() => rows.promise);
    jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
    let refreshPromise!: Promise<void>;
    const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    const failWrite = async () => {
      await act(async () => { write.reject(new Error('offline')); });
      expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
      expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
    };
    if (timing === 'during confirmation') await failWrite();
    await act(async () => {
      refreshPromise = refresh();
      if (timing === 'during write, rows last') subs.resolve(['board']);
      else rows.resolve([board]);
    });
    if (timing !== 'during confirmation') {
      expect(isSubscribedToBoard).not.toHaveBeenCalled();
      await failWrite();
    }

    await act(async () => { firstConfirm.resolve(true); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    // Another device cancels after the first read, but the list still includes the board.
    await act(async () => {
      if (timing === 'during write, rows last') rows.resolve([board]);
      else subs.resolve(['board']);
      await refreshPromise;
    });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
    expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    await act(async () => { secondConfirm.resolve(false); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  },
);

test.each([
  ['IDs last', false],
  ['IDs last', 'offline'],
  ['rows last', false],
  ['rows last', 'offline'],
] as const)(
  'a list crossing a successful unsubscribe rechecks an omission with %s (second confirmation: %s)',
  async (lastResponse, result) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    const view = render(<BoardsScreen />);
    await view.findByText('讀書會');
    await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    const firstList = deferred<string[]>();
    const secondList = deferred<string[]>();
    const unsubscribe = deferred();
    jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => unsubscribe.promise);

    fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
    jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => firstList.promise);
    let firstRefresh!: Promise<void>;
    act(() => { firstRefresh = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    await act(async () => { firstList.resolve(['board']); await firstRefresh; });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

    const rows = deferred<typeof board[]>();
    jest.mocked(listBoards).mockImplementationOnce(() => rows.promise);
    jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => secondList.promise);
    let secondRefresh!: Promise<void>;
    act(() => { secondRefresh = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });

    const firstConfirm = deferred<boolean>();
    const secondConfirm = deferred<boolean>();
    jest.mocked(isSubscribedToBoard)
      .mockImplementationOnce(() => firstConfirm.promise)
      .mockImplementationOnce(() => secondConfirm.promise);
    await act(async () => { unsubscribe.resolve(); });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
    expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });

    // The first read saw a subscription before another device cancelled it.
    await act(async () => {
      if (lastResponse === 'rows last') secondList.resolve([]);
      else rows.resolve([board]);
    });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);

    await act(async () => { firstConfirm.resolve(true); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    await act(async () => {
      if (lastResponse === 'rows last') rows.resolve([board]);
      else secondList.resolve([]);
      await secondRefresh;
    });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
    expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    await act(async () => {
      if (result === 'offline') secondConfirm.reject(new Error(result));
      else secondConfirm.resolve(result);
    });
    expect(view.getByLabelText(result === false ? '訂閱讀書會' : '取消訂閱讀書會')).toBeTruthy();
  },
);

test('a failed write never discards an in-flight pull-to-refresh, even if its re-read fails', async () => {
  const otherBoard = { id: 'board-b', name: '攝影社', type: 'topic' };
  jest.mocked(listBoards).mockResolvedValue([board, otherBoard]);
  const view = render(<BoardsScreen />);
  await view.findByText('攝影社');

  const rows = deferred<typeof board[]>();
  jest.mocked(listBoards).mockImplementationOnce(() => rows.promise as any);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board-b']);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }));
  await act(async () => { write.reject(new Error('offline')); });
  await act(async () => { rows.resolve([board, otherBoard]); await refreshPromise; });
  expect(view.getByLabelText('取消訂閱攝影社')).toBeTruthy();
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  expect(view.queryByText('暫時無法更新看板。請確認網路與登入狀態，再試一次。')).toBeNull();
});

test('a batch whose last settled write succeeded still re-reads after an earlier failure', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const first = deferred();
  const second = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => first.promise);
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => second.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
  const readsBefore = jest.mocked(isSubscribedToBoard).mock.calls.length;
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  // Latest (unsubscribe) fails first; the older subscribe then succeeds and clears the batch.
  await act(async () => { second.reject(new Error('offline')); });
  await act(async () => { first.resolve(); });
  expect(jest.mocked(isSubscribedToBoard).mock.calls.length).toBe(readsBefore + 1);
  expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a successful older subscribe is shown after a newer unsubscribe and its confirmation fail', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const subscribe = deferred();
  const unsubscribe = deferred();
  const confirmation = deferred<boolean>();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => subscribe.promise);
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => unsubscribe.promise);
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => confirmation.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const button = view.getByLabelText('訂閱讀書會');
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(1);
  expect(unsubscribeFromBoard).toHaveBeenCalledTimes(1);
  await act(async () => { unsubscribe.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(isSubscribedToBoard).not.toHaveBeenCalled();

  await act(async () => { subscribe.resolve(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('取消訂閱讀書會').props.accessibilityState.busy).toBe(false);

  await act(async () => { confirmation.reject(new Error('offline')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a refresh older than a confirmed write cannot hide it after the next write fails', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const refresh = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => refresh.promise);
  const unsubscribe = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => unsubscribe.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
  // This snapshot was read before the confirmed subscription above.
  await act(async () => { refresh.resolve([]); await refreshPromise; });
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { unsubscribe.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(isSubscribedToBoard).toHaveBeenCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a late failed-write re-read never overwrites the newer pull-to-refresh confirmation', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  const reRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  // Another device subscribed; the refresh verifies that membership first.
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  await act(async () => { reRead.resolve(false); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a failed unsubscribe re-read keeps the subscription even when the list omits it', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  // The list endpoint is capped at 100 and may omit this board.
  const listCallsBefore = jest.mocked(listSubscribedBoardIds).mock.calls.length;
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(isSubscribedToBoard).toHaveBeenCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(jest.mocked(listSubscribedBoardIds).mock.calls.length).toBe(listCallsBefore);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('an older failed-write re-read never overwrites a newer re-read', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const first = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => first.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  const firstRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => firstRead.promise);
  await act(async () => { first.reject(new Error('offline')); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  const second = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => second.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  const secondRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => secondRead.promise);
  await act(async () => { second.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenLastCalledWith('訂閱失敗', 'offline');

  // Newer re-read: another device left the board unsubscribed.
  await act(async () => { secondRead.resolve(false); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  await act(async () => { firstRead.resolve(true); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('a late failed-write re-read never restores a board after access is revoked', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
  const reRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
  await act(async () => { write.reject(new Error('offline')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  jest.mocked(listBoards).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.queryByText('讀書會')).toBeNull();
  expect(view.getByText('暫時無法更新看板。請確認網路與登入狀態，再試一次。')).toBeTruthy();

  await act(async () => { reRead.resolve(true); });
  expect(view.queryByText('讀書會')).toBeNull();
  expect(view.queryByLabelText('取消訂閱讀書會')).toBeNull();
});

test.each(['firestore/permission-denied', 'unauthenticated'])(
  'a confirmation from before %s cannot override the subscription list after access returns',
  async (code) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
    const view = render(<BoardsScreen />);
    await view.findByText('讀書會');

    const write = deferred();
    const reRead = deferred<boolean>();
    jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
    jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
    fireEvent.press(view.getByLabelText('取消訂閱讀書會'));
    await act(async () => { write.reject(new Error('offline')); });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    jest.mocked(listSubscribedBoardIds).mockRejectedValueOnce(Object.assign(new Error('revoked'), { code }));
    await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(view.queryByText('讀書會')).toBeNull();

    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
    await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

    await act(async () => { reRead.resolve(true); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  },
);

test.each(['before recovery', 'after recovery'])(
  'a failed unsubscribe started before access was cleared is ignored when it settles %s',
  async (settlement) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
    const view = render(<BoardsScreen />);
    await view.findByText('讀書會');

    const write = deferred();
    const reRead = deferred<boolean>();
    jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
    jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

    const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    jest.mocked(listSubscribedBoardIds).mockRejectedValueOnce(
      Object.assign(new Error('revoked'), { code: 'firestore/permission-denied' }),
    );
    await act(async () => { await refresh(); });
    expect(view.queryByText('讀書會')).toBeNull();

    if (settlement === 'before recovery') {
      await act(async () => { write.reject(new Error('offline')); });
    }
    jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
    await act(async () => { await refresh(); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

    if (settlement === 'after recovery') {
      await act(async () => { write.reject(new Error('offline')); });
    }
    await act(async () => { reRead.resolve(true); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
    expect(isSubscribedToBoard).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  },
);

test('two failed presses before a rerender roll back to the last confirmed state', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const first = deferred();
  const second = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => first.promise);
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => second.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  const button = view.getByLabelText('訂閱讀書會');
  await act(async () => { fireEvent.press(button); fireEvent.press(button); });
  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { first.reject(new Error('offline')); });
  await act(async () => { second.reject(new Error('offline')); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(2);
  expect(unsubscribeFromBoard).toHaveBeenCalledTimes(1);
});

test('a late list snapshot taken during a failed write never restores the unconfirmed change', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const rows = deferred<typeof board[]>();
  const subs = deferred<string[]>();
  jest.mocked(listBoards).mockImplementationOnce(() => rows.promise as any);
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);

  let refreshPromise!: Promise<void>;
  act(() => { refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  await act(async () => { subs.resolve(['board']); });
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(false);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  await act(async () => { rows.resolve([board]); await refreshPromise; });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('a pull-to-refresh started during a failed write cannot apply a cache gap over the rollback', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const rows = deferred<typeof board[]>();
  const subs = deferred<string[]>();
  jest.mocked(listBoards).mockImplementationOnce(() => rows.promise as any);
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });

  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  // Cache miss / capped list omits the board after the rollback already landed.
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => {
    rows.resolve([board]);
    subs.resolve([]);
    await refreshPromise;
  });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('an overlapping list omission leaves the pending failed-write confirmation eligible to apply', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  const reRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  // The list has a cache gap while the first single-board read is pending.
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  await act(async () => { reRead.resolve(true); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a successful write still keeps a later list subscription if the re-check fails', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const subs = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });

  await act(async () => { write.resolve(); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { subs.resolve(['board']); await refreshPromise; });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a list read before a successful unsubscribe cannot restore it after a failed re-check', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const rows = deferred<typeof board[]>();
  const subs = deferred<string[]>();
  jest.mocked(listBoards).mockImplementationOnce(() => rows.promise);
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    subs.resolve(['board']);
  });

  await act(async () => { fireEvent.press(view.getByLabelText('取消訂閱讀書會')); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { rows.resolve([board]); await refreshPromise; });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('an older failed re-check leaves the newer write’s list membership available', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const firstRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => firstRead.promise);
  jest.mocked(subscribeToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);

  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  const unsubscribe = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => unsubscribe.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const subs = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    unsubscribe.resolve();
  });

  const secondRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => secondRead.promise);
  await act(async () => { subs.resolve(['board']); await refreshPromise; });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);

  await act(async () => { firstRead.reject(new Error('offline')); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  await act(async () => { secondRead.reject(new Error('offline')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a successful write clears rollback protection from an earlier failed write', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  jest.mocked(subscribeToBoard).mockRejectedValueOnce(new Error('offline'));
  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  // Another device unsubscribed after the successful write.
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
});

test.each([true, false])('a cache-gap refresh after failed unsubscribe confirms membership %s despite an in-flight read', async (serverSubscribed) => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const reRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => reRead.promise);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  // The list might omit a subscribed board, or another device might have unsubscribed.
  const refreshRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => refreshRead.promise);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  await act(async () => { refreshRead.resolve(serverSubscribed); });
  const expectedLabel = serverSubscribed ? '取消訂閱讀書會' : '訂閱讀書會';
  expect(view.getByLabelText(expectedLabel)).toBeTruthy();
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);

  await act(async () => { reRead.resolve(true); });
  expect(view.getByLabelText(expectedLabel)).toBeTruthy();
});

test.each([false, true])('a refresh retries failed rollback confirmation and applies server membership %s', async (serverSubscribed) => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  jest.mocked(unsubscribeFromBoard).mockRejectedValueOnce(new Error('offline'));
  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(view.getByLabelText('取消訂閱讀書會')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const confirmation = deferred<boolean>();
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => confirmation.promise);
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(3);
  expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  await act(async () => { confirmation.resolve(serverSubscribed); });
  expect(view.getByLabelText(serverSubscribed ? '取消訂閱讀書會' : '訂閱讀書會')).toBeTruthy();
});

test('a successful write still applies a later server subscription after a stale in-flight list', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const subs = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => {
    refreshPromise = view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });

  await act(async () => { write.resolve(); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  // Another device re-subscribed after this write; the in-flight list sees it.
  jest.mocked(isSubscribedToBoard).mockResolvedValueOnce(true);
  await act(async () => { subs.resolve(['board']); await refreshPromise; });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test.each([true, false])('a newer confirmation after successful unsubscribe wins in the same write generation (newer responds first: %s)', async (newerFirst) => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(unsubscribeFromBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('取消訂閱讀書會'));

  const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  await act(async () => { await refresh(); });

  const subs = deferred<string[]>();
  jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
  let refreshPromise!: Promise<void>;
  await act(async () => { refreshPromise = refresh(); });

  const firstRead = deferred<boolean>();
  const secondRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard)
    .mockImplementationOnce(() => firstRead.promise)
    .mockImplementationOnce(() => secondRead.promise);
  await act(async () => { write.resolve(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  // Another device subscribes between the two single-board reads.
  await act(async () => { subs.resolve(['board']); await refreshPromise; });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
  if (newerFirst) {
    await act(async () => { secondRead.resolve(true); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
    await act(async () => { firstRead.resolve(false); });
  } else {
    await act(async () => { firstRead.resolve(false); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
    await act(async () => { secondRead.resolve(true); });
  }
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('an older successful confirmation still applies when a newer confirmation fails', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const firstRead = deferred<boolean>();
  jest.mocked(unsubscribeFromBoard).mockRejectedValueOnce(new Error('offline'));
  jest.mocked(isSubscribedToBoard).mockImplementationOnce(() => firstRead.promise);
  await act(async () => { fireEvent.press(view.getByLabelText('取消訂閱讀書會')); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce([]);
  jest.mocked(isSubscribedToBoard).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  await act(async () => { firstRead.resolve(false); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test.each([true, false])('a failed newer confirmation preserves an older confirmed cancellation (older responds first: %s)', async (olderFirst) => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  await act(async () => { await refresh(); });

  const firstRead = deferred<boolean>();
  const secondRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard)
    .mockImplementationOnce(() => firstRead.promise)
    .mockImplementationOnce(() => secondRead.promise);
  await act(async () => { write.resolve(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  await act(async () => { await refresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);

  if (olderFirst) {
    await act(async () => { firstRead.resolve(false); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
    await act(async () => { secondRead.reject(new Error('offline')); });
  } else {
    await act(async () => { secondRead.reject(new Error('offline')); });
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
    await act(async () => { firstRead.resolve(false); });
  }
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('a list issued after a confirmed cancellation cannot restore it when overlapping confirmations fail', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByLabelText('訂閱讀書會'));

  const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  await act(async () => { await refresh(); });

  const firstRead = deferred<boolean>();
  const secondRead = deferred<boolean>();
  jest.mocked(isSubscribedToBoard)
    .mockImplementationOnce(() => firstRead.promise)
    .mockImplementationOnce(() => secondRead.promise)
    .mockRejectedValueOnce(new Error('offline'));
  await act(async () => { write.resolve(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);

  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  await act(async () => { await refresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);

  await act(async () => { firstRead.resolve(false); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  jest.mocked(listSubscribedBoardIds).mockResolvedValueOnce(['board']);
  await act(async () => { await refresh(); });
  expect(isSubscribedToBoard).toHaveBeenCalledTimes(3);
  expect(isSubscribedToBoard).toHaveBeenLastCalledWith('alice', 'pu', 'board', { fromServer: true });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

  await act(async () => { secondRead.reject(new Error('offline')); });
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test.each(['board rows', 'subscription IDs'])(
  'a list issued before a confirmed cancellation cannot be retained when %s arrive last',
  async (lastResult) => {
    jest.mocked(listBoards).mockResolvedValue([board]);
    const view = render(<BoardsScreen />);
    await view.findByText('讀書會');

    const write = deferred();
    jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
    fireEvent.press(view.getByLabelText('訂閱讀書會'));

    const refresh = () => view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    await act(async () => { await refresh(); });

    const firstRead = deferred<boolean>();
    const secondRead = deferred<boolean>();
    jest.mocked(isSubscribedToBoard)
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    await act(async () => { write.resolve(); });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();

    const rows = deferred<typeof board[]>();
    const subs = deferred<string[]>();
    jest.mocked(listBoards).mockImplementationOnce(() => rows.promise);
    jest.mocked(listSubscribedBoardIds).mockImplementationOnce(() => subs.promise);
    let refreshPromise!: Promise<void>;
    await act(async () => {
      refreshPromise = refresh();
      if (lastResult === 'board rows') subs.resolve(['board']);
      else rows.resolve([board]);
    });

    await act(async () => { firstRead.resolve(false); });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

    await act(async () => {
      if (lastResult === 'board rows') rows.resolve([board]);
      else subs.resolve(['board']);
      await refreshPromise;
    });
    expect(isSubscribedToBoard).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();

    await act(async () => { secondRead.reject(new Error('offline')); });
    expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  },
);

test('two native presses before a rerender toggle from the newest choice', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  const button = view.getByLabelText('訂閱讀書會');
  // Both presses run inside one act, so React cannot rerender in between.
  await act(async () => { fireEvent.press(button); fireEvent.press(button); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(1);
  expect(unsubscribeFromBoard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('an older failed write is superseded by the newer tap without alert or rollback', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const subscribe = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => subscribe.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  await act(async () => { fireEvent.press(view.getByLabelText('取消訂閱讀書會')); });
  await act(async () => { subscribe.reject(new Error('offline')); });
  expect(alertSpy).not.toHaveBeenCalled();
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
});

test('failed board subscription rolls back and allows an explicit retry', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  const write = deferred();
  jest.mocked(subscribeToBoard).mockImplementationOnce(() => write.promise);
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');

  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  expect(view.getByLabelText('取消訂閱讀書會').props.accessibilityState.busy).toBe(true);
  await act(async () => { write.reject(new Error('offline')); });
  expect(alertSpy).toHaveBeenCalledWith('訂閱失敗', 'offline');
  expect(view.getByLabelText('訂閱讀書會').props.accessibilityState.busy).toBe(false);
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(subscribeToBoard).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('取消訂閱讀書會')).toBeTruthy();
});

test('a subscription failure from the prior school never alerts or reverts the new scope', async () => {
  jest.mocked(listBoards).mockResolvedValue([board]);
  let fail!: (error: Error) => void;
  jest.mocked(subscribeToBoard).mockImplementationOnce(
    () => new Promise<void>((_resolve, reject) => { fail = reject; }),
  );
  const view = render(<BoardsScreen />);
  await view.findByText('讀書會');
  fireEvent.press(view.getByLabelText('訂閱讀書會'));
  expect(subscribeToBoard).toHaveBeenCalledWith('alice', 'pu', 'board');

  mockSchoolId = 'other';
  view.rerender(<BoardsScreen />);
  await view.findByText('讀書會');
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  await act(async () => { fail(new Error('stale offline')); });
  expect(alertSpy).not.toHaveBeenCalled();
  expect(view.getByLabelText('訂閱讀書會')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('訂閱讀書會')); });
  expect(subscribeToBoard).toHaveBeenLastCalledWith('alice', 'other', 'board');
});

test('a story read failure is reported without wiping the existing feed', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([post]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  jest.mocked(listActiveStoriesForSchool).mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });
  expect(view.getByText(post.title)).toBeTruthy();
  expect(view.getByText(screens[0].error)).toBeTruthy();
  expect(listActiveStoriesForSchool).toHaveBeenLastCalledWith('pu', 80, { throwOnError: true });
});

test.each(screens)('$name hides private content while the same account is revalidated', async ({ Component, load, data, title }) => {
  load.mockResolvedValueOnce([data]);
  const view = render(<Component />);
  expect(await view.findByText(title)).toBeTruthy();
  mockAuthLoading = true;
  view.rerender(<Component />);
  expect(view.getByText('正在確認登入狀態…')).toBeTruthy();
  expect(view.queryByText(title)).toBeNull();
  mockAuthLoading = false;
  view.rerender(<Component />);
  await act(async () => {});
  expect(view.queryByText(title)).toBeNull();
});

test('the mobile feed switches to latest and searches only loaded school posts', async () => {
  const older = {
    ...post,
    id: 'older',
    title: '期中考討論',
    content: '一起讀書',
    createdAt: new Date('2026-10-20T00:00:00Z'),
  };
  const newer = {
    ...post,
    id: 'newer',
    title: '系上活動',
    content: '攝影分享',
    createdAt: new Date('2026-10-25T00:00:00Z'),
  };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([older, newer]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('期中考討論')).toBeTruthy();
  expect(view.getByText('系上活動')).toBeTruthy();
  expect(view.queryByText(/搜尋範圍：已載入的/)).toBeNull();
  expect(view.getByText('已載入 2 則 · 顯示 2 則')).toBeTruthy();

  fireEvent.press(view.getByText('最新'));
  const list = view.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((item: typeof post) => item.id)).toEqual(['newer', 'older']);

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '攝影分享');
  expect(view.getByText('系上活動')).toBeTruthy();
  expect(view.queryByText('期中考討論')).toBeNull();
  expect(view.getByText('搜尋範圍：已載入的 2 篇貼文 · 顯示 1 則')).toBeTruthy();
  fireEvent.press(view.getByLabelText('清除搜尋'));
  expect(view.getByText('期中考討論')).toBeTruthy();
});

test('empty search results offer load-more, clear-filters and board or realtime recovery', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...post,
    id: `post-${index}`,
    title: `校園動態 ${index}`,
    content: '一般內容',
  }));
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue(rows);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('已載入 60 則 · 顯示 60 則')).toBeTruthy();

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '完全找不到');
  expect(await view.findByText('找不到符合的貼文')).toBeTruthy();
  expect(view.getByText('搜尋範圍：已載入的 60 篇貼文 · 顯示 0 則')).toBeTruthy();
  expect(view.getByLabelText('再載入更多後繼續找')).toBeTruthy();
  expect(view.getByLabelText('前往看板')).toBeTruthy();
  expect(view.getByLabelText('前往即時')).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('完全找不到');

  fireEvent.press(view.getByLabelText('我訂閱分類'));
  expect(await view.findByLabelText('清除篩選')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('清除篩選'));
  });
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('完全找不到');
  expect(view.queryByText('找不到符合的貼文')).toBeTruthy();
});

test('empty search recovery load-more raises the fetch limit and navigation CTAs re-enter', async () => {
  const page = Array.from({ length: 60 }, (_, index) => ({
    ...post,
    id: `post-${index}`,
    title: `校園動態 ${index}`,
    content: '一般內容',
  }));
  const wider = Array.from({ length: 120 }, (_, index) => ({
    ...post,
    id: `post-${index}`,
    title: `校園動態 ${index}`,
    content: '一般內容',
  }));
  jest.mocked(fetchRecentCampusPosts)
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce(wider);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('已載入 60 則 · 顯示 60 則')).toBeTruthy();
  expect(fetchRecentCampusPosts).toHaveBeenLastCalledWith('pu', undefined, 60);

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '完全找不到');
  expect(await view.findByLabelText('再載入更多後繼續找')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByLabelText('再載入更多後繼續找'));
  });
  expect(fetchRecentCampusPosts).toHaveBeenLastCalledWith('pu', undefined, 120);
  expect(await view.findByText('搜尋範圍：已載入的 120 篇貼文 · 顯示 0 則')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByLabelText('前往看板'));
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('前往看板'));
  });
  expect(mockNavigate.mock.calls.filter((call) => call[0] === 'CampusSocialScreen' && call[1]?.initialTab === 'boards')).toHaveLength(2);

  await act(async () => {
    fireEvent.press(view.getByLabelText('前往即時'));
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('前往即時'));
  });
  expect(mockNavigate.mock.calls.filter((call) => call[0] === 'CampusSocialScreen' && call[1]?.initialTab === 'realtime')).toHaveLength(2);
});

test('community shell clears initialTab after apply so the same CTA can re-enter', () => {
  const navigation = { setParams: mockSetParams, navigate: mockNavigate };
  let route: { params: { initialTab?: string } } = { params: { initialTab: 'boards' } };
  const view = render(<CommunityScreen navigation={navigation} route={route} />);
  expect(view.getByLabelText('看板').props.accessibilityState?.selected).toBe(true);
  expect(mockSetParams).toHaveBeenCalledWith({ initialTab: undefined });

  // 模擬父層吃到 setParams 清空，使用者再手動回動態。
  route = { params: {} };
  view.rerender(<CommunityScreen navigation={navigation} route={route} />);
  fireEvent.press(view.getByLabelText('動態'));
  expect(view.getByLabelText('動態').props.accessibilityState?.selected).toBe(true);

  // 第二次同值 CTA：params 從空再到 boards，effect 會再切一次。
  route = { params: { initialTab: 'boards' } };
  view.rerender(<CommunityScreen navigation={navigation} route={route} />);
  expect(view.getByLabelText('看板').props.accessibilityState?.selected).toBe(true);
  expect(mockSetParams).toHaveBeenLastCalledWith({ initialTab: undefined });
});

test('offline empty search keeps the query and hides load-more', async () => {
  mockOffline = true;
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([post]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '離線找不到');
  expect(await view.findByText('離線中，找不到符合的貼文')).toBeTruthy();
  expect(view.getByText(/關鍵字已保留/)).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('離線找不到');
  expect(view.queryByLabelText('再載入更多後繼續找')).toBeNull();
  expect(view.getByLabelText('前往看板')).toBeTruthy();
  expect(view.getByLabelText('前往即時')).toBeTruthy();
});

test('the saved filter loads older bookmarked posts outside the latest feed', async () => {
  const savedPost = { ...post, id: 'saved-old', title: '上學期筆記' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([post]);
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({ ids: ['saved-old'], posts: [savedPost] });
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('收藏分類'));
  });
  expect(await view.findByText('上學期筆記')).toBeTruthy();
  expect(view.queryByText(post.title)).toBeNull();
  expect(loadCampusPostBookmarks).toHaveBeenCalledWith('alice', 'pu');
});

test('saves a post only after a confirmed write and allows undo', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([post]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('收藏貼文'));
  });
  expect(saveCampusPostBookmark).toHaveBeenCalledWith('alice', 'pu', 'post');
  expect(view.getByLabelText('取消收藏貼文')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('取消收藏貼文'));
  });
  expect(removeCampusPostBookmark).toHaveBeenCalledWith('alice', 'pu', 'post');
  expect(view.getByLabelText('收藏貼文')).toBeTruthy();
});

test('a failed save does not falsely mark the post as bookmarked', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([post]);
  jest.mocked(saveCampusPostBookmark).mockRejectedValueOnce(new Error('offline'));
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('收藏貼文'));
  });
  expect(view.getByLabelText('收藏貼文')).toBeTruthy();
  expect(view.queryByLabelText('取消收藏貼文')).toBeNull();
});

test('following feed shows only public authors explicitly followed within this school', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([
    { ...post, id: 'bob-post', anonymous: false, authorUid: 'bob', title: '小明的讀書會' },
    { ...post, id: 'carol-post', anonymous: false, authorUid: 'carol', title: '小華的活動' },
    { ...post, id: 'anonymous-post', anonymous: true, authorUid: 'bob', title: '匿名提問' },
  ]);
  jest.mocked(listFollowingIds).mockResolvedValue(['bob']);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('小明的讀書會')).toBeTruthy();
  await act(async () => {});
  fireEvent.press(view.getByLabelText('追蹤分類'));
  expect(view.getByText('小明的讀書會')).toBeTruthy();
  expect(view.queryByText('小華的活動')).toBeNull();
  expect(view.queryByText('匿名提問')).toBeNull();
  expect(listFollowingIds).toHaveBeenCalledWith('pu', 'alice', 200, { throwOnError: true });
});

test('following read failures stay distinguishable from an empty feed', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([post]);
  jest.mocked(listFollowingIds).mockRejectedValueOnce(new Error('offline'));
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  fireEvent.press(view.getByLabelText('追蹤分類'));
  expect(await view.findByText('追蹤清單暫時無法讀取，請確認連線及校籍後重試。')).toBeTruthy();
  expect(view.queryByText('追蹤的作者尚未發文')).toBeNull();
});

test('following failures offer recovery beside the current feed without requiring a filter change', async () => {
  const publicPost = { ...post, anonymous: false, authorUid: 'bob' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([publicPost]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小明' }]);
  jest.mocked(listFollowingIds).mockRejectedValueOnce(new Error('offline'));
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  expect(view.getByText('追蹤清單暫時無法讀取，請確認連線及校籍後重試。')).toBeTruthy();
  expect(view.queryByLabelText('追蹤 小明')).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByLabelText('重新載入追蹤'));
  });
  expect(await view.findByLabelText('追蹤 小明')).toBeTruthy();
  expect(view.queryByText('追蹤清單暫時無法讀取，請確認連線及校籍後重試。')).toBeNull();
});

test('revoking access removes previously loaded saved posts when the refresh is denied', async () => {
  const savedPost = { ...post, id: 'private-saved', title: '以前收藏的校內筆記' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([post]);
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({ ids: [savedPost.id], posts: [savedPost] });
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);
  await act(async () => fireEvent.press(view.getByLabelText('收藏分類')));
  expect(await view.findByText(savedPost.title)).toBeTruthy();
  jest.mocked(loadCampusPostBookmarks).mockRejectedValueOnce(
    Object.assign(new Error('revoked'), { code: 'firestore/permission-denied' }),
  );
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(view.queryByText(savedPost.title)).toBeNull();
  expect(view.getByText('收藏無法讀取，請檢查連線與校籍後重試。')).toBeTruthy();
  expect(view.queryByText('還沒有收藏貼文')).toBeNull();
});

test('a denied feed refresh hides saved content even if a concurrent bookmark read succeeds', async () => {
  const savedPost = { ...post, id: 'private-saved', title: '以前收藏的校內筆記' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([post]);
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({ ids: [savedPost.id], posts: [savedPost] });
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);
  await act(async () => fireEvent.press(view.getByLabelText('收藏分類')));
  await view.findByText(savedPost.title);
  jest.mocked(fetchRecentCampusPosts).mockRejectedValueOnce(
    Object.assign(new Error('revoked'), { code: 'permission-denied' }),
  );
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(view.getByText(screens[0].error)).toBeTruthy();
  expect(view.queryByText(savedPost.title)).toBeNull();
  expect(view.queryByText(/顯示 \d+ 則收藏/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重新讀取動態')));
  expect(await view.findByText(savedPost.title)).toBeTruthy();
});

test('a denied following refresh removes the previously accepted relations', async () => {
  const publicPost = { ...post, anonymous: false, authorUid: 'bob' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([publicPost]);
  jest.mocked(listFollowingIds).mockResolvedValue(['bob']);
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);
  fireEvent.press(view.getByLabelText('追蹤分類'));
  expect(view.getByText(post.title)).toBeTruthy();
  jest.mocked(listFollowingIds).mockRejectedValueOnce(
    Object.assign(new Error('revoked'), { code: 'permission-denied' }),
  );
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(view.queryByText(post.title)).toBeNull();
  expect(view.getByText('追蹤清單暫時無法讀取，請確認連線及校籍後重試。')).toBeTruthy();
  expect(view.queryByText('追蹤的作者尚未發文')).toBeNull();
});

test.each([
  { name: 'follow', action: followUser, label: '追蹤 小明' },
  { name: 'bookmark', action: saveCampusPostBookmark, label: '收藏貼文' },
  { name: 'like', action: toggleCampusPostLike, label: '按讚' },
])('an old $name failure cannot interrupt the next account', async ({ action, label }) => {
  let reject!: (error: Error) => void;
  (action as jest.Mock).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([{ ...post, anonymous: false, authorUid: 'bob' }]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小明' }]);
  const view = render(<HomeFeedScreen />);
  const button = await view.findByLabelText(label);
  fireEvent.press(button, { stopPropagation: jest.fn() });
  expect(action).toHaveBeenCalledTimes(1);
  mockUser = { uid: 'diana' };
  view.rerender(<HomeFeedScreen />);
  await view.findByText(post.title);
  await act(async () => reject(new Error('old request failed')));
  expect(alertSpy).not.toHaveBeenCalled();
  expect(view.getByLabelText(label)).toBeTruthy();
});

test.each([
  {
    name: 'saved', filter: '收藏分類', load: loadCampusPostBookmarks,
    ready: { ids: ['post'], posts: [{ ...post, anonymous: false, authorUid: 'bob' }] },
    count: '顯示 1 則收藏', scope: '顯示本校最近最多 40 筆私人收藏，可跨裝置同步',
    retry: '重新載入收藏', error: '收藏無法讀取，請檢查連線與校籍後重試。',
  },
  {
    name: 'following', filter: '追蹤分類', load: listFollowingIds, ready: ['bob'],
    count: '追蹤作者的貼文 1 則', scope: '只顯示目前載入的本校貼文中追蹤的作者',
    retry: '重新載入追蹤', error: '追蹤清單暫時無法讀取，請確認連線及校籍後重試。',
  },
])('$name shows confirmed counts only after loading succeeds and hides denied content', async ({ filter, load, ready, count, scope, retry, error }) => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([{ ...post, anonymous: false, authorUid: 'bob' }]);
  (load as jest.Mock).mockResolvedValue(ready);
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);
  await act(async () => fireEvent.press(view.getByLabelText(filter)));
  expect(await view.findByText(count)).toBeTruthy();
  expect(view.getByText(scope)).toBeTruthy();
  let reject!: (cause: Error) => void;
  (load as jest.Mock).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(view.queryByText(count)).toBeNull();
  expect(view.queryByText(scope)).toBeNull();
  expect(view.queryByText(post.title)).toBeNull();
  await act(async () => reject(Object.assign(new Error('revoked'), { code: 'permission-denied' })));
  expect(view.getByText(error)).toBeTruthy();
  expect(view.queryByText(post.title)).toBeNull();
  expect(view.queryByText(scope)).toBeNull();
  expect(view.queryByText(/顯示 \d+ 則收藏|追蹤作者的貼文 \d+ 則/)).toBeNull();
  await act(async () => fireEvent.press(view.getByLabelText(retry)));
  expect(await view.findByText(count)).toBeTruthy();
  expect(view.getByText(post.title)).toBeTruthy();
});

test('remembers feed controls only for the same account and school and clears the search on return', async () => {
  const first = render(<HomeFeedScreen />);
  await first.findByLabelText('圖文分類');
  await act(async () => {
    fireEvent.press(first.getByLabelText('圖文分類'));
    fireEvent.press(first.getByLabelText('最新'));
    fireEvent.changeText(first.getByLabelText('搜尋本校貼文'), '個人關鍵字');
  });
  first.unmount();
  const view = render(<HomeFeedScreen />);
  await act(async () => {});
  expect(view.getByLabelText('圖文分類').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('最新').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('');
  const values = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  expect(values.map(([, value]) => value).sort()).toEqual(['latest', 'media']);

  mockSchoolId = 'ncku';
  view.rerender(<HomeFeedScreen />);
  await act(async () => {});
  expect(view.getByLabelText('全部分類').props.accessibilityState.selected).toBe(true);
  mockUser = { uid: 'dana' };
  mockSchoolId = 'pu';
  view.rerender(<HomeFeedScreen />);
  await act(async () => {});
  expect(view.getByLabelText('推薦').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('全部分類').props.accessibilityState.selected).toBe(true);
});

test('a late filter read cannot undo a tap while an untouched sort choice still restores', async () => {
  const key = feedChoiceKey('alice', 'pu', 'filter')!;
  let release!: (value: string) => void;
  const delayed = new Promise<string>((resolve) => { release = resolve; });
  await jest.mocked(AsyncStorage.getItem).withImplementation(
    (requested) => requested === key ? delayed : Promise.resolve('latest'),
    async () => {
      const view = render(<HomeFeedScreen />);
      await view.findByLabelText('圖文分類');
      await act(async () => { fireEvent.press(view.getByLabelText('圖文分類')); });
      await act(async () => { release('following'); });
      expect(view.getByLabelText('圖文分類').props.accessibilityState.selected).toBe(true);
      expect(view.getByLabelText('最新').props.accessibilityState.selected).toBe(true);
    },
  );
});

test('a delayed previous account and unavailable storage do not change the new account’s controls', async () => {
  const previous = feedChoiceKey('alice', 'pu', 'filter')!;
  let release!: (value: string) => void;
  const delayed = new Promise<string>((resolve) => { release = resolve; });
  await jest.mocked(AsyncStorage.getItem).withImplementation(
    (key) => key === previous ? delayed : Promise.reject(new Error('unavailable')),
    async () => {
      const view = render(<HomeFeedScreen />);
      await view.findByLabelText('圖文分類');
      mockUser = { uid: 'dana' };
      view.rerender(<HomeFeedScreen />);
      await act(async () => { release('following'); });
      expect(view.getByLabelText('全部分類').props.accessibilityState.selected).toBe(true);
      await jest.mocked(AsyncStorage.setItem).withImplementation(
        () => Promise.reject(new Error('unavailable')),
        async () => {
          await act(async () => { fireEvent.press(view.getByLabelText('圖文分類')); });
          expect(view.getByLabelText('圖文分類').props.accessibilityState.selected).toBe(true);
        },
      );
    },
  );
});


test('opens stories without navigating away, shows photo captions and steps between authors', async () => {
  const common = { schoolId: 'pu', kind: 'text' as const, expiresAt: Date.now() + 3600_000 };
  jest.mocked(listActiveStoriesForSchool).mockResolvedValue([
    { ...common, id: 'c1', authorUid: 'classmate', text: '球場見', createdAt: 1 },
    { ...common, id: 'b1', authorUid: 'bob', text: '社課開場', createdAt: 2 },
    { ...common, id: 'b2', authorUid: 'bob', kind: 'image', mediaUrl: 'https://cdn.example/p.jpg', text: '器材位置', createdAt: 3 },
    { ...common, id: 'foreign', schoolId: 'other', authorUid: 'outsider', text: '其他學校內容', createdAt: 5 },
  ]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小柏' }]);
  const view = render(<HomeFeedScreen />);
  fireEvent.changeText(await view.findByLabelText('搜尋本校貼文'), '社課');
  fireEvent.press(await view.findByLabelText('查看 小柏 的限時動態'));
  expect(view.getByText('社課開場')).toBeTruthy();
  expect(view.getByRole('button', { name: '上一則' })).toBeDisabled();
  fireEvent.press(view.getByText('下一則'));
  expect(view.getByText('器材位置')).toBeTruthy();
  fireEvent.press(view.getByText('下一則'));
  expect(view.getByText('球場見')).toBeTruthy();
  fireEvent.press(view.getByText('上一則'));
  expect(view.getByText('器材位置')).toBeTruthy();
  fireEvent.press(view.getByLabelText('關閉限時動態'));
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('社課');
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(listActiveStoriesForSchool).toHaveBeenCalledTimes(1);
  expect(markStoryViewed).not.toHaveBeenCalledWith('foreign', expect.anything());
});

test.each(['unavailable', 'permission-denied', 'firestore/permission-denied'])(
  'a %s school refresh preserves stories only for connection failures', async (code) => {
    const story = { id: 's1', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
      text: '校園讀書會', expiresAt: Date.now() + 60000 };
    jest.mocked(listActiveStoriesForSchool).mockResolvedValueOnce([story]);
    jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小柏' }]);
    const view = render(<HomeFeedScreen />);
    fireEvent.press(await view.findByLabelText('查看 小柏 的限時動態'));
    expect(view.getByText('校園讀書會')).toBeTruthy();
    jest.mocked(listActiveStoriesForSchool).mockRejectedValueOnce(Object.assign(new Error('refresh failed'), { code }));
    await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(!!view.queryByText('校園讀書會')).toBe(code === 'unavailable');
    expect(!!view.queryByLabelText('查看 小柏 的限時動態')).toBe(code === 'unavailable');
  },
);

test('a late allowed read cannot restore the realtime grid after access is denied', async () => {
  const story = { id: 's1', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
    text: '校園讀書會', expiresAt: Date.now() + 60000 };
  let finish!: (rows: typeof story[]) => void;
  jest.mocked(listActiveStoriesForSchool)
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  const view = render(<RealtimeSocialScreen />);
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  await act(async () => finish([story]));
  expect(view.queryByText(story.text)).toBeNull();
  const retry = view.getByText('重新讀取限時動態');
  jest.mocked(listActiveStoriesForSchool).mockResolvedValueOnce([story]);
  await act(async () => fireEvent.press(retry));
  expect(view.getByText(story.text)).toBeTruthy();
});

test('realtime keeps the open text story and grid during refresh and network failure, then clears on denial', async () => {
  const story = { id: 'text', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
    text: '校園近況', expiresAt: Date.now() + 120_000 };
  jest.mocked(listActiveStoriesForSchool).mockResolvedValueOnce([story]);
  const view = render(<RealtimeSocialScreen />);
  const card = await view.findByLabelText('查看 同學 的限時動態');
  fireEvent.press(card);
  const close = view.getByLabelText('關閉限時動態');
  let fail!: (error: unknown) => void;
  jest.mocked(listActiveStoriesForSchool).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  let refresh!: Promise<void>;
  act(() => { refresh = view.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
  expect(view.getByLabelText('關閉限時動態')).toBe(close);
  expect(view.getByLabelText('查看 同學 的限時動態')).toBeTruthy();
  await act(async () => { fail(new Error('offline')); await refresh; });
  expect(view.getByLabelText('關閉限時動態')).toBe(close);
  expect(view.getByLabelText('查看 同學 的限時動態')).toBeTruthy();
  expect(view.getByText('暫時無法讀取限時動態，請確認連線與校園帳號。')).toBeTruthy();
  jest.mocked(listActiveStoriesForSchool).mockRejectedValueOnce({ code: 'permission-denied' });
  await act(async () => fireEvent.press(view.getByText('重新讀取限時動態')));
  expect(view.queryByLabelText('關閉限時動態')).toBeNull();
  expect(view.queryByLabelText('查看 同學 的限時動態')).toBeNull();
  expect(view.queryByText(story.text)).toBeNull();
});

test('從交流開啟社群有可見返回入口，返回不重建其他分區', () => {
  const goBack = jest.fn();
  const navigation = {
    setParams: mockSetParams,
    navigate: mockNavigate,
    goBack,
    canGoBack: () => true,
  };
  const view = render(
    <CommunityScreen navigation={navigation} route={{ params: { initialTab: 'boards' } }} />,
  );
  fireEvent.press(view.getByRole('button', { name: '返回上一頁' }));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('feed board chip is a standalone accessible button and does not open the surrounding post', async () => {
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([post]);
  jest.mocked(listBoards).mockResolvedValueOnce([board]);
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);

  const boardButton = view.getByRole('button', { name: '開啟讀書會看板' });
  const stopPropagation = jest.fn();
  fireEvent.press(boardButton, { stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('BoardDetail', {
    boardId: 'board', boardName: '讀書會',
  });

  mockNavigate.mockClear();
  fireEvent.press(view.getByText(post.title));
  expect(mockNavigate).toHaveBeenCalledWith('PostDetail', { postId: 'post' });
});
