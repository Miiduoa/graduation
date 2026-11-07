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
import { fetchCampusPostPage } from '../services/feedPages';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import { listBoards, listSubscribedBoardIds } from '../services/boards';
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
// The existing screen regression fixtures supply arrays. Adapt them at the
// SDK boundary; the separate service suite tests the real cursor query.
jest.mock('../services/feedPages', () => ({
  fetchCampusPostPage: jest.fn(async (schoolId: string, cursor: any = null) => {
    const mockFeed = jest.requireMock('../services/feed').fetchRecentCampusPosts as jest.Mock;
    const rows = await mockFeed(schoolId, undefined, cursor ? 120 : 60);
    const page = cursor && rows.length > 60 ? rows.slice(60, 120) : rows;
    return {
      posts: page,
      hasMore: page.length === 60,
      nextCursor: page.length ? {
        schoolId,
        document: { id: page[page.length - 1].id, ref: { parent: { path: `schools/${schoolId}/campusPosts` } } },
      } : null,
    };
  }),
}));
jest.mock('../services/feed', () => ({
  fetchRecentCampusPosts: jest.fn(),
  rankFeedPosts: (rows: unknown[]) => rows,
  toggleCampusPostLike: jest.fn(),
}));
jest.mock('../services/boards', () => ({
  listBoards: jest.fn(),
  listSubscribedBoardIds: jest.fn(async () => []),
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

test('empty search recovery continues a page cursor and navigation CTAs re-enter', async () => {
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
  expect(fetchCampusPostPage).toHaveBeenLastCalledWith('pu');

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '完全找不到');
  expect(await view.findByLabelText('再載入更多後繼續找')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByLabelText('再載入更多後繼續找'));
  });
  expect((jest.mocked(fetchCampusPostPage).mock.calls[1][1] as any).document.id).toBe('post-59');
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

test('an unsuccessful school refresh removes the old story from the viewer and feed', async () => {
  const story = { id: 's1', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
    text: '校園讀書會', expiresAt: Date.now() + 60000 };
  jest.mocked(listActiveStoriesForSchool).mockResolvedValueOnce([story]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小柏' }]);
  const view = render(<HomeFeedScreen />);
  fireEvent.press(await view.findByLabelText('查看 小柏 的限時動態'));
  expect(view.getByText('校園讀書會')).toBeTruthy();
  jest.mocked(listActiveStoriesForSchool).mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await act(async () => view.UNSAFE_getByType(RefreshControl).props.onRefresh());
  expect(view.queryByText('校園讀書會')).toBeNull();
  expect(view.queryByLabelText('查看 小柏 的限時動態')).toBeNull();
});

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


test('mobile cursor finds a post after page 240 without replacing the old cards or the query', async () => {
  const rows = (start: number) => Array.from({ length: 60 }, (_, i) => ({
    ...post, id: `older-${start + i}`, title: `校園貼文 ${start + i}`,
  }));
  const cursor = (id: string) => ({
    schoolId: 'pu', document: { id, ref: { parent: { path: 'schools/pu/campusPosts' } } },
  });
  const pages = [rows(0), rows(60), rows(120), rows(180), [{ ...post, id: 'target-241', title: '第241篇專題筆記' }]];
  const sdk = jest.mocked(fetchCampusPostPage);
  pages.forEach((items, i) => sdk.mockResolvedValueOnce({
    posts: items,
    hasMore: i < 4,
    nextCursor: i < 4 ? cursor(items[items.length - 1].id) : null,
  } as any));
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('已載入 60 則 · 顯示 60 則')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '第241篇');
  for (const count of [120, 180, 240]) {
    await act(async () => fireEvent.press(view.getByLabelText('再載入更多後繼續找')));
    expect(view.getByText(`搜尋範圍：已載入的 ${count} 篇貼文 · 顯示 0 則`)).toBeTruthy();
  }
  await act(async () => fireEvent.press(view.getByLabelText('再載入更多後繼續找')));
  expect(view.getByText('第241篇專題筆記')).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('第241篇');
  expect(sdk).toHaveBeenCalledTimes(5);
  expect(sdk.mock.calls.slice(1).map((call) => (call[1] as any).document.id))
    .toEqual(['older-59', 'older-119', 'older-179', 'older-239']);
});

test('mobile continuation failure retries exactly the same page and retains search', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...post, id: `recent-${i}`, title: `第${i}篇` }));
  const firstCursor = { schoolId: 'pu', document: { id: 'recent-59', ref: { parent: { path: 'schools/pu/campusPosts' } } } };
  jest.mocked(fetchCampusPostPage)
    .mockResolvedValueOnce({ posts: rows, nextCursor: firstCursor, hasMore: true } as any)
    .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
    .mockResolvedValueOnce({ posts: [{ ...post, id: 'target', title: '找到了舊筆記' }], nextCursor: null, hasMore: false } as any);
  const view = render(<HomeFeedScreen />);
  await view.findByText('已載入 60 則 · 顯示 60 則');
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '找到了');
  await act(async () => fireEvent.press(view.getByLabelText('再載入更多後繼續找')));
  expect(view.getByText('載入更多貼文失敗，已保留搜尋與原有貼文，請恢復連線後重試。')).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('找到了');
  await act(async () => fireEvent.press(view.getByLabelText('再載入更多後繼續找')));
  expect(view.getByText('找到了舊筆記')).toBeTruthy();
  expect(jest.mocked(fetchCampusPostPage).mock.calls[1][1]).toBe(firstCursor);
  expect(jest.mocked(fetchCampusPostPage).mock.calls[2][1]).toBe(firstCursor);
});

test('mobile continuation revocation hides previously loaded school posts', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...post, id: `recent-${i}` }));
  const firstCursor = { schoolId: 'pu', document: { id: 'recent-59', ref: { parent: { path: 'schools/pu/campusPosts' } } } };
  jest.mocked(fetchCampusPostPage)
    .mockResolvedValueOnce({ posts: rows, nextCursor: firstCursor, hasMore: true } as any)
    .mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'permission-denied' }));
  const view = render(<HomeFeedScreen />);
  await view.findByText('已載入 60 則 · 顯示 60 則');
  await act(async () => fireEvent.press(view.getByLabelText('載入更多貼文')));
  expect(view.getByText('校籍或貼文存取權限已變更，請重新驗證後載入。')).toBeTruthy();
  expect(view.UNSAFE_getByType(FlatList).props.data).toEqual([]);
  expect(view.queryByLabelText('載入更多貼文')).toBeNull();
});

test('mobile denied continuation removes the old-school story shelf and restores it only after revalidation', async () => {
  const story = { id: 'story-bob', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
    text: '舊校限時動態', expiresAt: Date.now() + 60_000 };
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...post, id: `recent-${i}` }));
  const cursor = { schoolId: 'pu', document: { id: 'recent-59', ref: { parent: { path: 'schools/pu/campusPosts' } } } };
  jest.mocked(fetchCampusPostPage)
    .mockResolvedValueOnce({ posts: rows, nextCursor: cursor, hasMore: true } as any)
    .mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'permission-denied' }))
    .mockResolvedValueOnce({ posts: rows, nextCursor: cursor, hasMore: true } as any);
  jest.mocked(listActiveStoriesForSchool).mockResolvedValue([story]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小柏' }]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByLabelText('查看 小柏 的限時動態')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByLabelText('載入更多貼文')));
  expect(view.getByText('校籍或貼文存取權限已變更，請重新驗證後載入。')).toBeTruthy();
  expect(view.queryByLabelText('查看 小柏 的限時動態')).toBeNull();
  expect(view.UNSAFE_getByType(FlatList).props.data).toEqual([]);
  await act(async () => fireEvent.press(view.getByText('重新讀取動態')));
  expect(await view.findByLabelText('查看 小柏 的限時動態')).toBeTruthy();
});

test('mobile continuation refuses duplicate taps and ignores an old school response', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...post, id: `recent-${i}` }));
  const firstCursor = { schoolId: 'pu', document: { id: 'recent-59', ref: { parent: { path: 'schools/pu/campusPosts' } } } };
  let resolveOld!: (value: any) => void;
  jest.mocked(fetchCampusPostPage)
    .mockResolvedValueOnce({ posts: rows, nextCursor: firstCursor, hasMore: true } as any)
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ posts: [{ ...post, schoolId: 'other', id: 'other', title: '他校新頁' }], nextCursor: null, hasMore: false } as any);
  const view = render(<HomeFeedScreen />);
  await view.findByText('已載入 60 則 · 顯示 60 則');
  fireEvent.press(view.getByLabelText('載入更多貼文'));
  fireEvent.press(view.getByLabelText('載入更多貼文'));
  expect(fetchCampusPostPage).toHaveBeenCalledTimes(2);
  mockSchoolId = 'other';
  view.rerender(<HomeFeedScreen />);
  expect(await view.findByText('他校新頁')).toBeTruthy();
  await act(async () => resolveOld({ posts: [{ ...post, id: 'old-late', title: '舊校延遲結果' }], hasMore: false, nextCursor: null }));
  expect(view.queryByText('舊校延遲結果')).toBeNull();
  expect(view.getByText('他校新頁')).toBeTruthy();
});


test('mobile long list offers a search return without changing pagination or query', async () => {
  const rows = (start: number) => Array.from({ length: 60 }, (_, i) => ({
    ...post, id: `shortcut-${start + i}`, title: `校園貼文 ${start + i}`,
  }));
  const first = rows(0);
  const second = rows(60);
  const sdk = jest.mocked(fetchCampusPostPage);
  sdk.mockResolvedValueOnce({
    posts: first, hasMore: true,
    nextCursor: { schoolId: 'pu', document: { id: 'shortcut-59' } },
  } as any).mockResolvedValueOnce({ posts: second, hasMore: false, nextCursor: null } as any);
  const view = render(<HomeFeedScreen />);
  await view.findByText('已載入 60 則 · 顯示 60 則');
  expect(view.queryByLabelText('返回搜尋與篩選')).toBeNull();
  await act(async () => fireEvent.press(view.getByLabelText('載入更多貼文')));
  expect(view.getByLabelText('返回搜尋與篩選')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByLabelText('返回搜尋與篩選')));
  expect(sdk).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('');
});

test('native date jump reads an older server page and returns to latest without losing the query', async () => {
  const sdk = jest.mocked(fetchCampusPostPage);
  sdk.mockResolvedValueOnce({ posts: [post], hasMore: false, nextCursor: null } as any)
    .mockResolvedValueOnce({ posts: [{ ...post, id: 'year-2022', title: '2022迎新活動' }], hasMore: false, nextCursor: null } as any)
    .mockResolvedValueOnce({ posts: [post], hasMore: false, nextCursor: null } as any);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText(post.title)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '活動');
  fireEvent.changeText(view.getByLabelText('要找的貼文日期'), '2022-09-03');
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  expect(sdk.mock.calls[1][0]).toBe('pu');
  expect(sdk.mock.calls[1][1]).toBeNull();
  expect(sdk.mock.calls[1][2]?.toISOString()).toBe('2022-09-03T15:59:59.999Z');
  expect(view.getByText('2022迎新活動')).toBeTruthy();
  expect(view.getByText('目前範圍：2022-09-03（台灣時間）及更早')).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('活動');
  await act(async () => fireEvent.press(view.getByLabelText('回到最新貼文')));
  expect(sdk.mock.calls[2][1]).toBeNull();
  expect(sdk.mock.calls[2][2]).toBeNull();
  expect(view.getByLabelText('要找的貼文日期').props.value).toBe('');
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('活動');
  expect(view.queryByText('目前範圍：2022-09-03（台灣時間）及更早')).toBeNull();
});

test('invalid date makes no query and offline date retry preserves the prior cards', async () => {
  const sdk = jest.mocked(fetchCampusPostPage);
  sdk.mockResolvedValueOnce({ posts: [post], hasMore: false, nextCursor: null } as any)
    .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
    .mockResolvedValueOnce({ posts: [{ ...post, id: 'old-note', title: '2022校園筆記' }], hasMore: false, nextCursor: null } as any);
  const view = render(<HomeFeedScreen />);
  await view.findByText(post.title);
  fireEvent.changeText(view.getByLabelText('要找的貼文日期'), '2023-02-29');
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  expect(view.getByText('請輸入有效的台灣日期，例如 2022-09-03。')).toBeTruthy();
  expect(sdk).toHaveBeenCalledTimes(1);
  fireEvent.changeText(view.getByLabelText('要找的貼文日期'), '2022-09-03');
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '筆記');
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  expect(view.getByText('日期定位失敗，已保留原有貼文。請確認連線後重試。')).toBeTruthy();
  expect(sdk).toHaveBeenCalledTimes(2);
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('筆記');
  expect(view.UNSAFE_getByType(FlatList).props.data).toEqual([]);
  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '');
  expect(view.getByText(post.title)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  expect(view.getByText('2022校園筆記')).toBeTruthy();
  expect(sdk.mock.calls[1][2]?.getTime()).toBe(sdk.mock.calls[2][2]?.getTime());
});

test('native date permission loss clears school posts and story identities', async () => {
  const sdk = jest.mocked(fetchCampusPostPage);
  sdk.mockResolvedValueOnce({ posts: [post], hasMore: false, nextCursor: null } as any)
    .mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'permission-denied' }));
  jest.mocked(listActiveStoriesForSchool).mockResolvedValue([{
    id: 'story-bob', schoolId: 'pu', authorUid: 'bob', kind: 'text',
    text: '校園社團', expiresAt: Date.now() + 60000,
  } as any]);
  jest.mocked(fetchSchoolDirectoryProfiles).mockResolvedValue([{ uid: 'bob', displayName: '小柏' }]);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByLabelText('查看 小柏 的限時動態')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('要找的貼文日期'), '2022-09-03');
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  expect(view.getByText('校籍或貼文存取權限已變更，請重新驗證後載入。')).toBeTruthy();
  expect(view.UNSAFE_getByType(FlatList).props.data).toEqual([]);
  expect(view.queryByLabelText('查看 小柏 的限時動態')).toBeNull();
  expect(view.queryByLabelText('從這天往前找')).toBeNull();
});

test('a late mobile continuation cannot replace a newer date jump', async () => {
  const recent = Array.from({ length: 60 }, (_, i) => ({ ...post, id: `recent-${i}`, title: `近期貼文 ${i}` }));
  const cursor = { schoolId: 'pu', document: { id: 'recent-59', ref: { parent: { path: 'schools/pu/campusPosts' } } } };
  let finishOld!: (value: any) => void;
  jest.mocked(fetchCampusPostPage)
    .mockResolvedValueOnce({ posts: recent, hasMore: true, nextCursor: cursor } as any)
    .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce({ posts: [{ ...post, id: 'old-2022', title: '2022年活動' }], hasMore: false, nextCursor: null } as any);
  const view = render(<HomeFeedScreen />);
  await view.findByText('已載入 60 則 · 顯示 60 則');
  fireEvent.press(view.getByLabelText('載入更多貼文'));
  fireEvent.changeText(view.getByLabelText('要找的貼文日期'), '2022-09-03');
  await act(async () => fireEvent.press(view.getByLabelText('從這天往前找')));
  await act(async () => finishOld({
    posts: [{ ...post, id: 'late', title: '不應出現的晚到貼文' }], hasMore: false, nextCursor: null,
  }));
  expect(view.getByText('2022年活動')).toBeTruthy();
  expect(view.queryByText('不應出現的晚到貼文')).toBeNull();
});
