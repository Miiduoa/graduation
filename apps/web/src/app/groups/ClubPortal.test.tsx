import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubPortal as ClubProfile } from './ClubPortal';
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

test('一般社員載入超過三場活動後保留全部活動並可報名第五場', async () => {
  const event: NonNullable<ClubPortalView['events']>[number] = {
    id: 'first',
    title: '第一場活動',
    location: '教室',
    startsAt: Date.now() + 100000,
    endsAt: Date.now() + 200000,
    capacity: 10,
    registrationDeadline: Date.now() + 90000,
    cancellationDeadline: 3000,
    visibility: 'public',
    registered: 0,
    checkedIn: 0,
    mine: false,
    myCheckIn: false,
  };
  const events = Array.from({ length: 5 }, (_, index) => ({
    ...event,
    id: `event-${index + 1}`,
    title: `第${index + 1}場活動`,
  }));
  const memberProfile = { ...profile, role: 'member', status: 'active' };
  vi.mocked(callClubPortal).mockResolvedValue({
    ...memberProfile,
    events: events.slice(0, 3),
    eventCursor: 'event-3',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('載入更多活動');
  vi.mocked(callClubPortal).mockResolvedValue({
    ...memberProfile,
    events: events.slice(3),
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多活動' }));
  await screen.findByText(/第5場活動/);
  for (const row of events) {
    expect(screen.getByText(new RegExp(row.title))).toBeTruthy();
  }
  expect(screen.queryByText('載入更多活動')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    eventCursor: 'event-3',
  });
  fireEvent.click(screen.getAllByRole('button', { name: '報名', exact: true })[4]);
  await waitFor(() =>
    expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
      action: 'register',
      groupId: 'club',
      eventId: 'event-5',
    }),
  );
});

test('待審申請分頁保留已載入名單，失敗可重試', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    requests: [{ id: 'first', name: '第一位申請者' }],
    requestCursor: 'first',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  await screen.findByText('第一位申請者');
  vi.mocked(callClubPortal).mockRejectedValueOnce(new Error('請重試'));
  fireEvent.click(screen.getByRole('button', { name: '載入更多待審申請' }));
  await screen.findByText('請重試');
  expect(screen.getByText('第一位申請者')).toBeTruthy();
  vi.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    requests: [{ id: 'second', name: '第二位申請者' }],
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多待審申請' }));
  await screen.findByText('第二位申請者');
  expect(screen.getByText('第一位申請者')).toBeTruthy();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    requestCursor: 'first',
  });
  await waitFor(() => expect(screen.queryByText('載入更多待審申請')).toBeNull());
});

test('活動報名名單獨立分頁並保留其他活動與已載入名單', async () => {
  const event: NonNullable<ClubPortalView['events']>[number] = {
    id: 'first',
    title: '第一場活動',
    location: '教室',
    startsAt: Date.now() + 100000,
    endsAt: Date.now() + 200000,
    capacity: 200,
    registrationDeadline: 4000,
    cancellationDeadline: 3000,
    visibility: 'public',
    registered: 101,
    checkedIn: 0,
    mine: false,
    myCheckIn: false,
    registrationCursor: 'first-person',
    registrations: [{ uid: 'first-person', name: '第一位參加者', checkedInAt: null }],
  };
  vi.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    events: [
      event,
      {
        ...event,
        id: 'second',
        title: '第二場活動',
        registrationCursor: undefined,
        registrations: [],
      },
    ],
    eventCursor: 'second',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  vi.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    events: [
      {
        ...event,
        registrationCursor: undefined,
        registrations: [{ uid: 'last-person', name: '最後一位參加者', checkedInAt: null }],
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多報名名單' }));
  await screen.findByText(/最後一位參加者/);
  expect(screen.getByText(/第一位參加者/)).toBeTruthy();
  expect(screen.getByText(/第二場活動/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '載入更多活動' })).toBeTruthy();
  expect(screen.queryByText('載入更多報名名單')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    rosterEventId: 'first',
    registrationCursor: 'first-person',
  });
});

vi.mock('./ClubCheckIn', () => ({
  ClubCheckIn: ({ acceptingCheckIns }: { acceptingCheckIns: boolean }) => (
    <span>{acceptingCheckIns ? '測試簽到開放' : '測試佇列管理'}</span>
  ),
}));

test('活動結束保留佇列管理；完整報名名單載入前不判定社員未報名', async () => {
  const event = {
    id: 'ended',
    title: '已結束合成活動',
    location: '測試教室',
    startsAt: 1,
    endsAt: 2,
    capacity: 200,
    registrationDeadline: 1,
    cancellationDeadline: 1,
    visibility: 'public',
    registered: 101,
    checkedIn: 0,
    mine: false,
    myCheckIn: false,
    registrations: [{ uid: 'first', name: '首位', checkedInAt: null }],
    registrationCursor: 'first',
  };
  vi.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    role: 'admin',
    status: 'active',
    events: [event],
    members: [
      { id: 'later', name: '後頁社員', role: 'member', phone: '', duesPaid: false },
      { id: 'absent', name: '未報名社員', role: 'member', phone: '', duesPaid: false },
    ],
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  expect(screen.getByText('測試佇列管理')).toBeTruthy();
  expect(screen.queryByText(/這位不在報名名單/)).toBeNull();
  expect(screen.queryByText('仍然簽到')).toBeNull();
  vi.mocked(callClubPortal).mockRejectedValueOnce(new Error('測試分頁失敗'));
  fireEvent.click(screen.getByRole('button', { name: '載入更多報名名單' }));
  await screen.findByText('測試分頁失敗');
  expect(screen.queryByText(/這位不在報名名單/)).toBeNull();
  vi.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    events: [
      {
        ...event,
        registrationCursor: undefined,
        registrations: [{ uid: 'later', name: '後頁報名者', checkedInAt: null }],
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: '載入更多報名名單' }));
  await screen.findByText(/未報名社員 · 這位不在報名名單/);
  expect(screen.queryByText(/後頁社員 · 這位不在報名名單/)).toBeNull();
});
