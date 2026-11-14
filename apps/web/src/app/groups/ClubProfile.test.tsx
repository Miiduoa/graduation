import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubProfile } from './ClubProfile';
import { loadClubProfile } from './clubProfileService';

vi.mock('./clubProfileService', () => ({ loadClubProfile: vi.fn() }));
const profile = {
  id: 'club',
  schoolId: 'pu',
  type: 'club' as const,
  role: 'member',
  name: '攝影社',
  description: '週三社課',
  memberCount: 3,
  announcements: [
    {
      id: 'post',
      title: '社課通知',
      body: '帶相機',
      groupId: 'club',
      kind: 'announcement' as const,
      authorId: 'one',
      authorName: null,
      schoolId: 'pu',
      createdAt: null,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadClubProfile).mockResolvedValue(profile);
});
test('依規格呈現唯讀社團、真實公告與活動尚未串接的界線', async () => {
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('heading', { name: '攝影社' });
  expect(screen.getByRole('button', { name: '已加入' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('社課通知')).toBeTruthy();
  expect(screen.getByText('週三社課')).toBeTruthy();
  expect(screen.getByText('目前沒有排定的活動。')).toBeTruthy();
  expect(screen.getByText(/此頁尚未接入社團內部活動/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '申請加入' })).toBeNull();
  expect(screen.getByRole('link', { name: '查看社團討論與更多公告' }).getAttribute('href')).toBe(
    '/groups/club?schoolId=pu',
  );
});
test('讀取失敗可重試，幹部只看見鎖定管理說明', async () => {
  vi.mocked(loadClubProfile).mockRejectedValueOnce(new Error('network'));
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('alert');
  vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role: 'owner' });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取社團資料' }));
  await screen.findByText('這所學校還沒開放社團管理。');
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
});
test('切換社團時不顯示先前尚未完成的讀取結果', async () => {
  let finish!: (data: typeof profile) => void;
  vi.mocked(loadClubProfile).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="old" />);
  view.rerender(<ClubProfile uid="one" schoolId="pu" groupId="new" />);
  await screen.findByText('週三社課');
  await act(async () => finish({ ...profile, name: '舊社團' }));
  expect(screen.queryByText('舊社團')).toBeNull();
});
