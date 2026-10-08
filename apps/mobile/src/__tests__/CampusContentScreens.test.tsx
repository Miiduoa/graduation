import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking, Share, StyleSheet } from 'react-native';
import { applyTheme, theme } from '../ui/theme';
import { aiTokens } from '../ui/aiFirst';
import AnnouncementsScreen from '../screens/AnnouncementsListAiFirstScreen';
import AnnouncementScreen from '../screens/AnnouncementDetailAiFirstScreen';
import EventsScreen from '../screens/EventsListAiFirstScreen';
import EventScreen from '../screens/EventDetailAiFirstScreen';
import {
  loadCampusAnnouncements,
  loadCampusAnnouncement,
  loadCampusEventPage,
  loadCampusEvent,
} from '../services/publicCampusContent';
import { exportAndShareICalFile } from '../services/ical';
import { safeNavigate } from '../utils/safeNavigate';

let mockUid: string | null = 'student-a';
let mockSchool = { id: 'pu' };
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../services/publicCampusContent', () => ({
  loadCampusAnnouncements: jest.fn(),
  loadCampusAnnouncement: jest.fn(),
  loadCampusEventPage: jest.fn(),
  loadCampusEvent: jest.fn(),
}));
jest.mock('../services/ical', () => ({ exportAndShareICalFile: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const announcement = {
  id: 'a1',
  title: '校方的新公告',
  body: '公告全文',
  publishedAt: '2026-10-08T00:00:00Z',
  source: '教務處',
  category: 'academic' as const,
};
const event = {
  id: 'e1',
  title: '校方的新活動',
  description: '活動內容與報名方式',
  startsAt: '2030-10-08T00:00:00Z',
  schoolId: 'pu',
  location: '大禮堂',
  source: 'school-club-events' as const,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  applyTheme('light');
  mockUid = 'student-a';
  mockSchool = { id: 'pu' };
  jest.mocked(loadCampusAnnouncements).mockResolvedValue([announcement]);
  jest.mocked(loadCampusAnnouncement).mockResolvedValue(announcement);
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValue({ items: [event], source: event.source, nextCursor: null });
  jest.mocked(loadCampusEvent).mockResolvedValue(event);
  jest.mocked(exportAndShareICalFile).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('announcements use school data with working categories and a registered detail route', async () => {
  jest
    .mocked(loadCampusAnnouncements)
    .mockResolvedValue([
      announcement,
      { ...announcement, id: 'a2', title: '社團活動', category: 'event' },
    ]);
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  expect(loadCampusAnnouncements).toHaveBeenCalledWith('pu', '');
  expect(view.queryByText(/期末考程序|32 則|AI 從|全部已讀/)).toBeNull();
  fireEvent.press(view.getByText('教務'));
  expect(view.queryByText('社團活動')).toBeNull();
  fireEvent.press(view.getByText('校方的新公告'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, '公告詳情', { id: 'a1' });
});

test('read failure offers retry without becoming an empty success', async () => {
  jest.mocked(loadCampusAnnouncements).mockRejectedValueOnce(new Error('offline'));
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('目前無法讀取，請確認網路連線後重試。');
  expect(view.queryByText('目前沒有公告')).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('校方的新公告');
});

test('a school change immediately hides old detail data and ignores late responses', async () => {
  const old = deferred<typeof announcement>();
  const next = deferred<typeof announcement>();
  jest
    .mocked(loadCampusAnnouncement)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  const view = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  mockSchool = { id: 'other' };
  view.rerender(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  await act(async () => old.resolve(announcement));
  expect(view.queryByText('校方的新公告')).toBeNull();
  await act(async () => next.resolve({ ...announcement, title: '目前學校公告' }));
  expect(view.getByText('目前學校公告')).toBeTruthy();
});

test('a detail route change clears the previous announcement synchronously', async () => {
  const view = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  await view.findByText('公告全文');
  jest.mocked(loadCampusAnnouncement).mockResolvedValue(null);
  view.rerender(<AnnouncementScreen route={{ params: { id: 'missing' } }} />);
  expect(view.queryByText('公告全文')).toBeNull();
  await view.findByText('找不到這則公告，可能已移除或不屬於目前學校。');
  expect(view.queryByText(/已自動加入|衝堂申請|王小明/)).toBeNull();
});

test('real announcement attachments open and failures are visible', async () => {
  jest.mocked(loadCampusAnnouncement).mockResolvedValue({
    ...announcement,
    attachments: [
      { id: 'att', name: '校方文件', url: 'https://school.edu/notice.pdf', type: 'document' },
    ],
  });
  const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('offline'));
  const view = render(<AnnouncementScreen route={{ params: { announcementId: 'a1' } }} />);
  await view.findByText('校方文件');
  await act(async () => fireEvent.press(view.getByText('校方文件')));
  expect(open).toHaveBeenCalledWith('https://school.edu/notice.pdf');
  expect(view.getByText('無法開啟附件，請稍後重試。')).toBeTruthy();
});

test('event date filters work and list navigation uses the actual event ID', async () => {
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValue({
      items: [
        event,
        { ...event, id: 'old', title: '已結束的活動', startsAt: '2020-01-01T00:00:00Z' },
      ],
      source: event.source,
      nextCursor: null,
    });
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('校方的新活動');
  fireEvent.press(view.getByText('未來活動'));
  expect(view.queryByText('已結束的活動')).toBeNull();
  fireEvent.press(view.getByText('校方的新活動'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, '活動詳情', {
    id: 'e1',
    source: event.source,
  });
  expect(view.queryByText(/黑客松|32\/50|AI 為你推薦|我報名的/)).toBeNull();
});

test('event actions share real content and export valid calendar data without claiming registration', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  const view = render(<EventScreen route={{ params: { eventId: 'e1' } }} />);
  await view.findByText('校方的新活動');
  await act(async () => fireEvent.press(view.getByText('分享活動')));
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('活動內容與報名方式') }),
  );
  await act(async () => fireEvent.press(view.getByText('匯出行事曆')));
  expect(exportAndShareICalFile).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        id: 'campus-event-pu-school-club-events-e1',
        title: '校方的新活動',
        startDate: new Date(event.startsAt),
        location: '大禮堂',
      }),
    ],
    'campus-event.ics',
    'Campus One 活動',
  );
  expect(view.queryByText(/已加入行事曆|立即報名|已報名|朋友 2 人/)).toBeNull();
});

test('unknown event dates cannot export a made-up schedule and failed sharing allows retry', async () => {
  jest.mocked(loadCampusEvent).mockResolvedValue({ ...event, startsAt: '' });
  jest.spyOn(Share, 'share').mockRejectedValue(new Error('unavailable'));
  const view = render(<EventScreen route={{ params: { id: 'e1' } }} />);
  await view.findByText('校方的新活動');
  fireEvent.press(view.getByText('匯出行事曆'));
  expect(exportAndShareICalFile).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('分享活動')));
  expect(view.getByText('無法開啟分享，請稍後重試。')).toBeTruthy();
});

test('mounted announcement content and event content follow theme changes without remounting', async () => {
  const announcementView = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  const eventView = render(<EventScreen route={{ params: { id: 'e1' } }} />);
  await announcementView.findByText('公告全文');
  await eventView.findByText('活動內容與報名方式');
  const lightColor = StyleSheet.flatten(announcementView.getByText('公告全文').props.style).color;
  expect(lightColor).toBe(theme.colors.text);
  act(() => applyTheme('dark'));
  expect(theme.colors.text).not.toBe(lightColor);
  expect(StyleSheet.flatten(announcementView.getByText('公告全文').props.style).color).toBe(
    theme.colors.text,
  );
  expect(StyleSheet.flatten(eventView.getByText('活動內容與報名方式').props.style).color).toBe(
    theme.colors.text,
  );
  expect(loadCampusAnnouncement).toHaveBeenCalledTimes(1);
  expect(loadCampusEvent).toHaveBeenCalledTimes(1);
  act(() => applyTheme('light'));
  expect(StyleSheet.flatten(announcementView.getByText('公告全文').props.style).color).toBe(
    lightColor,
  );
});

test('mounted read errors follow theme changes without reloading or remounting', async () => {
  jest.mocked(loadCampusAnnouncements).mockRejectedValue(new Error('offline'));
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  const errorText = '目前無法讀取，請確認網路連線後重試。';
  await view.findByText(errorText);
  const lightColor = StyleSheet.flatten(view.getByText(errorText).props.style).color;
  act(() => applyTheme('dark'));
  expect(aiTokens.danger).not.toBe(lightColor);
  expect(StyleSheet.flatten(view.getByText(errorText).props.style).color).toBe(aiTokens.danger);
  expect(loadCampusAnnouncements).toHaveBeenCalledTimes(1);
  act(() => applyTheme('light'));
});

const eventCursor = { schoolId: 'pu', source: event.source, document: {} as never };
const eventPage = (items = [event], nextCursor: typeof eventCursor | null = null) => ({
  items,
  source: event.source,
  nextCursor,
});

test('load more remains reachable with an empty filter and preserves the current page when it fails', async () => {
  const undated = { ...event, id: 'undated', title: '待公布時間的活動', startsAt: '' };
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValueOnce(eventPage([undated], eventCursor))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(eventPage());
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('待公布時間的活動');
  fireEvent.press(view.getByText('未來活動'));
  expect(view.getByText('已載入的活動中沒有符合項目')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('載入更多活動')));
  expect(view.getByText('無法載入更多活動，已載入的資料仍保留。')).toBeTruthy();
  fireEvent.press(view.getByText('全部'));
  expect(view.getByText('待公布時間的活動')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重試載入')));
  expect(loadCampusEventPage).toHaveBeenLastCalledWith('pu', eventCursor);
  expect(view.getByText('校方的新活動')).toBeTruthy();
  expect(view.getByText('待公布時間的活動')).toBeTruthy();
  expect(view.queryByText('載入更多活動')).toBeNull();
});

test('refresh failures retain loaded activity data until an authoritative replacement succeeds', async () => {
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValueOnce(eventPage())
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(eventPage([{ ...event, title: '更新後的活動' }]));
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('校方的新活動');
  await act(async () => fireEvent.press(view.getByText('更新活動')));
  expect(view.getByText('校方的新活動')).toBeTruthy();
  expect(view.getByText('無法更新活動，請確認網路連線後重試。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('重試載入')));
  expect(view.getByText('更新後的活動')).toBeTruthy();
  expect(view.queryByText('校方的新活動')).toBeNull();
});

test('switching school and account clears previous pages and ignores their in-flight next page', async () => {
  const late = deferred<ReturnType<typeof eventPage>>();
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValueOnce(eventPage([event], eventCursor))
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(eventPage([{ ...event, schoolId: 'other', title: '新學校活動' }]));
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('校方的新活動');
  fireEvent.press(view.getByText('載入更多活動'));
  mockUid = 'student-b';
  mockSchool = { id: 'other' };
  view.rerender(<EventsScreen navigation={navigation} />);
  expect(view.queryByText('校方的新活動')).toBeNull();
  await view.findByText('新學校活動');
  await act(async () => late.resolve(eventPage([{ ...event, title: '舊請求活動' }])));
  expect(view.queryByText('舊請求活動')).toBeNull();
  expect(loadCampusEventPage).toHaveBeenLastCalledWith('other', null);
});

test('a repeated load-more press starts only one request and duplicate document IDs do not duplicate rows', async () => {
  const next = deferred<ReturnType<typeof eventPage>>();
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValueOnce(eventPage([event], eventCursor))
    .mockReturnValueOnce(next.promise);
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('校方的新活動');
  const button = view.getByText('載入更多活動');
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(loadCampusEventPage).toHaveBeenCalledTimes(2);
  await act(async () =>
    next.resolve(eventPage([event, { ...event, id: 'e2', title: '下一頁活動' }])),
  );
  expect(view.getAllByText('校方的新活動')).toHaveLength(1);
  expect(view.getByText('下一頁活動')).toBeTruthy();
});

test('changing detail source clears same-ID content synchronously and sends the explicit source', async () => {
  const view = render(
    <EventScreen route={{ params: { id: 'e1', source: 'school-club-events' } }} />,
  );
  await view.findByText('校方的新活動');
  jest.mocked(loadCampusEvent).mockResolvedValueOnce(null);
  view.rerender(<EventScreen route={{ params: { id: 'e1', source: 'legacy-events' } }} />);
  expect(view.queryByText('校方的新活動')).toBeNull();
  await view.findByText('找不到這場活動，可能已移除或不屬於目前學校。');
  expect(loadCampusEvent).toHaveBeenLastCalledWith('pu', 'e1', 'legacy-events');
});
