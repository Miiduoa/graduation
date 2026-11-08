import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { PostDetailScreen } from '../screens/social/PostDetailScreen';
import { getCampusPostById } from '../services/feed';
import { listCampusReplies } from '../services/threads';

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
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
