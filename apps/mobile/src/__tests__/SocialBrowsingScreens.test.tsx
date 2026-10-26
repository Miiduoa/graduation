import React from 'react';
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { HomeFeedScreen } from '../screens/social/HomeFeedScreen';
import { BoardsScreen } from '../screens/social/BoardsScreen';
import { fetchRecentCampusPosts } from '../services/feed';
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
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockAuthLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false, getDb: () => ({}) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/components', () => ({
  EmptyState: ({ title }: { title: string }) => {
    const { Text } = require('react-native');
    return <Text>{title}</Text>;
  },
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

  fireEvent.press(view.getByText('最新'));
  const list = view.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((item: typeof post) => item.id)).toEqual(['newer', 'older']);

  fireEvent.changeText(view.getByLabelText('搜尋本校貼文'), '攝影分享');
  expect(view.getByText('系上活動')).toBeTruthy();
  expect(view.queryByText('期中考討論')).toBeNull();
  fireEvent.press(view.getByLabelText('清除搜尋'));
  expect(view.getByText('期中考討論')).toBeTruthy();
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
