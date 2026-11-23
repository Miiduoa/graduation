import React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CreatorProfileScreen } from '../screens/social/CreatorProfileScreen';
import { listCreatorPosts, readCreatorIdentity } from '../services/creatorProfile';
import { loadCampusPostBookmarks } from '../services/campusPostBookmarks';
import { followUser, listFollowingIds, unfollowUser } from '../services/follows';
import { readCreatorCard, saveCreatorCard } from '../services/creatorCard';
import { readCreatorPin, saveCreatorPin } from '../services/creatorPin';

const mockAuth = {
  user: { uid: 'alice', displayName: 'Alice' } as { uid: string; displayName: string } | null,
  profile: null as null | { uid: string; displayName: string },
  loading: false,
};
const mockSchool = { id: 'pu', name: '靜宜大學' };
let mockSelectionReady = true;
let mockFirebase = false;
const navigate = jest.fn();

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, selectionReady: mockSelectionReady }),
}));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => mockFirebase }));
jest.mock('../screens/social/CreatorHighlight', () => ({ CreatorHighlight: () => null }));
jest.mock('../services/creatorProfile', () => ({
  listCreatorPosts: jest.fn(),
  readCreatorIdentity: jest.fn(),
}));
jest.mock('../services/creatorPin', () => ({
  readCreatorPin: jest.fn(),
  saveCreatorPin: jest.fn(),
}));
jest.mock('../services/creatorCard', () => ({
  ...jest.requireActual('../services/creatorCard'),
  readCreatorCard: jest.fn(async () => null),
  saveCreatorCard: jest.fn(),
}));
jest.mock('../services/campusPostBookmarks', () => ({
  loadCampusPostBookmarks: jest.fn(),
}));
jest.mock('../services/follows', () => ({
  listFollowingIds: jest.fn(),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
}));

const myPost = {
  id: 'post-1', schoolId: 'pu', boardId: 'board', anonymous: false,
  authorUid: 'alice', title: '我的校園貼文', content: '校園日常',
  mediaUrls: ['https://example.test/a.png'], likes: 3, commentCount: 2,
};
const theirPost = { ...myPost, id: 'post-2', title: '同學的社團貼文', authorUid: 'bob' };
const page = (posts: typeof myPost[], hasMore = false) => ({
  posts, hasMore, cursor: hasMore ? { id: 'cursor' } : null,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readCreatorCard).mockReset().mockResolvedValue(null);
  jest.mocked(saveCreatorCard).mockReset();
  mockAuth.user = { uid: 'alice', displayName: 'Alice' };
  mockAuth.profile = null;
  mockAuth.loading = false;
  mockSchool.id = 'pu';
  mockSchool.name = '靜宜大學';
  mockSelectionReady = true;
  mockFirebase = false;
  jest.mocked(readCreatorIdentity).mockResolvedValue({ displayName: 'Alice', avatarUrl: null });
  jest.mocked(listCreatorPosts).mockResolvedValue(page([myPost]));
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({ ids: [], posts: [] });
  jest.mocked(listFollowingIds).mockResolvedValue([]);
  jest.mocked(followUser).mockResolvedValue(undefined);
  jest.mocked(unfollowUser).mockResolvedValue(undefined);
  jest.mocked(readCreatorPin).mockResolvedValue({ postId: null, post: null });
  jest.mocked(saveCreatorPin).mockResolvedValue({ postId: null, post: null });
});

test('owner manages posts, media, saved posts and publishing without private-account data', async () => {
  jest.mocked(loadCampusPostBookmarks).mockResolvedValue({
    ids: ['saved'], posts: [{ ...myPost, id: 'saved', title: '私人收藏的貼文' }],
  });
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  expect(await screen.findByText('我的校園貼文')).toBeTruthy();
  expect(screen.getByText('已載入 1 則公開貼文')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('發表貼文'));
  expect(navigate).toHaveBeenCalledWith('CreatorPostCompose');
  fireEvent.press(screen.getByLabelText('相片與影片'));
  expect(screen.getByLabelText('查看媒體貼文：我的校園貼文')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('我的收藏'));
  expect(await screen.findByText('私人收藏的貼文')).toBeTruthy();
  expect(loadCampusPostBookmarks).toHaveBeenCalledWith('alice', 'pu', 40);
});

test('the media grid represents every photo of a single creator post', async () => {
  jest.mocked(listCreatorPosts).mockResolvedValueOnce(page([{
    ...myPost,
    mediaUrls: ['https://example.test/first.png', 'https://example.test/second.png'],
  }]));
  const view = render(
    <CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />,
  );
  await view.findByText('我的校園貼文');
  fireEvent.press(view.getByLabelText('相片與影片'));
  expect(view.getByLabelText('查看媒體貼文：我的校園貼文（第 1 張）')).toBeTruthy();
  expect(view.getByLabelText('查看媒體貼文：我的校園貼文（第 2 張）')).toBeTruthy();
  fireEvent.press(view.getByLabelText('查看媒體貼文：我的校園貼文（第 2 張）'));
  expect(navigate).toHaveBeenCalledWith('PostDetail', { postId: 'post-1' });
});

test('another member can be followed but never sees personal saved posts', async () => {
  jest.mocked(readCreatorIdentity).mockResolvedValue({ displayName: 'Bob', avatarUrl: null });
  jest.mocked(listCreatorPosts).mockResolvedValue(page([theirPost]));
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'bob', schoolId: 'pu' } }} navigation={{ navigate }} />);
  expect(await screen.findByText('同學的社團貼文')).toBeTruthy();
  expect(screen.queryByLabelText('我的收藏')).toBeNull();
  expect(loadCampusPostBookmarks).not.toHaveBeenCalled();
  fireEvent.press(await screen.findByLabelText('追蹤'));
  await act(async () => {});
  expect(followUser).toHaveBeenCalledWith('pu', 'alice', 'bob');
  fireEvent.press(screen.getByLabelText('追蹤中'));
  await act(async () => {});
  expect(unfollowUser).toHaveBeenCalledWith('pu', 'alice', 'bob');
});

test('does not turn an unavailable follow read into an unfollowed state', async () => {
  jest.mocked(readCreatorIdentity).mockResolvedValue({ displayName: 'Bob', avatarUrl: null });
  jest.mocked(listFollowingIds).mockRejectedValueOnce(new Error('permission-denied'));
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'bob' } }} navigation={{ navigate }} />);
  expect(await screen.findByLabelText('重試追蹤')).toBeTruthy();
  expect(screen.queryByLabelText('追蹤')).toBeNull();
  fireEvent.press(screen.getByLabelText('重試追蹤'));
  expect(await screen.findByLabelText('追蹤')).toBeTruthy();
  expect(listFollowingIds).toHaveBeenCalledTimes(2);
});

test('missing or revoked post access is retryable, not mislabeled as no posts', async () => {
  jest.mocked(listCreatorPosts).mockRejectedValueOnce(new Error('permission-denied'));
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  expect(await screen.findByText('內容暫時無法讀取，請確認連線與校園資格。')).toBeTruthy();
  expect(screen.queryByText('你還沒有用公開身分發表貼文。')).toBeNull();
  fireEvent.press(screen.getByLabelText('重新讀取'));
  expect(await screen.findByText('我的校園貼文')).toBeTruthy();
});

test('blocks a deep link to another school without fetching content', () => {
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'bob', schoolId: 'other' } }} navigation={{ navigate }} />);
  expect(screen.getByText('這個個人頁屬於另一所校園，請先切換至該校。')).toBeTruthy();
  expect(readCreatorIdentity).not.toHaveBeenCalled();
  expect(listCreatorPosts).not.toHaveBeenCalled();
});

test('account and school changes detach the previous profile immediately', async () => {
  jest.mocked(listCreatorPosts).mockResolvedValueOnce(page([myPost]));
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  await screen.findByText('我的校園貼文');
  mockAuth.user = { uid: 'bob', displayName: 'Bob' };
  mockSchool.id = 'other';
  screen.rerender(<CreatorProfileScreen route={{ params: { memberUid: 'bob' } }} navigation={{ navigate }} />);
  expect(screen.queryByText('我的校園貼文')).toBeNull();
});

test('requires authenticated campus scope before querying', () => {
  mockAuth.loading = true;
  const screen = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  expect(screen.getByText('正在確認登入與校園…')).toBeTruthy();
  expect(readCreatorIdentity).not.toHaveBeenCalled();
  expect(listCreatorPosts).not.toHaveBeenCalled();
});


test('an owner can pin a post and later unpin without losing the post', async () => {
  jest.mocked(saveCreatorPin)
    .mockResolvedValueOnce({ postId: myPost.id, post: myPost })
    .mockResolvedValueOnce({ postId: null, post: null });
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  await view.findByText('我的校園貼文');
  await act(async () => { fireEvent.press(await view.findByLabelText('置頂到個人頁')); });
  expect(saveCreatorPin).toHaveBeenCalledWith('pu', 'alice', myPost.id);
  expect(view.getByLabelText('閱讀置頂貼文：我的校園貼文')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('取消置頂')); });
  expect(saveCreatorPin).toHaveBeenCalledWith('pu', 'alice', '');
  expect(await view.findByLabelText('置頂到個人頁')).toBeTruthy();
  expect(view.queryByLabelText('閱讀置頂貼文：我的校園貼文')).toBeNull();
});

test('a visitor can read a verified pinned post but cannot modify it', async () => {
  jest.mocked(readCreatorIdentity).mockResolvedValue({ displayName: 'Bob', avatarUrl: null });
  jest.mocked(listCreatorPosts).mockResolvedValue(page([]));
  jest.mocked(readCreatorPin).mockResolvedValue({ postId: theirPost.id, post: theirPost });
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'bob' } }} navigation={{ navigate }} />);
  expect(await view.findByLabelText('閱讀置頂貼文：同學的社團貼文')).toBeTruthy();
  expect(view.queryByLabelText('取消置頂')).toBeNull();
  expect(view.queryByLabelText('置頂到個人頁')).toBeNull();
  expect(saveCreatorPin).not.toHaveBeenCalled();
});

test('an unconfirmed pin write does not claim success or remove the post', async () => {
  jest.mocked(saveCreatorPin).mockRejectedValueOnce(new Error('offline'));
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  await view.findByText('我的校園貼文');
  await act(async () => { fireEvent.press(await view.findByLabelText('置頂到個人頁')); });
  expect(view.getByText(/尚未確認置頂變更/)).toBeTruthy();
  expect(view.getByText('我的校園貼文')).toBeTruthy();
  expect(view.queryByLabelText('取消置頂')).toBeNull();
});

test('a denied pin read is retried, never treated as an empty pin', async () => {
  jest.mocked(readCreatorPin)
    .mockRejectedValueOnce(new Error('permission-denied'))
    .mockResolvedValueOnce({ postId: null, post: null });
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} navigation={{ navigate }} />);
  fireEvent.press(await view.findByLabelText('重新讀取置頂'));
  expect(await view.findByLabelText('置頂到個人頁')).toBeTruthy();
  expect(readCreatorPin).toHaveBeenCalledTimes(2);
});

test('tab changes and refreshes reload cards created, edited and cleared on another device', async () => {
  const card = { headline: '', bio: '另一台裝置建立的簡介', linkUrl: '' };
  const updated = { ...card, bio: '另一台裝置修改的簡介' };
  const reads = jest.mocked(readCreatorCard)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(card)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(updated)
    .mockResolvedValueOnce(null);
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  expect(await view.findByLabelText('建立社群簡介')).toBeTruthy();
  fireEvent.press(view.getByLabelText('相片與影片'));
  expect(await view.findByText(card.bio)).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByLabelText('我的收藏')); });
  expect(view.getByText(card.bio)).toBeTruthy();
  expect(view.queryByText('社群簡介暫時無法讀取。')).toBeNull();
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  expect(await view.findByText(updated.bio)).toBeTruthy();

  fireEvent.press(view.getByLabelText('貼文'));
  expect(await view.findByLabelText('建立社群簡介')).toBeTruthy();
  expect(view.queryByText(updated.bio)).toBeNull();
  expect(reads).toHaveBeenCalledTimes(5);
  expect(reads).toHaveBeenLastCalledWith('pu', 'alice');
});

test.each(['save now', 'reopen editor'])('tab refresh merges only the changed fields before %s', async (action) => {
  const original = { headline: '舊標題', bio: '舊簡介', linkUrl: '' };
  const latest = { headline: '他機標題', bio: '他機簡介', linkUrl: 'https://example.org/' };
  const merged = { ...latest, headline: '本機標題' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(original).mockResolvedValueOnce(latest);
  jest.mocked(saveCreatorCard).mockResolvedValueOnce(merged);
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), merged.headline);
  fireEvent.changeText(view.getByLabelText('作品連結'), 'https://example.net/');
  fireEvent.changeText(view.getByLabelText('作品連結'), '');
  await act(async () => { fireEvent.press(view.getByLabelText('相片與影片')); });
  expect(view.getByLabelText('一句話介紹').props.value).toBe(merged.headline);
  expect(view.getByLabelText('個人簡介').props.value).toBe(latest.bio);
  expect(view.getByLabelText('作品連結').props.value).toBe(latest.linkUrl);
  if (action === 'reopen editor') {
    fireEvent.press(view.getByLabelText('取消編輯'));
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(view.getByLabelText('一句話介紹').props.value).toBe(latest.headline);
    expect(view.getByLabelText('個人簡介').props.value).toBe(latest.bio);
    fireEvent.changeText(view.getByLabelText('一句話介紹'), merged.headline);
  }
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', merged, expect.any(Function));
});

test('access denial on refresh hides the external card until an authorized retry succeeds', async () => {
  const old = { headline: '', bio: '校園限定簡介', linkUrl: 'https://example.org/' };
  const latest = { ...old, bio: '重新授權後的簡介' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(old)
    .mockRejectedValueOnce({ code: 'unavailable' })
    .mockRejectedValueOnce({ code: 'permission-denied' })
    .mockRejectedValueOnce({ code: 'unavailable' })
    .mockResolvedValueOnce(latest);
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'bob' } }} />);
  expect(await view.findByText(old.bio)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('相片與影片')); });
  expect(view.getByText(old.bio)).toBeTruthy();
  expect(view.getByLabelText('查看作品連結')).toBeTruthy();
  await act(async () => { fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh'); });
  expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
  expect(view.queryByText(old.bio)).toBeNull();
  expect(view.queryByLabelText('查看作品連結')).toBeNull();
  await act(async () => { fireEvent.press(view.getByLabelText('重新讀取社群簡介')); });
  expect(view.queryByText(old.bio)).toBeNull();
  fireEvent.press(view.getByLabelText('重新讀取社群簡介'));
  expect(await view.findByText(latest.bio)).toBeTruthy();
});

test('switching tabs and retrying the identity card refresh the intro while preserving the open draft', async () => {
  jest.mocked(readCreatorIdentity).mockRejectedValueOnce(new Error('offline'));
  const card = { headline: '', bio: '已發布簡介', linkUrl: '' };
  const updated = { ...card, bio: '伺服器新簡介' };
  const reads = jest.mocked(readCreatorCard).mockResolvedValueOnce(card)
    .mockResolvedValueOnce(null).mockResolvedValueOnce(updated);
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '本機草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('相片與影片')); });
  expect(view.getByLabelText('個人簡介').props.value).toBe('本機草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('重試名片')); });
  expect(reads).toHaveBeenCalledTimes(3);
  expect(view.getByLabelText('個人簡介').props.value).toBe('本機草稿');
  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText(updated.bio)).toBeTruthy();
});

test.each(['old card', 'access denial'])('rapid tab changes ignore a stale %s', async (result) => {
  const card = { headline: '', bio: '最新簡介', linkUrl: '' };
  let resolveMedia!: (value: typeof card) => void;
  let rejectMedia!: (error: { code: string }) => void;
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null)
    .mockReturnValueOnce(new Promise((resolve, reject) => {
      resolveMedia = resolve;
      rejectMedia = reject;
    }))
    .mockResolvedValueOnce(card);
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  await view.findByLabelText('建立社群簡介');
  fireEvent.press(view.getByLabelText('相片與影片'));
  fireEvent.press(view.getByLabelText('我的收藏'));
  expect(await view.findByText(card.bio)).toBeTruthy();
  await act(async () => {
    if (result === 'access denial') rejectMedia({ code: 'permission-denied' });
    else resolveMedia({ ...card, bio: '過期簡介' });
  });
  expect(view.getByText(card.bio)).toBeTruthy();
  expect(view.queryByText('過期簡介')).toBeNull();
});

test('a save resolving after access denial cannot restore the hidden card', async () => {
  const original = { headline: '', bio: '舊簡介', linkUrl: 'https://example.org/' };
  const saved = { ...original, bio: '已確認的簡介' };
  let resolveSave!: (value: typeof saved) => void;
  jest.mocked(readCreatorCard).mockResolvedValueOnce(original)
    .mockRejectedValueOnce({ code: 'firestore/unauthenticated' });
  jest.mocked(saveCreatorCard).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), saved.bio);
  fireEvent.press(view.getByLabelText('儲存簡介'));
  await act(async () => { fireEvent.press(view.getByLabelText('相片與影片')); });
  expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
  await act(async () => { resolveSave(saved); });
  expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
  expect(view.queryByText(saved.bio)).toBeNull();
  expect(view.queryByLabelText('查看作品連結')).toBeNull();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

test('an intro refresh started during a save cannot replace its confirmed result', async () => {
  const card = { headline: '', bio: '原本的簡介', linkUrl: '' };
  const saved = { ...card, bio: '剛確認的簡介' };
  let resolveRefresh!: (value: typeof card) => void;
  let resolveSave!: (value: typeof card) => void;
  jest.mocked(readCreatorCard).mockResolvedValueOnce(card)
    .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
  jest.mocked(saveCreatorCard).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
  const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), saved.bio);
  fireEvent.press(view.getByLabelText('儲存簡介'));
  fireEvent.press(view.getByLabelText('相片與影片'));
  await act(async () => { resolveSave(saved); });
  await act(async () => { resolveRefresh(card); });
  expect(view.getByText(saved.bio)).toBeTruthy();
  expect(view.queryByText(card.bio)).toBeNull();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

// The merge-base keeps the entire draft when an uncertain editor closes.
// The timeout states and the explicit mismatch restore action extend that
// expectation to the confirmation controls in this branch.
describe.each(['pending', 'save timeout', 'checking', 'check failed'] as const)(
  'merge-base draft behavior with write %s', (status) => {
    describe.each(['cancel and reopen', 'switch tabs', 'refresh'] as const)('%s', (action) => {
      const published = { headline: '原標題', bio: '原簡介', linkUrl: 'https://example.org/' };
      const submitted = { ...published, headline: '送出的標題', bio: '送出的簡介' };
      const latest = { ...published, headline: '其他裝置的標題', bio: '其他裝置的簡介' };
      const labels = { headline: '一句話介紹', bio: '個人簡介', linkUrl: '作品連結' } as const;
      const fields = ['headline', 'bio', 'linkUrl'] as const;

      describe.each([
        ['headline', { headline: '追加的標題' }],
        ['bio', { bio: '追加的簡介' }],
        ['link', { linkUrl: 'https://example.net/' }],
        ['multiple fields and explicit clears', { headline: '', bio: '追加的簡介', linkUrl: '' }],
      ] as const)('%s', (_field, later) => {
        test.each(['success', 'mismatch', 'timeout', 'failure'] as const)('check outcome: %s', async (outcome) => {
          jest.useFakeTimers();
          try {
            const reads = jest.mocked(readCreatorCard).mockResolvedValueOnce(published);
            const saves = jest.mocked(saveCreatorCard);
            if (status === 'save timeout') {
              saves.mockReturnValueOnce(new Promise(() => {}));
            } else {
              saves.mockRejectedValueOnce(new Error('write result unknown'));
            }

            const view = render(<CreatorProfileScreen route={{ params: { memberUid: 'alice' } }} />);
            const press = (label: string) => fireEvent.press(view.getByLabelText(label));
            const expectDraft = (draft: typeof published) => {
              for (const field of fields) expect(view.getByLabelText(labels[field]).props.value).toBe(draft[field]);
            };
            await act(async () => {});
            press('編輯社群簡介');
            fireEvent.changeText(view.getByLabelText(labels.headline), submitted.headline);
            fireEvent.changeText(view.getByLabelText(labels.bio), submitted.bio);
            await act(async () => { press('儲存簡介'); });
            if (status === 'save timeout') act(() => { jest.advanceTimersByTime(15_000); });
            for (const field of fields) {
              const value = (later as Partial<typeof published>)[field];
              if (value !== undefined) fireEvent.changeText(view.getByLabelText(labels[field]), value);
            }
            const draft = { ...submitted, ...later };

            if (status === 'check failed') {
              reads.mockRejectedValueOnce(new Error('offline'));
              await act(async () => { press('核對儲存結果'); });
              expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
            }
            let resolveCheck!: (value: typeof published) => void;
            let rejectCheck!: (error: Error) => void;
            const startCheck = () => {
              reads.mockReturnValueOnce(new Promise((resolve, reject) => {
                resolveCheck = resolve;
                rejectCheck = reject;
              }));
              press('核對儲存結果');
            };
            if (status === 'checking') startCheck();

            if (action === 'switch tabs') {
              for (const tab of ['相片與影片', '我的收藏', '貼文']) {
                reads.mockResolvedValueOnce(latest);
                await act(async () => { press(tab); });
                expectDraft(draft);
              }
            } else if (action === 'refresh') {
              reads.mockResolvedValueOnce(latest);
              await act(async () => {
                fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
              });
              expect(listCreatorPosts).toHaveBeenCalledTimes(2);
            } else {
              press('取消編輯');
              if (status === 'checking') {
                expect(view.getByLabelText('取消編輯').props.accessibilityState.disabled).toBe(true);
              } else {
                expect(view.getByText(published.bio)).toBeTruthy();
                press('編輯社群簡介');
              }
            }
            expectDraft(draft);
            if (status !== 'checking') {
              // Use the published-view check after a real close in the mismatch
              // cases, to exercise restoration when no editor is mounted.
              if (action === 'cancel and reopen' && outcome === 'mismatch') press('取消編輯');
              startCheck();
            }
            expect(view.getByText('核對中')).toBeTruthy();

            if (outcome === 'success') {
              await act(async () => { resolveCheck(submitted); });
              expect(view.getByText(/上一筆已確認儲存/)).toBeTruthy();
              expectDraft(draft);
            } else if (outcome === 'mismatch') {
              await act(async () => { resolveCheck(latest); });
              expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
              if (view.queryByLabelText('編輯社群簡介')) press('編輯社群簡介');
              press('還原未確認的草稿');
              expectDraft(draft);
            } else {
              if (outcome === 'timeout') {
                act(() => { jest.advanceTimersByTime(15_000); });
                expect(view.getByText(/核對等待逾時/)).toBeTruthy();
                press('取消編輯');
                expectDraft(draft);
              }
              await act(async () => { rejectCheck(new Error('offline')); });
              expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
              press('取消編輯');
              press('編輯社群簡介');
              expectDraft(draft);
              expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
            }
            expect(saves).toHaveBeenCalledTimes(1);
          } finally {
            jest.useRealTimers();
          }
        });
      });
    });
  },
);
