import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ClubProfile } from '../screens/ClubProfile';
import { ClubDirectory } from '../screens/ClubDirectory';
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
test('既有 Groups 流程保留我的社團與原有 GroupDetail 開啟', () => {
  const open = jest.fn();
  render(
    <ClubDirectory
      uid="one"
      schoolId="pu"
      clubs={[{ groupId: 'club', name: '攝影社' }]}
      onOpen={open}
    />,
  );
  fireEvent.press(screen.getByText('查看社團：攝影社'));
  expect(open).toHaveBeenCalledWith('club');
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
