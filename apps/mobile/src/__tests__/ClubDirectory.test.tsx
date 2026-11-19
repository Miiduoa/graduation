import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ClubDirectory } from '../screens/ClubDirectory';
import { callClubPortal } from '../services/clubPortal';
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
jest.mock('../services/clubSummary', () => ({ clubSummaryEnabled: () => false }));
jest.mock('../services/clubExport', () => ({ shareClubCsv: jest.fn() }));
jest.mock('../screens/ClubCheckIn', () => ({ ClubCheckIn: () => null }));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Button: ({
      text,
      onPress,
      disabled,
    }: {
      text: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
test('discover uses the callable portal despite the old flag and hides office actions on load failure', async () => {
  (callClubPortal as jest.Mock)
    .mockRejectedValueOnce(new Error('尚未啟用'))
    .mockResolvedValueOnce({ success: true, office: true, clubs: [] });
  const view = render(<ClubDirectory uid="student" schoolId="pu" clubs={[]} onOpen={jest.fn()} />);
  fireEvent.press(view.getByText('找社團'));
  expect(view.queryByText('課外組／平台維運（依本校授權）')).toBeNull();
  expect(await view.findByText('社團服務暫時無法使用，請稍後重試。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重新讀取社團資料')));
  expect(await view.findByText('課外組／平台維運（依本校授權）')).toBeTruthy();
  expect(callClubPortal).toHaveBeenCalledWith('student', 'pu', { action: 'directory' });
});

test('找社團只用外層搜尋欄篩選名稱與類別，清除及切換分段後可還原名單', async () => {
  (callClubPortal as jest.Mock).mockResolvedValue({
    success: true,
    office: false,
    clubs: [
      { id: 'photo', name: '攝影社', category: '學藝', meetingTime: '', recruiting: false },
      { id: 'dance', name: '熱舞社', category: '康樂', meetingTime: '', recruiting: true },
    ],
  });
  const view = render(<ClubDirectory uid="student" schoolId="pu" clubs={[]} onOpen={jest.fn()} />);
  fireEvent.press(view.getByText('找社團'));
  await view.findByText('查看社團：攝影社');
  expect(view.getAllByLabelText('搜尋學校社團')).toHaveLength(1);
  fireEvent.changeText(view.getByLabelText('搜尋學校社團'), '攝影');
  expect(view.queryByText('查看社團：熱舞社')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋學校社團'), '康樂');
  expect(view.getByText('查看社團：熱舞社')).toBeTruthy();
  expect(view.queryByText('查看社團：攝影社')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋學校社團'), '不存在');
  expect(view.getByText('找不到符合「不存在」的社團，請試試其他關鍵字。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋學校社團'), '');
  expect(view.getByText('查看社團：攝影社')).toBeTruthy();
  expect(view.getByText('查看社團：熱舞社')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋學校社團'), '攝影');
  fireEvent.press(view.getByText('查看社團：攝影社'));
  await view.findByText('回找社團');
  fireEvent.press(view.getByText('回找社團'));
  await view.findByText('查看社團：攝影社');
  expect(view.queryByText('查看社團：熱舞社')).toBeNull();
  fireEvent.press(view.getByText('我的社團'));
  fireEvent.press(view.getByText('找社團'));
  await view.findByText('查看社團：熱舞社');
});

test('discover has one working school-club search and preserves the separate joined-club search', async () => {
  (callClubPortal as jest.Mock).mockResolvedValueOnce({
    success: true,
    office: false,
    clubs: [
      { id: 'photo', name: '攝影社', category: '攝影', meetingTime: '', recruiting: true },
      { id: 'dance', name: '熱舞社', category: '舞蹈', meetingTime: '', recruiting: true },
    ],
  });
  const view = render(
    <ClubDirectory
      uid="student"
      schoolId="pu"
      clubs={[{ groupId: 'photo', name: '攝影社' }]}
      onOpen={jest.fn()}
    />,
  );
  expect(view.getAllByLabelText('搜尋我的社團')).toHaveLength(1);
  fireEvent.press(view.getByText('找社團'));
  const search = await view.findByLabelText('搜尋學校社團');
  expect(view.getAllByLabelText('搜尋學校社團')).toHaveLength(1);
  expect(view.queryByLabelText('搜尋我的社團')).toBeNull();
  fireEvent.changeText(search, '熱舞');
  expect(view.getByText('查看社團：熱舞社')).toBeTruthy();
  expect(view.queryByText('查看社團：攝影社')).toBeNull();
  fireEvent.press(view.getByText('我的社團'));
  expect(view.getByLabelText('搜尋我的社團').props.value).toBe('');
  expect(view.queryByLabelText('搜尋學校社團')).toBeNull();
  expect(view.getByText('查看社團：攝影社')).toBeTruthy();
});

test('the life entry opens club details through its navigator while keeping the filtered directory', async () => {
  (callClubPortal as jest.Mock).mockResolvedValueOnce({
    success: true,
    office: false,
    clubs: [{ id: 'photo', name: '攝影社', category: '攝影', meetingTime: '', recruiting: true }],
  });
  const open = jest.fn();
  const view = render(
    <ClubDirectory
      uid="student"
      schoolId="pu"
      clubs={[]}
      onOpen={open}
      onBrowseClub={open}
      initialSegment="discover"
    />,
  );
  fireEvent.changeText(await view.findByLabelText('搜尋學校社團'), '攝影');
  fireEvent.press(view.getByText('查看社團：攝影社'));
  expect(open).toHaveBeenCalledWith('photo');
  expect(view.getByLabelText('搜尋學校社團').props.value).toBe('攝影');
  expect(view.queryByText('回找社團')).toBeNull();
});
