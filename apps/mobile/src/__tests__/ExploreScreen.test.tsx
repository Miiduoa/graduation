import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ExploreScreen } from '../screens/ExploreScreen';

let mockSchoolId = 'pu';
let mockAccount: { platformAccountId: string; context: string } | null = null;
let mockCampusUser = false;
jest.mock('../state/auth', () => ({ useAuth: () => ({
  user: mockCampusUser ? { uid: 'campus-user' } : null,
  profile: mockCampusUser ? { uid: 'campus-user', role: 'student' } : null,
  loading: false,
}) }));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => ({ session: mockAccount }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId }, selectionReady: true }) }));
jest.mock('../components/SchoolBrowsingControl', () => ({ SchoolBrowsingControl: () => null }));
jest.mock('../ui/aiFirst', () => ({ AIScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const navigation = {
  navigate: jest.fn(),
  getState: () => ({ routeNames: ['Explore', 'CampusHome', 'AIChat', 'NuniTimetableAssistant', 'Library', 'Map'] }),
};
beforeEach(() => { jest.clearAllMocks(); mockSchoolId = 'pu'; mockAccount = null; mockCampusUser = false; });

test('campus users can still reach the full existing services directory', () => {
  mockCampusUser = true;
  const view = render(<ExploreScreen navigation={navigation} />);
  fireEvent.press(view.getByText('查看全部校園服務'));
  expect(navigation.navigate).toHaveBeenCalledWith('CampusHome', undefined);
});

test('a guest can explore with no school selected and prefill a question without signing in', () => {
  mockSchoolId = '';
  const view = render(<ExploreScreen navigation={navigation} />);
  fireEvent.press(view.getByLabelText('試著問 nuni：下一堂課，從容出發'));
  expect(navigation.navigate).toHaveBeenCalledWith('AIChat', expect.objectContaining({ prompt: '下一堂課在哪裡', taskProfile: 'student' }));
});

test('platform teaching starts a supported native work plan instead of claiming an overview read', () => {
  mockAccount = { platformAccountId: 'account-a', context: 'platform-context' };
  const view = render(<ExploreScreen navigation={navigation} route={{ params: { workContext: 'teacher' } }} />);
  expect(view.getByText('依自己的課表與個人行程找備課時段，核對後再建立行程。')).toBeTruthy();
  fireEvent.press(view.getByLabelText('試著問 nuni：替備課留一段時間'));
  expect(navigation.navigate).toHaveBeenCalledWith('NuniTimetableAssistant', expect.objectContaining({ prompt: '安排明天下午一小時備課', taskProfile: 'teacher' }));
  expect(view.queryByText('先整理自己的授課概況，再回到課程處理作業與測驗。')).toBeNull();
});

test('filters recover from an empty result and clear when the campus changes', () => {
  const view = render(<ExploreScreen navigation={navigation} />);
  fireEvent.changeText(view.getByLabelText('搜尋 nuni 用法'), '沒有這個情境');
  expect(view.getByText('還沒有符合的用法')).toBeTruthy();
  fireEvent.press(view.getByText('顯示全部用法'));
  expect(view.getByText('掌握今天的門市')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋 nuni 用法'), 'bus');
  expect(view.queryByText('掌握今天的門市')).toBeNull();
  mockSchoolId = 'nthu';
  view.rerender(<ExploreScreen navigation={navigation} />);
  expect(view.getByLabelText('搜尋 nuni 用法').props.value).toBe('');
});

test('direct native services keep the current app campus and web fallbacks explicitly carry the chosen campus', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = render(<ExploreScreen navigation={navigation} />);
  fireEvent.press(view.getByLabelText('開啟圖書館，找一本書，找一個新想法'));
  expect(navigation.navigate).toHaveBeenCalledWith('Library', undefined);
  fireEvent.press(view.getByLabelText('開啟校園活動網頁，找一場想參加的活動'));
  expect(open).toHaveBeenCalledWith('https://nuni.tw/events?schoolId=pu');
  open.mockRestore();
});
