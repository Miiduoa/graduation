import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { CalendarPanel } from '../screens/unifiedCalendar/CalendarPanel';
import { pickAndParseICalFile } from '../services/ical';

const mockSource = {
  listEvents: jest.fn(),
  listGroups: jest.fn(),
  listAssignments: jest.fn(),
};
const mockNavigation = { navigate: jest.fn() };
let mockUser: { uid: string } | null = { uid: 'student-one' };

jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockSource }));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: mockUser, profile: { role: 'student' } }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', code: 'pu', name: '靜宜大學' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/inboxActions', () => ({ navigateFromInboxTask: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({
  linkingOpenWithPuTronClassGate: jest.fn(),
}));
jest.mock('../services/ical', () => ({
  pickAndParseICalFile: jest.fn(),
  exportAndShareICalFile: jest.fn(),
  convertAppEventsToICalEvents: jest.fn(() => []),
  convertAssignmentsToICalEvents: jest.fn(() => []),
  generateSubscriptionUrl: jest.fn(() => 'https://example.invalid/calendar.ics'),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

function todayAtMidnight() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function campusEvent() {
  return { id: 'campus-one', title: '校園分享會', startsAt: todayAtMidnight() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-one' };
  mockSource.listEvents.mockReset().mockResolvedValue([]);
  mockSource.listGroups.mockReset().mockResolvedValue([]);
  mockSource.listAssignments.mockReset().mockResolvedValue([]);
  jest.mocked(pickAndParseICalFile).mockReset().mockResolvedValue(null);
});

test('校園頁只讀既有活動與課程作業，手動匯入後才顯示外部事件', async () => {
  mockSource.listEvents.mockResolvedValue([campusEvent()]);
  mockSource.listGroups.mockResolvedValue([{ id: 'course-one', name: '資料結構' }]);
  mockSource.listAssignments.mockResolvedValue([
    { id: 'homework-one', title: '堆疊練習', dueAt: todayAtMidnight() },
  ]);
  const view = render(<CalendarPanel navigation={mockNavigation} />);
  await view.findByText('共 2 個事件');
  expect(view.getByText('校園分享會')).toBeTruthy();
  expect(view.getByText('堆疊練習')).toBeTruthy();
  expect(mockSource.listEvents).toHaveBeenCalledWith('pu');
  expect(mockSource.listGroups).toHaveBeenCalledWith('student-one', {
    pageSize: 10,
    filters: [{ field: 'schoolId', operator: '==', value: 'pu' }],
  });
  expect(mockSource.listAssignments).toHaveBeenCalledWith('course-one', { pageSize: 50 });
  expect(pickAndParseICalFile).not.toHaveBeenCalled();

  jest.mocked(pickAndParseICalFile).mockResolvedValue({
    name: '系辦行事曆',
    events: [{ id: 'external-one', title: '系週會', startDate: todayAtMidnight() }],
  });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '選擇 iCal 檔案' })));
  expect(view.getByText('共 3 個事件')).toBeTruthy();
  expect(view.getByText('[匯入] 系週會')).toBeTruthy();
  expect(mockSource.listEvents).toHaveBeenCalledTimes(1);
  expect(mockSource.listAssignments).toHaveBeenCalledTimes(1);
});

test('未登入只讀校園活動，不要求私人課程資料', async () => {
  mockUser = null;
  const view = render(<CalendarPanel navigation={mockNavigation} />);
  await view.findByText('這天沒有校園活動或作業截止。');
  expect(mockSource.listEvents).toHaveBeenCalledWith('pu');
  expect(mockSource.listGroups).not.toHaveBeenCalled();
  expect(mockSource.listAssignments).not.toHaveBeenCalled();
});

test('真正空白的日期與近期列表都能前往既有活動總覽', async () => {
  const view = render(<CalendarPanel navigation={mockNavigation} />);
  fireEvent.press(await view.findByRole('button', { name: '瀏覽校園活動' }));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('Today', {
    screen: '活動總覽',
    params: undefined,
  });
  fireEvent.press(view.getByRole('button', { name: '瀏覽更多活動' }));
  expect(mockNavigation.navigate).toHaveBeenCalledTimes(2);
});

test('兩個來源失敗時不宣稱沒有事件，重試立即顯示載入狀態', async () => {
  mockSource.listEvents.mockRejectedValueOnce(new Error('offline'));
  mockSource.listGroups.mockRejectedValueOnce(new Error('offline'));
  const view = render(<CalendarPanel navigation={mockNavigation} />);
  await view.findByText('校園活動載入失敗');
  await view.findByText('作業截止載入失敗');
  expect(view.queryByText('這天沒有校園活動或作業截止。')).toBeNull();
  expect(view.queryByText('未來 7 天沒有校園活動或作業截止。')).toBeNull();

  const request = deferred<ReturnType<typeof campusEvent>[]>();
  mockSource.listEvents.mockReturnValueOnce(request.promise);
  fireEvent.press(view.getByRole('button', { name: '重試活動' }));
  expect(view.getByText('載入中...')).toBeTruthy();
  expect(view.queryByText('校園活動載入失敗')).toBeNull();
  expect(view.getByText('作業截止載入失敗')).toBeTruthy();
  await act(async () => request.resolve([campusEvent()]));
  expect(view.getByText('校園分享會')).toBeTruthy();
  expect(view.getByText('已載入 1 個事件')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '重試作業' }));
  await waitFor(() => expect(view.queryByText('作業截止載入失敗')).toBeNull());
  await view.findByText('共 1 個事件');
});

test.each(['events', 'assignments'])('單一來源 %s 失敗與重試時保留另一來源內容', async (source) => {
  mockSource.listEvents.mockResolvedValue([campusEvent()]);
  mockSource.listGroups.mockResolvedValue([{ id: 'course-one', name: '資料結構' }]);
  mockSource.listAssignments.mockResolvedValue([
    { id: 'homework-one', title: '堆疊練習', dueAt: todayAtMidnight() },
  ]);
  const failed = source === 'events' ? mockSource.listEvents : mockSource.listAssignments;
  failed.mockRejectedValueOnce(new Error('offline'));
  const request = deferred<[]>();
  const view = render(<CalendarPanel navigation={mockNavigation} />);
  const retryLabel = source === 'events' ? '重試活動' : '重試作業';
  const keptTitle = source === 'events' ? '堆疊練習' : '校園分享會';
  await view.findByRole('button', { name: retryLabel });
  expect(view.getByText(keptTitle)).toBeTruthy();
  failed.mockReturnValueOnce(request.promise);
  fireEvent.press(view.getByRole('button', { name: retryLabel }));
  expect(view.getByText('已載入的事件仍可查看')).toBeTruthy();
  expect(view.getByText(keptTitle)).toBeTruthy();
  await act(async () => request.resolve([]));
  expect(view.getByText(keptTitle)).toBeTruthy();
});

test('頁首與月格共用捲動區，重新顯示頁首仍保留月份與日期', async () => {
  const view = render(
    <CalendarPanel navigation={mockNavigation} header={<Text>校園、個人與課表</Text>} />,
  );
  await view.findByText('這天沒有校園活動或作業截止。');
  const scroll = within(view.getByTestId('campus-calendar-scroll'));
  expect(scroll.getByText('校園、個人與課表')).toBeTruthy();
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
  const dayLabel = `${nextMonth.getFullYear()} 年 ${nextMonth.getMonth() + 1} 月 15 日`;
  const selectionTitle = `${nextMonth.getMonth() + 1}/15 的事件`;
  fireEvent.press(view.getByRole('button', { name: '下一個月' }));
  fireEvent.press(view.getByRole('button', { name: dayLabel }));
  expect(view.getByText(selectionTitle)).toBeTruthy();
  view.rerender(
    <CalendarPanel navigation={mockNavigation} header={<Text>返回校園行事曆</Text>} />,
  );
  expect(view.getByText(selectionTitle)).toBeTruthy();
  expect(view.getByRole('button', { name: dayLabel })).toHaveAccessibilityState({
    selected: true,
  });
  expect(mockSource.listEvents).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '回到今天' }));
  expect(view.getByText(`${today.getMonth() + 1}/${today.getDate()} 的事件`)).toBeTruthy();
});
