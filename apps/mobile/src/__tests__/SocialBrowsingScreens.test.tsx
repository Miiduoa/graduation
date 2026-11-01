import React from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { HomeFeedScreen } from '../screens/social/HomeFeedScreen';
import { BoardsScreen } from '../screens/social/BoardsScreen';
import { fetchRecentCampusPosts, toggleCampusPostLike } from '../services/feed';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import { listBoards, listSubscribedBoardIds } from '../services/boards';
import { listActiveStoriesForSchool } from '../services/stories';
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
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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
  subscribeToBoard: jest.fn(),
  unsubscribeFromBoard: jest.fn(),
  groupBoardsByType: (rows: unknown[]) => ({ topic: rows }),
  createBoard: jest.fn(),
  CAMPUS_BOARD_TYPE_LABEL: { department: '系所', course: '課程', topic: '主題', anon: '匿名' },
}));
jest.mock('../services/stories', () => ({
  listActiveStoriesForSchool: jest.fn(async () => []),
  groupStoriesByAuthor: () => [],
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

beforeEach(() => {
  mockOffline = false;
  jest.clearAllMocks();
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
  expect(view.getByText('搜尋範圍：已載入的 2 篇貼文')).toBeTruthy();

  fireEvent.press(view.getByText('最新'));
  const list = view.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((item: typeof post) => item.id)).toEqual(['newer', 'older']);

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '攝影分享');
  expect(view.getByText('系上活動')).toBeTruthy();
  expect(view.queryByText('期中考討論')).toBeNull();
  fireEvent.press(view.getByLabelText('清除搜尋'));
  expect(view.getByText('期中考討論')).toBeTruthy();
});

test('empty search results offer load-more, clear-filters and board or topic recovery', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...post,
    id: `post-${index}`,
    title: `校園動態 ${index}`,
    content: '一般內容',
  }));
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue(rows);
  const view = render(<HomeFeedScreen />);
  expect(await view.findByText('搜尋範圍：已載入的 60 篇貼文')).toBeTruthy();

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '完全找不到');
  expect(await view.findByText('找不到符合的貼文')).toBeTruthy();
  expect(view.getByLabelText('再載入更多後繼續找')).toBeTruthy();
  expect(view.getByLabelText('前往看板')).toBeTruthy();
  expect(view.getByLabelText('前往話題')).toBeTruthy();
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('完全找不到');

  fireEvent.press(view.getByLabelText('我訂閱分類'));
  expect(await view.findByLabelText('清除篩選')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByLabelText('清除篩選'));
  });
  expect(view.getByLabelText('搜尋本校貼文').props.value).toBe('');
  expect(view.queryByText('找不到符合的貼文')).toBeNull();
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
