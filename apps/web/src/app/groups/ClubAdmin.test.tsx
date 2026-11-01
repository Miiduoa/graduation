import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubBoard } from './ClubAdmin';
import { callClub } from './clubService';
vi.mock('./clubService', () => ({ callClub: vi.fn(), clubEnabled: () => true }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({}) }));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({ useBrowsingSchoolPageContext: () => ({}) }));
const view = {
  success: true,
  role: 'member',
  members: [{ id: 'one', name: '測試社員', role: '社員' }],
  events: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callClub).mockResolvedValue(view);
});
test('社員空狀態沒有管理操作及私人欄位', async () => {
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('尚無活動');
  expect(screen.queryByText('學號')).toBeNull();
  expect(screen.queryByText('建立活動')).toBeNull();
  expect(screen.queryByText('匯出社員與活動 CSV')).toBeNull();
});
test('幹部看見名單與真實計數，報名後重讀伺服器資料', async () => {
  vi.mocked(callClub).mockResolvedValue({
    ...view,
    role: 'admin',
    events: [
      {
        id: 'event',
        title: '合成活動',
        location: '',
        startsAt: Date.now() + 3600000,
        endsAt: Date.now() + 7200000,
        registered: 2,
        checkedIn: 1,
        mine: false,
        registrations: [],
      },
    ],
  });
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('報名 2 人 · 簽到 1 人 · 簽到率 50%');
  expect(screen.getByText('學號')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^報名$/ }));
  await waitFor(() =>
    expect(callClub).toHaveBeenCalledWith('one', 'school', 'club', {
      action: 'register',
      eventId: 'event',
    }),
  );
  await screen.findByText('已由伺服器確認');
});
test('撤權後清除舊名單並顯示錯誤', async () => {
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('測試社員');
  vi.mocked(callClub).mockRejectedValue(new Error('身分失效'));
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('測試社員')).toBeNull();
});
