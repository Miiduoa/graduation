import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RealtimeTab } from './RealtimeTab';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } },
  peers: vi.fn(),
  checkIn: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/community/pois', () => ({
  SOCIAL_POIS: [{ id: 'library', name: '圖書館', category: 'library' }, { id: 'classroom', name: '教室', category: 'academic' }],
  defaultSocialPoiId: () => 'library',
  findSocialPoi: (id: string) => ({ id, name: id === 'library' ? '圖書館' : '教室', category: 'library' }),
  SOCIAL_POI_CATEGORY_LABEL: { library: '校園地點' },
}));
vi.mock('@/lib/community/firestore', () => ({
  heartbeatCheckIn: mocks.checkIn,
  clearPresence: mocks.clear,
  peersAtPoi: mocks.peers,
  listActiveStoriesForSchool: vi.fn().mockResolvedValue([]),
  groupStoriesByAuthor: () => [],
  fetchSchoolDirectoryProfiles: (_school: string, uids: string[]) => Promise.resolve(uids.map((uid) => ({ uid, displayName: uid }))),
  markStoryViewed: vi.fn(),
}));
beforeEach(() => {
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
