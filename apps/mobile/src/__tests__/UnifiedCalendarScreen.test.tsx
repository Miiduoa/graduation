import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { UnifiedCalendarScreen } from '../screens/UnifiedCalendarScreen';

jest.unmock('@react-navigation/native');
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockSource }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', code: 'pu', name: '靜宜大學' } }),
}));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => null }));
jest.mock('../services/personalImports', () => ({ loadPersonalImports: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/inboxActions', () => ({ navigateFromInboxTask: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({ linkingOpenWithPuTronClassGate: jest.fn() }));
jest.mock('../services/ical', () => ({
  pickAndParseICalFile: jest.fn(),
  exportAndShareICalFile: jest.fn(),
  convertAppEventsToICalEvents: jest.fn(() => []),
  convertAssignmentsToICalEvents: jest.fn(() => []),
  generateSubscriptionUrl: jest.fn(() => 'https://example.invalid/calendar.ics'),
}));

const mockSource = { listEvents: jest.fn(async () => []), listGroups: jest.fn(async () => []) };
const Tabs = createBottomTabNavigator();
const Home = createNativeStackNavigator();
const Learn = createNativeStackNavigator();
const PersonalDestination = () => <Text>個人行事曆內容</Text>;
const TimetableDestination = () => <Text>我的課表內容</Text>;
const ImportDestination = () => <Text>匯入行程內容</Text>;

function HomeRoutes() {
  return (
    <Home.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <Home.Screen name="SmartCalendarScreen" component={UnifiedCalendarScreen} />
    </Home.Navigator>
  );
}
function LearnRoutes() {
  return (
    <Learn.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <Learn.Screen name="PersonalCalendar" component={PersonalDestination} />
      <Learn.Screen name="PersonalTimetable" component={TimetableDestination} />
      <Learn.Screen name="PersonalImport" component={ImportDestination} />
    </Learn.Navigator>
  );
}
function renderCalendar() {
  const ref = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={ref}>
      <Tabs.Navigator
        initialRouteName="Today"
        screenOptions={{ headerShown: false, animation: 'none' }}
      >
        <Tabs.Screen name="Today" component={HomeRoutes} />
        <Tabs.Screen name="學習" component={LearnRoutes} />
      </Tabs.Navigator>
    </NavigationContainer>,
  );
  return { ...view, ref };
}

beforeEach(() => {
  jest.clearAllMocks();
});
const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 15);
const selectedDayLabel = `${nextMonth.getFullYear()} 年 ${nextMonth.getMonth() + 1} 月 15 日`;
const selectedDayHeading = `${nextMonth.getMonth() + 1}/15 的事件`;

test('頁首與既有匯入入口都在可捲動內容中，並標示目前資料範圍', async () => {
  const view = renderCalendar();
  await view.findByText('這天沒有校園活動或作業截止。');
  const scroll = within(view.getByTestId('campus-calendar-scroll'));
  expect(
    scroll.getByText('校園活動、作業截止，以及在這裡匯入的 iCal。個人行程與每週課表分開查看。'),
  ).toBeTruthy();
  expect(
    scroll.getByRole('button', { name: '校園行事曆', selected: true, disabled: true }),
  ).toBeTruthy();
  expect(scroll.getByRole('button', { name: '個人行程' }).props.accessibilityHint).toContain(
    '自己新增或匯入',
  );
  expect(scroll.getByRole('button', { name: '我的課表' }).props.accessibilityHint).toContain(
    '每週上課時間',
  );
  expect(scroll.getByRole('button', { name: '開啟個人行事曆' })).toBeTruthy();
  expect(scroll.getByRole('button', { name: '從截圖或檔案匯入行程' })).toBeTruthy();
});

test.each([
  ['個人行程', 'PersonalCalendar', '個人行事曆內容'],
  ['我的課表', 'PersonalTimetable', '我的課表內容'],
  ['開啟個人行事曆', 'PersonalCalendar', '個人行事曆內容'],
  ['從截圖或檔案匯入行程', 'PersonalImport', '匯入行程內容'],
])('點一次%s開啟既有頁面，返回後月份與選日不變', async (label, route, content) => {
  const view = renderCalendar();
  await view.findByText('這天沒有校園活動或作業截止。');
  fireEvent.press(view.getByRole('button', { name: '下一個月' }));
  fireEvent.press(view.getByRole('button', { name: selectedDayLabel }));
  expect(view.getByText(selectedDayHeading)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: label }));
  await waitFor(() => expect(view.ref.getCurrentRoute()?.name).toBe(route));
  expect(view.getByText(content)).toBeTruthy();
  act(() => view.ref.goBack());
  await waitFor(() => expect(view.ref.getCurrentRoute()?.name).toBe('SmartCalendarScreen'));
  expect(view.getByRole('button', { name: selectedDayLabel, selected: true })).toBeTruthy();
  expect(view.getByText(selectedDayHeading)).toBeTruthy();
  expect(mockSource.listEvents).toHaveBeenCalledTimes(1);
});

test('無法跳轉時有明確下一步，保留目前選日', async () => {
  const notice = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = renderCalendar();
  await view.findByText('這天沒有校園活動或作業截止。');
  view.unmount();
  const direct = render(
    <NavigationContainer>
      <UnifiedCalendarScreen />
    </NavigationContainer>,
  );
  await direct.findByText('這天沒有校園活動或作業截止。');
  fireEvent.press(direct.getByRole('button', { name: '下一個月' }));
  fireEvent.press(direct.getByRole('button', { name: selectedDayLabel }));
  fireEvent.press(direct.getByRole('button', { name: '個人行程' }));
  expect(notice).toHaveBeenCalledWith('無法開啟', '「個人行程」目前無法開啟，請返回後再試一次。');
  expect(direct.getByRole('button', { name: selectedDayLabel, selected: true })).toBeTruthy();
  notice.mockRestore();
});
