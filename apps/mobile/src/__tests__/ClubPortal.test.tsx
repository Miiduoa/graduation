import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ClubPortal as ClubProfile } from '../screens/ClubPortal';
import { callClubPortal } from '../services/clubPortal';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
jest.mock('../services/clubExport', () => ({ shareClubCsv: jest.fn() }));
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
jest.mock('../screens/ClubCheckIn', () => ({ ClubCheckIn: () => null }));
jest.mock('../firebase', () => ({ getFunctionsInstance: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children }: any) => <View>{children}</View>,
    Button: ({ text, onPress, disabled }: any) => (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
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
  jest.resetAllMocks();
  jest.mocked(callClubPortal).mockResolvedValue(profile);
});
test('開放入社一鍵送出，確認後才顯示已加入', async () => {
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('加入');
  jest.mocked(callClubPortal).mockResolvedValue({ ...profile, status: 'active', role: 'member' });
  fireEvent.press(screen.getByText('加入'));
  await screen.findByText('已加入');
  expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', { action: 'join', groupId: 'club' });
});
test('審核申請顯示等待回覆；學生不顯示管理', async () => {
  jest
    .mocked(callClubPortal)
    .mockResolvedValue({ ...profile, club: { ...profile.club!, joinPolicy: 'review' } });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('申請加入');
  jest.mocked(callClubPortal).mockResolvedValue({ ...profile, status: 'pending' });
  fireEvent.press(screen.getByText('申請加入'));
  await waitFor(() =>
    expect(screen.getAllByText('已送出申請，等幹部回覆').length).toBeGreaterThan(0),
  );
  expect(screen.queryByText('管理')).toBeNull();
});
test('手機幹部可審核社員及新增活動公告', async () => {
  jest.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    status: 'active',
    role: 'admin',
    requests: [{ id: 'applicant', name: '申請人' }],
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.press(await screen.findByText('管理'));
  expect(screen.getByText('新增活動')).toBeTruthy();
  expect(screen.getByLabelText('公告內容')).toBeTruthy();
  fireEvent.press(screen.getByText('通過'));
  await waitFor(() =>
    expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', {
      groupId: 'club',
      action: 'review',
      targetUid: 'applicant',
      decision: 'approved',
    }),
  );
});
test('切換帳號丟棄舊回應', async () => {
  let finish!: (value: ClubPortalView) => void;
  jest.mocked(callClubPortal).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  view.rerender(<ClubProfile uid="two" schoolId="pu" groupId="club" />);
  await screen.findByText('週三社課');
  await act(async () => finish({ ...profile, club: { ...profile.club!, name: '舊社團' } }));
  expect(screen.queryByText('舊社團')).toBeNull();
});

test('分頁載入更多社員會保留先前名冊，失敗可重試', async () => {
  const first = { id: 'one', name: '第一位社員', role: 'member', phone: '', duesPaid: false };
  jest.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    members: [first],
    memberCursor: 'one',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('載入更多社員');
  fireEvent.press(screen.getByText('管理'));
  jest.mocked(callClubPortal).mockRejectedValueOnce(new Error('暫時無法讀取'));
  fireEvent.press(screen.getByText('載入更多社員'));
  await screen.findByText('暫時無法讀取');
  jest.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    members: [{ ...first, id: 'two', name: '第二位社員' }],
  });
  fireEvent.press(screen.getByText('載入更多社員'));
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
  jest
    .mocked(callClubPortal)
    .mockResolvedValue({ ...profile, events: [event], eventCursor: 'first' });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('載入更多活動');
  jest.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    events: [{ ...event, id: 'last', title: '最後一場活動' }],
  });
  fireEvent.press(screen.getByText('載入更多活動'));
  await screen.findByText(/最後一場活動/);
  expect(screen.getByText(/第一場活動/)).toBeTruthy();
  expect(screen.queryByText('載入更多活動')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    eventCursor: 'first',
  });
});

test('待審申請分頁保留已載入名單，失敗可重試', async () => {
  jest.mocked(callClubPortal).mockResolvedValue({
    ...profile,
    role: 'admin',
    status: 'active',
    requests: [{ id: 'first', name: '第一位申請者' }],
    requestCursor: 'first',
  });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.press(await screen.findByText('管理'));
  await screen.findByText('第一位申請者');
  jest.mocked(callClubPortal).mockRejectedValueOnce(new Error('請重試'));
  fireEvent.press(screen.getByText('載入更多待審申請'));
  await screen.findByText('請重試');
  expect(screen.getByText('第一位申請者')).toBeTruthy();
  jest.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    requests: [{ id: 'second', name: '第二位申請者' }],
  });
  fireEvent.press(screen.getByText('載入更多待審申請'));
  await screen.findByText('第二位申請者');
  expect(screen.getByText('第一位申請者')).toBeTruthy();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    requestCursor: 'first',
  });
  await waitFor(() => expect(screen.queryByText('載入更多待審申請')).toBeNull());
});

test('報名名單續載失敗保留原名單與游標，重試後合併同場活動', async () => {
  const event = {
    id: 'event',
    title: '社課',
    location: '教室',
    startsAt: 1,
    endsAt: 9999999999999,
    capacity: 200,
    registrationDeadline: 1,
    cancellationDeadline: 1,
    visibility: 'public',
    registered: 101,
    checkedIn: 0,
    mine: false,
    myCheckIn: false,
    registrations: [{ uid: 'first', name: '第一位', checkedInAt: null }],
    registrationCursor: 'first',
  };
  jest
    .mocked(callClubPortal)
    .mockResolvedValueOnce({ ...profile, role: 'admin', status: 'active', events: [event] });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.press(await screen.findByText('管理'));
  jest.mocked(callClubPortal).mockRejectedValueOnce(new Error('連線中斷'));
  fireEvent.press(screen.getByText('載入更多報名者'));
  await screen.findByText('連線中斷');
  expect(screen.getByText('第一位')).toBeTruthy();
  jest.mocked(callClubPortal).mockResolvedValueOnce({
    ...profile,
    events: [
      {
        ...event,
        registrationCursor: undefined,
        registrations: [{ uid: 'last', name: '第一百零一位', checkedInAt: null }],
      },
    ],
  });
  fireEvent.press(screen.getByText('載入更多報名者'));
  await screen.findByText('第一百零一位');
  expect(screen.getByText('第一位')).toBeTruthy();
  expect(screen.queryByText('載入更多報名者')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('one', 'pu', {
    action: 'read',
    groupId: 'club',
    rosterEventId: 'event',
    registrationCursor: 'first',
  });
});
