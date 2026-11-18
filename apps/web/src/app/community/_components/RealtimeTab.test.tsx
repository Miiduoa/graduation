import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RealtimeTab } from './RealtimeTab';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } },
  peers: vi.fn(),
  stories: vi.fn(),
  groupStories: vi.fn(),
  checkIn: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/community/pois', () => ({
  SOCIAL_POIS: [{ id: 'library', name: '圖書館', category: 'library' }, { id: 'classroom', name: '教室', category: 'academic' }],
  verifiedSocialPoisForSchool: (schoolId: string) => schoolId === 'pu' || schoolId === 'tw-pu'
    ? [{ id: 'library', name: '圖書館', category: 'library' }, { id: 'classroom', name: '教室', category: 'academic' }]
    : [],
  defaultSocialPoiId: () => 'library',
  findSocialPoi: (id: string) => ({ id, name: id === 'library' ? '圖書館' : '教室', category: 'library' }),
  SOCIAL_POI_CATEGORY_LABEL: { library: '校園地點' },
}));
vi.mock('@/lib/community/firestore', () => ({
  heartbeatCheckIn: mocks.checkIn,
  clearPresence: mocks.clear,
  peersAtPoi: mocks.peers,
  listActiveStoriesForSchool: mocks.stories,
  groupStoriesByAuthor: mocks.groupStories,
  fetchSchoolDirectoryProfiles: (_school: string, uids: string[]) => Promise.resolve(uids.map((uid) => ({ uid, displayName: uid }))),
  markStoryViewed: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  mocks.stories.mockReset().mockResolvedValue([]);
  for (const method of ['showModal', 'close'] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, { configurable: true, value(this: HTMLDialogElement) { this.open = method === 'showModal'; } });
  }
  mocks.groupStories.mockReset().mockReturnValue([]);
  mocks.peers.mockReset().mockResolvedValue([]);
  mocks.checkIn.mockReset().mockResolvedValue('session');
  mocks.clear.mockReset().mockResolvedValue(undefined);
});

it('ties check-in status to its actual location and allows withdrawing it', async () => {
  render(<RealtimeTab schoolId="pu" />);
  await screen.findByText('這個地點目前沒有其他同學打卡。');
  fireEvent.click(screen.getByRole('button', { name: '我在這裡' }));
  await screen.findByText('已在這個地點打卡。你可以隨時取消。');
  await waitFor(() => expect((screen.getByRole('button', { name: '取消打卡' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /教室/ }));
  expect(screen.queryByText('已在這個地點打卡。你可以隨時取消。')).toBeNull();
  expect(screen.getByRole('button', { name: '我在這裡' })).toBeTruthy();
  expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: /圖書館/ }));
  fireEvent.click(screen.getByRole('button', { name: '取消打卡' }));
  await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('pu', 'session'));
  await screen.findByRole('button', { name: '我在這裡' });
  expect(mocks.checkIn).toHaveBeenCalledTimes(1);
});

it('does not show a delayed peer response from the previously selected location', async () => {
  let finishLibrary!: (value: { uid: string }[]) => void;
  mocks.peers.mockImplementation((_school: string, poi: string) => poi === 'library' ? new Promise((resolve) => { finishLibrary = resolve; }) : Promise.resolve([{ uid: '教室同學' }]));
  render(<RealtimeTab schoolId="pu" />);
  await waitFor(() => expect(mocks.peers).toHaveBeenCalledWith('pu', 'library'));
  fireEvent.click(screen.getByRole('button', { name: /教室/ }));
  await screen.findByText('教室同學');
  await act(async () => finishLibrary([{ uid: '圖書館同學' }]));
  expect(screen.queryByText('圖書館同學')).toBeNull();
  expect(screen.getByText('教室同學')).toBeTruthy();
});

it('labels the newest story as a video without mounting a player in the grid', async () => {
  mocks.groupStories.mockReturnValue([{
    authorUid: '阿杰', latestAt: Date.now(), stories: [{
      id: 'club-clip', schoolId: 'pu', authorUid: '阿杰', kind: 'video',
      text: '校隊今天練這一球', mediaUrl: '/practice.mp4', expiresAt: Date.now() + 60_000,
    }],
  }]);
  const { container } = render(<RealtimeTab schoolId="pu" />);
  const card = await screen.findByRole('button', { name: '查看 阿杰 的限時動態，最新一則是影片' });
  expect(card.textContent).toContain('校隊今天練這一球');
  expect(container.querySelector('video')).toBeNull();
});

it.each(['stories', 'peers'] as const)('preserves the open text story during refresh and a %s network failure, but clears denied stories', async (source) => {
  const story = { id: 'text', schoolId: 'pu', authorUid: 'bob', kind: 'text' as const,
    text: '校園近況', expiresAt: Date.now() + 120_000 };
  mocks.stories.mockResolvedValue([story]);
  mocks.groupStories.mockImplementation((rows) => rows.length ? [{ authorUid: 'bob', latestAt: 0, stories: rows }] : []);
  render(<RealtimeTab schoolId="pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看 bob 的限時動態' }));
  const viewer = screen.getByRole('dialog', { name: '限時動態' });
  let fail!: (error: unknown) => void;
  mocks[source].mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  // Changing location refreshes the realtime page while the story stays open.
  fireEvent.click(screen.getByRole('button', { name: /教室/ }));
  await waitFor(() => expect(fail).toBeTypeOf('function'));
  expect(screen.getByRole('dialog', { name: '限時動態' })).toBe(viewer);
  expect(screen.getByRole('button', { name: '查看 bob 的限時動態' })).toBeTruthy();
  await act(async () => fail(new Error('offline')));
  await screen.findByRole('alert');
  expect(screen.getByRole('dialog', { name: '限時動態' })).toBe(viewer);
  expect(screen.getByRole('button', { name: '查看 bob 的限時動態' })).toBeTruthy();
  mocks.stories.mockRejectedValueOnce({ code: 'permission-denied' });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '限時動態' })).toBeNull());
  expect(screen.queryByRole('button', { name: '查看 bob 的限時動態' })).toBeNull();
});


it('does not show the previous campus students or check-in when switching schools with the same POI', async () => {
  mocks.peers.mockImplementation((school: string) =>
    Promise.resolve([{ uid: school === 'pu' ? '甲校同學' : '乙校同學' }]));
  const { rerender } = render(<RealtimeTab schoolId="pu" />);
  await screen.findByText('甲校同學');
  fireEvent.click(screen.getByRole('button', { name: '我在這裡' }));
  await screen.findByText('已在這個地點打卡。你可以隨時取消。');

  rerender(<RealtimeTab schoolId="tw-pu" />);
  // The school changed; no previous campus identity or location claim may remain visible,
  // even for one render while the new Firestore request is pending.
  expect(screen.queryByText('甲校同學')).toBeNull();
  expect(screen.queryByText('已在這個地點打卡。你可以隨時取消。')).toBeNull();
  expect(screen.getByRole('button', { name: '我在這裡' })).toBeTruthy();

  await screen.findByText('乙校同學');
  expect(mocks.peers).toHaveBeenCalledWith('tw-pu', 'library');
  expect(mocks.clear).not.toHaveBeenCalledWith('tw-pu', 'session');
});
