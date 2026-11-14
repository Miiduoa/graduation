import React from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { BoardDetailScreen } from '../screens/social/BoardDetailScreen';
import { fetchRecentCampusPosts } from '../services/feed';
import { getBoardById, isSubscribedToBoard } from '../services/boards';

let mockUid: string | null = 'alice';
let mockSchoolId = 'pu';
let mockAuthLoading = false;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn() }),
}));
jest.mock('../screens/social/CampusSocialNavContext', () => ({
  useCampusSocialStackNav: () => null,
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: mockAuthLoading }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: mockSchoolId } }),
}));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/feed', () => ({
  fetchRecentCampusPosts: jest.fn(),
  rankFeedPosts: (rows: unknown[]) => rows,
}));
jest.mock('../services/boards', () => ({
  getBoardById: jest.fn(),
  isSubscribedToBoard: jest.fn(),
  subscribeToBoard: jest.fn(),
  unsubscribeFromBoard: jest.fn(),
}));

const board = { id: 'board', name: '讀書會', type: 'topic' };
const post = { id: 'post-pu', schoolId: 'pu', boardId: 'board', title: '本校文章', content: '讀書會活動', anonymous: false };
const route = { params: { boardId: 'board', boardName: '讀書會' } };
const errorText = '暫時無法更新看板。請確認網路與登入狀態，再試一次。';

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
  mockSchoolId = 'pu';
  mockAuthLoading = false;
  jest.mocked(fetchRecentCampusPosts).mockResolvedValue([post]);
  jest.mocked(getBoardById).mockResolvedValue(board);
  jest.mocked(isSubscribedToBoard).mockResolvedValue(false);
});

test('board detail finishes an offline initial load and can retry without reopening the board', async () => {
  jest.mocked(getBoardById).mockRejectedValueOnce(new Error('offline'));
  const view = render(<BoardDetailScreen route={route} />);
  expect(await view.findByText(errorText)).toBeTruthy();
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(view.queryByText('此看板尚未有貼文，成為第一篇吧。')).toBeNull();

  await act(async () => {
    fireEvent.press(view.getByText('重新讀取看板'));
  });
  expect(view.getByText(post.title)).toBeTruthy();
  expect(view.queryByText(errorText)).toBeNull();
  expect(fetchRecentCampusPosts).toHaveBeenLastCalledWith('pu', 'board', 45);
});

test('board detail preserves readable posts on a temporary refresh failure', async () => {
  const view = render(<BoardDetailScreen route={route} />);
  expect(await view.findByText(post.title)).toBeTruthy();
  jest.mocked(getBoardById).mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });
  expect(view.getByText(post.title)).toBeTruthy();
  expect(view.getByText(errorText)).toBeTruthy();
  expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
});

test('board detail clears posts after school access is denied on refresh', async () => {
  const view = render(<BoardDetailScreen route={route} />);
  expect(await view.findByText(post.title)).toBeTruthy();
  jest.mocked(getBoardById).mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  await act(async () => {
    view.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });
  expect(view.queryByText(post.title)).toBeNull();
  expect(view.getByText(errorText)).toBeTruthy();
});

test('a late response from the previous school cannot replace the new school board', async () => {
  let resolveOld!: (posts: typeof post[]) => void;
  jest.mocked(fetchRecentCampusPosts).mockImplementationOnce(
    () => new Promise((resolve) => { resolveOld = resolve; }),
  );
  const view = render(<BoardDetailScreen route={route} />);
  mockSchoolId = 'other';
  const otherPost = { ...post, id: 'post-other', schoolId: 'other', title: '其他學校文章' };
  jest.mocked(fetchRecentCampusPosts).mockResolvedValueOnce([otherPost]);
  view.rerender(<BoardDetailScreen route={route} />);
  expect(await view.findByText(otherPost.title)).toBeTruthy();
  await act(async () => { resolveOld([post]); });
  expect(view.queryByText(post.title)).toBeNull();
  expect(view.getByText(otherPost.title)).toBeTruthy();
});
