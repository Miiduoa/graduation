import { clubSummaryEnabled } from '../services/clubSummary';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ClubProfile } from '../screens/ClubProfile';
import { ClubDirectory } from '../screens/ClubDirectory';
import { loadClubProfile } from '../services/clubProfile';
jest.mock('../screens/ClubPortal', () => ({
  ClubPortal: ({
    uid,
    schoolId,
    groupId,
    onBack,
  }: {
    uid: string;
    schoolId: string;
    groupId: string;
    onBack?: () => void;
  }) => {
    const { Text } = require('react-native');
    const { Button } = require('../ui/components');
    return (
      <>
        <Text>{`管理入口：${uid}/${schoolId}/${groupId}`}</Text>
        <Button text="回社團介紹" onPress={onBack} />
      </>
    );
  },
}));
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
  meetingTime: '',
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
  expect(screen.getByText('登入後查看學校社團。')).toBeTruthy();
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

test.each([false, true])('社團目錄不再顯示還沒開放的矛盾說明：%s', (enabled) => {
  jest.mocked(clubSummaryEnabled).mockReturnValue(enabled);
  render(<ClubDirectory clubs={[]} onOpen={jest.fn()} />);
  expect(screen.queryByText('這所學校還沒開放社團管理。')).toBeNull();
});

test('重新讀取成功後，忽略先前請求延遲回傳的錯誤', async () => {
  let fail!: (error: Error) => void;
  jest.mocked(loadClubProfile).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.press(screen.getByText('重新讀取社團資料'));
  await screen.findByText('攝影社');
  await act(async () => fail(new Error('network')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('社課通知')).toBeTruthy();
});

test.each(['owner', 'admin', 'member'])(
  '舊版介紹頁可透過既有管理入口補齊資料並返回：%s',
  async (role) => {
    jest.mocked(clubSummaryEnabled).mockReturnValue(true);
    jest.mocked(loadClubProfile).mockResolvedValue({ ...profile, role, description: '' });
    render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
    await screen.findByText('社團尚未提供介紹。');
    if (role === 'member') {
      expect(screen.queryByText('填寫社課時間')).toBeNull();
      expect(screen.queryByText('填寫社團介紹')).toBeNull();
    } else {
      fireEvent.press(screen.getByText('填寫社團介紹'));
      expect(screen.getByText('管理入口：one/pu/club')).toBeTruthy();
      fireEvent.press(screen.getByText('回社團介紹'));
      await screen.findByText('社團尚未提供介紹。');
      fireEvent.press(screen.getByText('填寫社課時間'));
      expect(screen.getByText('管理入口：one/pu/club')).toBeTruthy();
    }
  },
);

test.each([false, true])('補資料入口僅在管理開放、幹部且該欄位缺資料時顯示：%s', async (enabled) => {
  jest.mocked(clubSummaryEnabled).mockReturnValue(enabled);
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  for (const role of ['owner', 'admin', 'member']) {
    for (const [meetingTime, description, missingTime, missingIntro] of [
      ['  ', '  ', true, true],
      ['週三 18:00', '  ', false, true],
      ['  ', '新版介紹', true, false],
      ['週三 18:00', '新版介紹', false, false],
      ['社課時間未提供', '社團尚未提供介紹', true, true],
      [' \t社課時間未提供\n', ' 社團尚未提供介紹。 ', true, true],
      ['未提供', '未提供', true, true],
      ['社課時間未提供', '新版介紹', true, false],
      ['週三 18:00', '社團尚未提供介紹。', false, true],
      ['社課時間未提供，請洽幹部', '社團尚未提供介紹，但歡迎來聊聊', false, false],
    ] as const) {
      jest
        .mocked(loadClubProfile)
        .mockResolvedValue({ ...profile, role, meetingTime, description });
      fireEvent.press(screen.getByText('重新讀取社團資料'));
      await screen.findByText('攝影社');
      for (const [name, missing] of [
        ['填寫社課時間', missingTime],
        ['填寫社團介紹', missingIntro],
      ] as const) {
        const entry = screen.queryByText(name);
        const show = enabled && role !== 'member' && missing;
        expect(entry !== null).toBe(show);
      }
      expect(screen.queryByText(/社課時間未提供$/) !== null).toBe(missingTime);
      expect(screen.queryByText('社團尚未提供介紹。') !== null).toBe(missingIntro);
      if (!missingTime) expect(screen.getByText(new RegExp(meetingTime.trim()))).toBeTruthy();
      if (!missingIntro) expect(screen.getByText(description.trim())).toBeTruthy();
    }
  }
  view.unmount();
});

test('從管理返回及重新讀取後會顯示已儲存欄位並隱藏補資料入口', async () => {
  jest.mocked(clubSummaryEnabled).mockReturnValue(true);
  jest.mocked(loadClubProfile).mockResolvedValue({ ...profile, role: 'admin', description: '' });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('填寫社課時間');
  fireEvent.press(screen.getByText('填寫社課時間'));
  expect(screen.getByText('管理入口：one/pu/club')).toBeTruthy();
  jest.mocked(loadClubProfile).mockResolvedValue({
    ...profile,
    role: 'admin',
    meetingTime: '週三 18:00',
    description: '新版介紹',
  });
  fireEvent.press(screen.getByText('回社團介紹'));
  await screen.findByText('新版介紹');
  expect(screen.getByText(/週三 18:00/)).toBeTruthy();
  expect(screen.queryByText('填寫社課時間')).toBeNull();
  expect(screen.queryByText('填寫社團介紹')).toBeNull();
  jest.mocked(loadClubProfile).mockResolvedValue({
    ...profile,
    role: 'admin',
    meetingTime: '週四 19:00',
    description: '更新介紹',
  });
  fireEvent.press(screen.getByText('重新讀取社團資料'));
  await screen.findByText('更新介紹');
  expect(screen.getByText(/週四 19:00/)).toBeTruthy();
  expect(screen.queryByText('填寫社課時間')).toBeNull();
  expect(screen.queryByText('填寫社團介紹')).toBeNull();
  expect(loadClubProfile).toHaveBeenCalledTimes(3);
});
