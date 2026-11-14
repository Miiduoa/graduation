import { clubSummaryEnabled } from '../services/clubSummary';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ClubProfile } from '../screens/ClubProfile';
import { ClubDirectory } from '../screens/ClubDirectory';
import { loadClubProfile } from '../services/clubProfile';
jest.mock('../services/clubProfile', () => ({ loadClubProfile: jest.fn() }));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children, title }: any) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    Button: ({ text, onPress, disabled }: any) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../services/clubSummary', () => ({ clubSummaryEnabled: jest.fn() }));
const profile = {
  name: '攝影社',
  description: '週三社課',
  role: 'member',
  memberCount: 3,
  announcements: [{ id: 'post', title: '社課通知', body: '帶相機' }],
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(clubSummaryEnabled).mockReturnValue(false);
  jest.mocked(loadClubProfile).mockResolvedValue(profile);
});
test('我的社團可搜尋並開啟既有 GroupDetail，找社團不冒充正式名錄', () => {
  const open = jest.fn();
  render(<ClubDirectory clubs={[{ groupId: 'club', name: '攝影社' }]} onOpen={open} />);
  fireEvent.press(screen.getByText('查看社團：攝影社'));
  expect(open).toHaveBeenCalledWith('club');
  fireEvent.changeText(screen.getByLabelText('搜尋我的社團'), '熱舞');
  expect(screen.getByText('沒有符合條件的結果')).toBeTruthy();
  fireEvent.press(screen.getByText('找社團'));
  expect(screen.getByText('學校還沒提供社團名單。')).toBeTruthy();
  expect(screen.queryByText('查看社團：攝影社')).toBeNull();
  expect(screen.queryByText('申請加入')).toBeNull();
});
test('沒有社團時呈現鎖定空態', () => {
  render(<ClubDirectory clubs={[]} onOpen={jest.fn()} />);
  expect(screen.getByText('還沒加入社團，可以到「找社團」看看。')).toBeTruthy();
});
test('社團頁呈現真實公告、介紹與活動資料界線，沒有寫入按鈕', async () => {
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('攝影社');
  expect(screen.getByText('已加入')).toBeDisabled();
  expect(screen.getByText('社課通知')).toBeTruthy();
  expect(screen.getByText('週三社課')).toBeTruthy();
  expect(screen.getByText('目前沒有排定的活動。')).toBeTruthy();
  expect(screen.getByText(/此頁尚未接入社團內部活動/)).toBeTruthy();
  expect(screen.queryByText('編輯社團介紹')).toBeNull();
  expect(screen.queryByText('申請加入')).toBeNull();
});
test('讀取失敗可重讀，幹部只看見鎖定管理說明', async () => {
  jest.mocked(loadClubProfile).mockRejectedValueOnce(new Error('network'));
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText(/無法讀取社團資料/);
  jest.mocked(loadClubProfile).mockResolvedValue({ ...profile, role: 'owner' });
  fireEvent.press(screen.getByText('重新讀取社團資料'));
  expect(await screen.findByText('這所學校還沒開放社團管理。')).toBeTruthy();
  expect(screen.queryByText('管理')).toBeNull();
});
test('切換社團時忽略舊請求的結果', async () => {
  let finish!: (data: typeof profile) => void;
  jest.mocked(loadClubProfile).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="old" />);
  view.rerender(<ClubProfile uid="one" schoolId="pu" groupId="new" />);
  await screen.findByText('攝影社');
  await act(async () => finish({ ...profile, name: '舊社團' }));
  expect(screen.queryByText('舊社團')).toBeNull();
});

test.each(['owner', 'admin'])('管理已啟用時，%s 不顯示未開放說明', async (role) => {
  jest.mocked(clubSummaryEnabled).mockReturnValue(true);
  jest.mocked(loadClubProfile).mockResolvedValue({ ...profile, role });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('週三社課');
  expect(screen.queryByText('這所學校還沒開放社團管理。')).toBeNull();
});

test.each([false, true])('社團目錄管理說明沿用既有旗標：%s', (enabled) => {
  jest.mocked(clubSummaryEnabled).mockReturnValue(enabled);
  render(<ClubDirectory clubs={[]} onOpen={jest.fn()} />);
  expect(Boolean(screen.queryByText('這所學校還沒開放社團管理。'))).toBe(!enabled);
});
