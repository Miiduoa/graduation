import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubProfile } from './ClubProfile';
import { callClubPortal } from './clubPortalService';
import { leaveMemberGroup } from './groupService';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
vi.mock('./clubPortalService', () => ({ callClubPortal: vi.fn() }));
vi.mock('./groupService', () => ({ leaveMemberGroup: vi.fn() }));
const profile: ClubPortalView = {
  success: true,
  office: false,
  club: {
    id: 'club',
    name: '攝影社',
    description: '週三社課',
    category: '學藝',
    meetingTime: '週三',
    recruiting: true,
    approval: 'approved',
    joinPolicy: 'open',
    memberCount: 3,
    instagram: '',
    line: '',
  },
  role: 'visitor',
  status: 'none',
  events: [],
  announcements: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(callClubPortal).mockResolvedValue(profile);
});
test('開放社團一鍵加入，伺服器確認後才呈現已加入', async () => {
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('heading', { name: '攝影社' });
  vi.mocked(callClubPortal).mockResolvedValue({ ...profile, status: 'active', role: 'member' });
  fireEvent.click(screen.getByRole('button', { name: '加入' }));
  await screen.findByRole('button', { name: '已加入' });
  expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', { action: 'join', groupId: 'club' });
});
test('需審核社團送出後顯示鎖定文案，未核可不冒充正式社團', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    club: { ...profile.club!, joinPolicy: 'review' },
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('申請加入');
  vi.mocked(callClubPortal).mockResolvedValue({ ...profile, status: 'pending' });
  fireEvent.click(screen.getByRole('button', { name: '申請加入' }));
  await waitFor(() =>
    expect(screen.getAllByText('已送出申請，等幹部回覆').length).toBeGreaterThan(0),
  );
});
test('幹部可審核、編輯、建立活動；學生看不到管理與電話', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    requests: [{ id: 'applicant', name: '申請人' }],
    members: [{ id: 'one', name: '社員', role: 'member', phone: '', duesPaid: false }],
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  expect(screen.getByText('編輯社團介紹')).toBeTruthy();
  expect(screen.getByText('新增活動')).toBeTruthy();
  expect(screen.getByText(/電話 未提供/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '通過' }));
  await waitFor(() =>
    expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', {
      groupId: 'club',
      action: 'review',
      targetUid: 'applicant',
      decision: 'approved',
    }),
  );
});
test('退出需確認並沿用既有 API', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({ ...profile, status: 'active', role: 'member' });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('已加入');
  fireEvent.click(screen.getByRole('button', { name: '退出社團' }));
  expect(leaveMemberGroup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '確認退出社團' }));
  await waitFor(() =>
    expect(leaveMemberGroup).toHaveBeenCalledWith('one', 'pu', 'club', expect.any(Function)),
  );
});
test('切換社團或帳號忽略延遲回應；可重試錯誤', async () => {
  let finish!: (value: ClubPortalView) => void;
  vi.mocked(callClubPortal).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="old" />);
  view.rerender(<ClubProfile uid="two" schoolId="pu" groupId="new" />);
  await screen.findByText('週三社課');
  await act(async () => finish({ ...profile, club: { ...profile.club!, name: '舊社團' } }));
  expect(screen.queryByText('舊社團')).toBeNull();
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
});

test('分頁載入更多社員會保留先前名冊，失敗可重試', async () => {
  const first = { id: 'one', name: '第一位社員', role: 'member', phone: '', duesPaid: false };
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    members: [first],
    memberCursor: 'one',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('載入更多社員');
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  vi.mocked(callClubPortal).mockRejectedValueOnce(new Error('暫時無法讀取'));
  fireEvent.click(screen.getByRole('button', { name: '載入更多社員' }));
  await screen.findByText('暫時無法讀取');
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    members: [{ ...first, id: 'two', name: '第二位社員' }],
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多社員' }));
  await screen.findByText(/第二位社員/);
  expect(screen.getByText(/第一位社員/)).toBeTruthy();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    memberCursor: 'one',
  });
  expect(screen.queryByText('載入更多社員')).toBeNull();
});

test('活動分頁保留前頁活動並在末頁移除載入按鈕', async () => {
  const event: NonNullable<ClubPortalView['events']>[number] = {
    id: 'first',
    title: '第一場活動',
    location: '教室',
    startsAt: Date.now() + 100000,
    endsAt: Date.now() + 200000,
    capacity: 10,
    registrationDeadline: 4000,
    cancellationDeadline: 3000,
    visibility: 'public',
    registered: 0,
    checkedIn: 0,
    mine: false,
    myCheckIn: false,
  };
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    events: [event],
    eventCursor: 'first',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('載入更多活動');
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    events: [{ ...event, id: 'last', title: '最後一場活動' }],
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多活動' }));
  await screen.findByText(/最後一場活動/);
  expect(screen.getByText(/第一場活動/)).toBeTruthy();
  expect(screen.queryByText('載入更多活動')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    eventCursor: 'first',
  });
});
