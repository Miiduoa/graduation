import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  AppState,
  Keyboard,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  type AppStateStatus,
} from 'react-native';
import { applyTheme, theme } from '../ui/theme';
import AnnouncementsScreen from '../screens/AnnouncementsListAiFirstScreen';
import AnnouncementScreen from '../screens/AnnouncementDetailAiFirstScreen';
import EventsScreen from '../screens/EventsListAiFirstScreen';
import EventScreen from '../screens/EventDetailAiFirstScreen';
import {
  loadCampusAnnouncements,
  loadCampusAnnouncementFeed,
  loadCampusAnnouncement,
  loadCampusEventPage,
  loadCampusEvent,
} from '../services/publicCampusContent';
import { exportAndShareICalFile } from '../services/ical';
import { safeNavigate } from '../utils/safeNavigate';
import { getRawAppEnv } from '../services/release';

let mockUid: string | null = 'student-a';
let mockSchool = { id: 'pu' };
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../services/publicCampusContent', () => ({
  loadCampusAnnouncements: jest.fn(),
  loadCampusAnnouncementFeed: jest.fn(),
  loadCampusAnnouncement: jest.fn(),
  loadCampusEventPage: jest.fn(),
  loadCampusEvent: jest.fn(),
}));
jest.mock('../services/ical', () => ({ exportAndShareICalFile: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../services/release', () => ({
  getRawAppEnv: jest.fn(() => 'development'),
}));
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
  jest.mocked(getRawAppEnv).mockReturnValue('development');
  jest.mocked(loadCampusAnnouncements).mockResolvedValue([announcement]);
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [announcement],
    sources: [],
    allUnavailable: false,
  });
  jest.mocked(loadCampusAnnouncement).mockResolvedValue(announcement);
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValue({ items: [event], source: event.source, nextCursor: null });
  jest.mocked(loadCampusEvent).mockResolvedValue(event);
  jest.mocked(exportAndShareICalFile).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('announcements use school data with working categories and a registered detail route', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [
      announcement,
      { ...announcement, id: 'a2', title: '社團活動', category: 'event' },
    ],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  expect(loadCampusAnnouncementFeed).toHaveBeenCalledWith('pu');
  expect(view.queryByText(/期末考程序|32 則|AI 從|全部已讀/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '篩選：教務' }));
  expect(view.queryByText('社團活動')).toBeNull();
  fireEvent.press(view.getByText('校方的新公告'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, '公告詳情', { id: 'a1' });
});

test.each([
  [
    'permission-denied',
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
  ],
  ['unavailable', Object.assign(new Error('offline'), { code: 'unavailable' })],
])(
  'shows a retryable unread message when Firestore read fails with %s and there is no cached copy',
  async (_code, error) => {
    jest.mocked(loadCampusAnnouncementFeed).mockRejectedValueOnce(error);
    const view = render(<AnnouncementsScreen navigation={navigation} />);
    await view.findByText('暫時讀不到資料，請稍後再試');
    expect(view.getByText('再試一次')).toBeTruthy();
    expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
    expect(view.queryByText('請確認網路')).toBeNull();
    expect(view.queryByText('目前無法讀取，請確認網路連線後重試。')).toBeNull();
    expect(view.queryByText('目前沒有公告')).toBeNull();
    expect(view.queryByText('教務處')).toBeNull();
    const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
    jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
    fireEvent.press(view.getByText('再試一次'));
    expect(view.getByText('正在讀取')).toBeTruthy();
    expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    await act(async () =>
      pending.resolve({
        announcements: [announcement],
        sources: [],
        allUnavailable: false,
      }),
    );
    await view.findByText('校方的新公告');
    expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  },
);

test.each([
  [
    'permission-denied',
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
  ],
  ['unavailable', Object.assign(new Error('offline'), { code: 'unavailable' })],
])(
  'announcement detail shows a retryable unread message when Firestore read fails with %s',
  async (_code, error) => {
    jest.mocked(loadCampusAnnouncement).mockRejectedValueOnce(error);
    const view = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
    await view.findByText('暫時讀不到資料，請稍後再試');
    expect(view.getByText('再試一次')).toBeTruthy();
    expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
    expect(view.queryByText('請確認網路')).toBeNull();
    expect(view.queryByText('目前無法讀取，請確認網路連線後重試。')).toBeNull();
    expect(view.queryByText('找不到這則公告，可能已移除或不屬於目前學校。')).toBeNull();
    const pending = deferred<typeof announcement>();
    jest.mocked(loadCampusAnnouncement).mockReturnValueOnce(pending.promise);
    fireEvent.press(view.getByText('再試一次'));
    expect(view.getByText('正在讀取')).toBeTruthy();
    expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    await act(async () => pending.resolve(announcement));
    await view.findByText('校方的新公告');
    expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  },
);

test('keeps cached announcements when a later Firestore read fails', async () => {
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  jest.mocked(loadCampusAnnouncementFeed).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent.press(view.getByText('更新公告'));
  await view.findByText('校方的新公告');
  expect(view.getByText('最後更新 10/8 08:00，暫時讀不到新公告')).toBeTruthy();
  expect(view.queryByText('學校網站暫時連不上')).toBeNull();
  expect(view.queryByText('請確認網路')).toBeNull();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
});

test('does not show unpublished copy before the first feed returns', async () => {
  const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
  jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  expect(view.getByText('正在讀取')).toBeTruthy();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.queryByText('目前沒有公告')).toBeNull();
  await act(async () =>
    pending.resolve({
      announcements: [announcement],
      sources: [],
      allUnavailable: false,
    }),
  );
  await view.findByText('校方的新公告');
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
});

test('shows unpublished copy only after an empty feed has finished loading', async () => {
  const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
  jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  expect(view.getByText('正在讀取')).toBeTruthy();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.queryByText('目前沒有公告')).toBeNull();
  await act(async () =>
    pending.resolve({
      announcements: [],
      sources: [],
      allUnavailable: false,
    }),
  );
  await view.findByText('本站還沒接上這間學校的公告。');
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
});

test('switching schools shows loading instead of the previous list or an empty school', async () => {
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
  jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
  mockSchool = { id: 'nthu' };
  view.rerender(<AnnouncementsScreen navigation={navigation} />);
  expect(view.queryByText('校方的新公告')).toBeNull();
  expect(view.getByText('正在讀取')).toBeTruthy();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.queryByText('目前沒有公告')).toBeNull();
  await act(async () =>
    pending.resolve({
      announcements: [{ ...announcement, title: '清華公告' }],
      sources: [],
      allUnavailable: false,
    }),
  );
  await view.findByText('清華公告');
  expect(view.queryByText('校方的新公告')).toBeNull();
});

test('switching schools hides the previous announcement list and does not keep it as stale cache', async () => {
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  jest.mocked(loadCampusAnnouncementFeed).mockRejectedValueOnce(new Error('permission-denied'));
  mockSchool = { id: 'nthu' };
  view.rerender(<AnnouncementsScreen navigation={navigation} />);
  expect(view.queryByText('校方的新公告')).toBeNull();
  await view.findByText('暫時讀不到資料，請稍後再試');
  expect(view.getByText('再試一次')).toBeTruthy();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(loadCampusAnnouncementFeed).toHaveBeenLastCalledWith('nthu');
});

test('hides stale scrape rows when the school site is down and links the office when empty', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [],
    sources: [
      {
        sourceId: 'pu-acd',
        office: '教務處',
        status: 'unavailable',
        message: '暫時抓不到',
        lastSuccessAt: '2026-10-12T10:05:00.000Z',
        listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
      },
    ],
    allUnavailable: true,
  });
  const list = render(<AnnouncementsScreen navigation={navigation} />);
  await list.findByText('暫時讀不到資料，請稍後再試');
  expect(list.getByText('再試一次')).toBeTruthy();
  expect(list.queryByText('學校網站暫時連不上')).toBeNull();
  expect(list.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(list.queryByText('校方的新公告')).toBeNull();
  expect(list.queryByText('暫時讀不到新公告')).toBeNull();
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [],
    sources: [
      {
        sourceId: 'pu-acd',
        office: '教務處',
        status: 'unavailable',
        message: '暫時抓不到',
        listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
      },
    ],
    allUnavailable: true,
  });
  const empty = render(<AnnouncementsScreen navigation={navigation} />);
  await empty.findByText('暫時讀不到資料，請稍後再試');
  expect(empty.getByText('再試一次')).toBeTruthy();
  expect(empty.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(empty.queryByText('目前沒有公告')).toBeNull();
  expect(empty.queryByText('學校網站暫時連不上')).toBeNull();
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  fireEvent.press(empty.getByText('教務處'));
  expect(openUrl).toHaveBeenCalledWith('https://acd.pu.edu.tw/p/403-1042-885-1.php');
  fireEvent.press(empty.getByText('再試一次'));
  expect(loadCampusAnnouncementFeed).toHaveBeenCalled();
  openUrl.mockRestore();
  jest.mocked(loadCampusAnnouncement).mockResolvedValue({
    ...announcement,
    summary: '選課摘要',
    originalUrl: 'https://acd.pu.edu.tw/p/412-1042-1.php',
  });
  const detail = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  await detail.findByText('看原文');
});

test.each([
  ['cycu', '全校最新消息', 'https://www.cycu.edu.tw/'],
  ['tmu', '全校最新消息', 'https://www.tmu.edu.tw/news'],
] as const)(
  'shows a retryable unread message when %s sources are unavailable and the list is empty',
  async (school, office, url) => {
    mockSchool = { id: school };
    jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
      announcements: [],
      officialAnnouncements: [],
      sources: [
        {
          sourceId: `${school}-campus`,
          office,
          status: 'unavailable',
          message: '暫時抓不到',
          listUrl: url,
        },
      ],
      allUnavailable: true,
    });
    const view = render(<AnnouncementsScreen navigation={navigation} />);
    await view.findByText('暫時讀不到資料，請稍後再試');
    expect(view.getByText('再試一次')).toBeTruthy();
    expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
    expect(view.queryByText('學校網站暫時連不上')).toBeNull();
    expect(view.queryByText('前往學校官方公告')).toBeNull();
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    fireEvent.press(view.getByText(office));
    expect(openUrl).toHaveBeenCalledWith(url);
    fireEvent.press(view.getByText('再試一次'));
    expect(loadCampusAnnouncementFeed).toHaveBeenCalled();
    openUrl.mockRestore();
  },
);

test.each([
  ['ncku', '全校最新消息', 'https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw'],
  ['ntpu', '電子公文一般公告（含教務處）', 'https://fms.ntpu.edu.tw/km/24662'],
] as const)(
  'shows unpublished copy and the official %s announcement page when that school has no items',
  async (school, office, url) => {
    mockSchool = { id: school };
    jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
      announcements: [],
      sources: [],
      allUnavailable: false,
    });
    const view = render(<AnnouncementsScreen navigation={navigation} />);
    await view.findByText('本站還沒接上這間學校的公告。');
    expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    expect(view.queryByText('再試一次')).toBeNull();
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    fireEvent.press(view.getByText('前往學校官方公告'));
    expect(openUrl).toHaveBeenCalledWith(url);
    fireEvent.press(view.getByText(office));
    expect(openUrl).toHaveBeenCalledWith(url);
    openUrl.mockRestore();
  },
);

test('links catalog office sites when the school has never been fetched', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('本站還沒接上這間學校的公告。');
  expect(view.queryByText('目前沒有公告')).toBeNull();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.queryByText('學校網站暫時連不上')).toBeNull();
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  fireEvent.press(view.getByText('前往學校官方公告'));
  expect(openUrl).toHaveBeenCalledWith('https://dorac.pu.edu.tw/p/403-1059-719-1.php');
  fireEvent.press(view.getByText('教務處'));
  expect(openUrl).toHaveBeenCalledWith('https://acd.pu.edu.tw/p/403-1042-885-1.php');
  openUrl.mockRestore();
});

test('retry after a failed feed can show the unpublished empty state', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockRejectedValueOnce(new Error('offline'));
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('暫時讀不到資料，請稍後再試');
  const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
  jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
  fireEvent.press(view.getByText('再試一次'));
  expect(view.getByText('正在讀取')).toBeTruthy();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  await act(async () =>
    pending.resolve({
      announcements: [],
      sources: [],
      allUnavailable: false,
    }),
  );
  await view.findByText('本站還沒接上這間學校的公告。');
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.getByText('教務處')).toBeTruthy();
});

test('shows an empty success only after a successful empty fetch', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [],
    sources: [
      {
        sourceId: 'pu-acd',
        office: '教務處',
        status: 'healthy',
        message: '',
        lastSuccessAt: '2026-10-12T10:05:00.000Z',
        listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
      },
    ],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('目前沒有學生日常公告。');
  expect(view.queryByText('目前沒有公告')).toBeNull();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.queryByText('學校網站暫時連不上')).toBeNull();
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  fireEvent.press(view.getByText('前往學校官方公告'));
  expect(openUrl).toHaveBeenCalledWith('https://dorac.pu.edu.tw/p/403-1059-719-1.php');
  fireEvent.press(view.getByText('教務處'));
  expect(openUrl).toHaveBeenCalledWith('https://acd.pu.edu.tw/p/403-1042-885-1.php');
  openUrl.mockRestore();
});

test.each(['', 'staging', 'production'])(
  'hides cms-none demo schools from the announcement list when app env is %s',
  async (env) => {
    mockSchool = { id: 'tw-demo-uni' };
    jest.mocked(getRawAppEnv).mockReturnValue(env);
    const view = render(<AnnouncementsScreen navigation={navigation} />);
    expect(view.getByText('目前沒有公告')).toBeTruthy();
    expect(view.queryByText('示範大學')).toBeNull();
    expect(view.queryByText('暫時抓不到')).toBeNull();
    expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
    expect(view.queryByText('學校網站暫時連不上')).toBeNull();
  },
);

test('shows cms-none demo schools on the announcement list in an explicit test environment', async () => {
  mockSchool = { id: 'tw-demo-uni' };
  jest.mocked(getRawAppEnv).mockReturnValue('test');
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  expect(await view.findByText('校方的新公告')).toBeTruthy();
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

test('announcement detail retains the complete body and paragraph breaks when a separate summary exists', async () => {
  const body = '第一段完整說明。\n\n第二段：請檢附在學證明與申請文件。';
  jest.mocked(loadCampusAnnouncement).mockResolvedValueOnce({
    ...announcement,
    body,
    summary: '簡短摘要。',
  });
  const view = render(<AnnouncementScreen route={{ params: { id: 'a1' } }} />);
  expect(await view.findByText(body)).toBeTruthy();
  expect(view.queryByText('簡短摘要。')).toBeNull();
  expect(view.queryByText('摘要，全文見原文')).toBeNull();
});

test('event date filters work and list navigation uses the actual event ID', async () => {
  jest.mocked(loadCampusEventPage).mockResolvedValue({
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

test('does not show 前往學校官方公告 when the school has no verified official list', async () => {
  mockSchool = { id: 'cgu' };
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('本站還沒接上這間學校的公告。');
  expect(view.queryByText('前往學校官方公告')).toBeNull();
  expect(view.queryByText('再試一次')).toBeNull();
  expect(view.queryByText('學校網站暫時連不上')).toBeNull();
  expect(view.queryByText('這間學校的公告還沒上架。')).toBeNull();
});

test('keeps staff and security posts in 全部公告 and hides undated or future rows', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [announcement],
    officialAnnouncements: [
      announcement,
      {
        ...announcement,
        id: 'sec',
        title: '【漏洞預警】Cisco License 存在重大資安漏洞',
        source: '計算機與網路中心',
        category: 'system' as const,
      },
      {
        ...announcement,
        id: 'staff',
        title: '點名計分單(for教師)',
        source: '教務處',
      },
    ],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  expect(view.getByText('學生公告')).toBeTruthy();
  expect(view.getByText('全部公告')).toBeTruthy();
  expect(view.queryByText(/Cisco/)).toBeNull();
  fireEvent.press(view.getByText('全部公告'));
  expect(view.getByText(/Cisco/)).toBeTruthy();
  expect(view.getByText('點名計分單(for教師)')).toBeTruthy();
});

test('mounted read errors follow theme changes without reloading or remounting', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockRejectedValue(new Error('offline'));
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  const failedText = '暫時讀不到資料，請稍後再試';
  await view.findByText(failedText);
  expect(view.getByText('再試一次')).toBeTruthy();
  expect(view.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(view.queryByText('請確認網路')).toBeNull();
  act(() => applyTheme('dark'));
  expect(view.getByText(failedText)).toBeTruthy();
  expect(loadCampusAnnouncementFeed).toHaveBeenCalledTimes(1);
  act(() => applyTheme('light'));
  expect(view.getByText(failedText)).toBeTruthy();
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

test('a visitor can read the public announcement list and open its detail', async () => {
  mockUid = null;
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValue({
    announcements: [announcement],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  fireEvent.press(await view.findByText('校方的新公告'));
  expect(loadCampusAnnouncementFeed).toHaveBeenCalledWith('pu');
  expect(safeNavigate).toHaveBeenCalledWith(navigation, '公告詳情', { id: 'a1' });
});

test('announcement search matches the loaded content and office with normalized multi-word queries', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValueOnce({
    announcements: [
      { ...announcement, body: 'IELTS 報名開放', office: '語言中心', source: undefined },
      { ...announcement, id: 'other', title: '社團招生', body: '新生交流', category: 'event' },
    ],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  fireEvent.changeText(view.getByLabelText('搜尋公告'), '  ｉｅｌｔｓ　語言中心 ');
  expect(view.getByText('校方的新公告')).toBeTruthy();
  expect(view.queryByText('社團招生')).toBeNull();
  expect(view.getByText('找到 1 則。搜尋與篩選適用已載入的公告。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋公告'), '不存在的項目');
  expect(view.getByText('找不到符合的公告')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '清除公告篩選' }));
  expect(view.getByLabelText('搜尋公告').props.value).toBe('');
  expect(view.getByText('社團招生')).toBeTruthy();
});

test('switching announcement views clears an unavailable category and preserves the search', async () => {
  jest.mocked(loadCampusAnnouncementFeed).mockResolvedValueOnce({
    announcements: [announcement],
    officialAnnouncements: [
      announcement,
      { ...announcement, id: 'security', title: '系統維護公告', category: 'system' },
    ],
    sources: [],
    allUnavailable: false,
  });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('校方的新公告');
  fireEvent.changeText(view.getByLabelText('搜尋公告'), '公告');
  fireEvent.press(view.getByRole('button', { name: '篩選：全部公告' }));
  fireEvent.press(view.getByRole('button', { name: '篩選：系統' }));
  expect(view.queryByText('校方的新公告')).toBeNull();
  expect(view.getByText('系統維護公告')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '篩選：學生公告' }));
  expect(view.getByLabelText('搜尋公告').props.value).toBe('公告');
  expect(view.getByText('校方的新公告')).toBeTruthy();
  expect(view.getByRole('button', { name: '篩選：全部 1' }).props.accessibilityState.selected).toBe(
    true,
  );
});

test.each(['school', 'account'] as const)(
  'announcement filters reset with the %s scope',
  async (changed) => {
    const view = render(<AnnouncementsScreen navigation={navigation} />);
    await view.findByText('校方的新公告');
    fireEvent.changeText(view.getByLabelText('搜尋公告'), '舊範圍搜尋');
    fireEvent.press(view.getByRole('button', { name: '篩選：教務' }));
    const pending = deferred<Awaited<ReturnType<typeof loadCampusAnnouncementFeed>>>();
    jest.mocked(loadCampusAnnouncementFeed).mockReturnValueOnce(pending.promise);
    if (changed === 'school') mockSchool = { id: 'ncku' };
    else mockUid = 'student-b';
    view.rerender(<AnnouncementsScreen navigation={navigation} />);
    expect(view.queryByDisplayValue('舊範圍搜尋')).toBeNull();
    expect(view.getByText('正在讀取')).toBeTruthy();
    await act(async () =>
      pending.resolve({
        announcements: [{ ...announcement, title: '新的校園活動', category: 'event' }],
        sources: [],
        allUnavailable: false,
      }),
    );
    expect(view.getByLabelText('搜尋公告').props.value).toBe('');
    expect(view.getByText('新的校園活動')).toBeTruthy();
  },
);

test('announcement search includes records beyond the rendered batch and reset restores the first batch', async () => {
  const announcements = Array.from({ length: 65 }, (_, index) => ({
    ...announcement,
    id: `a${index + 1}`,
    title: `學校消息 ${index + 1}`,
  }));
  jest
    .mocked(loadCampusAnnouncementFeed)
    .mockResolvedValueOnce({ announcements, sources: [], allUnavailable: false });
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('學校消息 1');
  expect(view.queryByText('學校消息 31')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '顯示更多公告（還有 35 則）' }));
  expect(view.getByText('學校消息 31')).toBeTruthy();
  expect(view.queryByText('學校消息 61')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋公告'), '消息 65');
  expect(view.getByText('學校消息 65')).toBeTruthy();
  expect(view.queryByText(/顯示更多公告/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '清除公告搜尋' }));
  expect(view.getByText('學校消息 1')).toBeTruthy();
  expect(view.queryByText('學校消息 31')).toBeNull();
});

test('failed official announcement links show an actionable error and can be retried', async () => {
  jest
    .mocked(loadCampusAnnouncementFeed)
    .mockResolvedValueOnce({ announcements: [], sources: [], allUnavailable: false });
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('cannot open'))
    .mockResolvedValueOnce(undefined as never);
  const view = render(<AnnouncementsScreen navigation={navigation} />);
  await view.findByText('前往學校官方公告');
  await act(async () => fireEvent.press(view.getByText('前往學校官方公告')));
  expect(view.getByRole('alert').props.children).toBe('無法開啟校方公告，請稍後再試。');
  await act(async () => fireEvent.press(view.getByText('前往學校官方公告')));
  expect(open).toHaveBeenCalledTimes(2);
  expect(view.queryByRole('alert')).toBeNull();
});

test('event search preserves its query across failed pagination and finds a matching later page', async () => {
  jest
    .mocked(loadCampusEventPage)
    .mockResolvedValueOnce(eventPage([event], eventCursor))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(
      eventPage([
        {
          ...event,
          id: 'next',
          title: '交流午餐',
          description: 'English practice',
          location: '國際會館',
        },
      ]),
    );
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('校方的新活動');
  fireEvent.changeText(view.getByLabelText('搜尋活動'), 'ＥＮＧＬＩＳＨ 國際');
  expect(view.getByText('已載入的活動中沒有符合項目')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('載入更多活動')));
  expect(view.getByText('重試載入')).toBeTruthy();
  expect(view.getByLabelText('搜尋活動').props.value).toBe('ＥＮＧＬＩＳＨ 國際');
  await act(async () => fireEvent.press(view.getByText('重試載入')));
  expect(view.getByText('交流午餐')).toBeTruthy();
  expect(view.queryByText('校方的新活動')).toBeNull();
  expect(view.getByText('找到 1 場')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '清除活動篩選' }));
  expect(view.getByText('校方的新活動')).toBeTruthy();
});

test('event time filters keep ongoing events out of the past and identify missing end times without guessing', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T04:00:00Z'));
  jest.mocked(loadCampusEventPage).mockResolvedValueOnce({
    items: [
      {
        ...event,
        id: 'ongoing',
        title: '午間講座',
        startsAt: '2026-10-25T03:00:00Z',
        endsAt: '2026-10-25T05:00:00Z',
      },
      { ...event, id: 'started', title: '未公告結束的展覽', startsAt: '2026-10-25T03:00:00Z' },
      {
        ...event,
        id: 'ended',
        title: '昨天的工作坊',
        startsAt: '2026-10-24T03:00:00Z',
        endsAt: '2026-10-24T05:00:00Z',
      },
      {
        ...event,
        id: 'invalid',
        title: '待公布場次',
        startsAt: 'invalid date',
        endsAt: '2026-10-25T05:00:00Z',
      },
      event,
    ],
    source: event.source,
    nextCursor: null,
  });
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('午間講座');
  expect(view.getByRole('button', { name: /未公告結束的展覽，已開始/ })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '篩選：進行中' }));
  expect(view.getByText('午間講座')).toBeTruthy();
  expect(view.queryByText('未公告結束的展覽')).toBeNull();
  expect(view.queryByText('昨天的工作坊')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '篩選：已開始／過往' }));
  expect(view.queryByText('午間講座')).toBeNull();
  expect(view.getByText('未公告結束的展覽')).toBeTruthy();
  expect(view.getByText('昨天的工作坊')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '篩選：時間待公告' }));
  expect(view.getByText('待公布場次')).toBeTruthy();
  expect(view.queryByText('校方的新活動')).toBeNull();
});

test.each(['school', 'account'] as const)(
  'event search and period reset with the %s scope',
  async (changed) => {
    const view = render(<EventsScreen navigation={navigation} />);
    await view.findByText('校方的新活動');
    fireEvent.changeText(view.getByLabelText('搜尋活動'), '舊搜尋');
    fireEvent.press(view.getByRole('button', { name: '篩選：進行中' }));
    const pending = deferred<ReturnType<typeof eventPage>>();
    jest.mocked(loadCampusEventPage).mockReturnValueOnce(pending.promise);
    if (changed === 'school') mockSchool = { id: 'ncku' };
    else mockUid = 'student-b';
    view.rerender(<EventsScreen navigation={navigation} />);
    expect(view.queryByDisplayValue('舊搜尋')).toBeNull();
    await act(async () => pending.resolve(eventPage([{ ...event, title: '新範圍的活動' }])));
    expect(view.getByLabelText('搜尋活動').props.value).toBe('');
    expect(view.getByRole('button', { name: '篩選：全部' }).props.accessibilityState.selected).toBe(
      true,
    );
    expect(view.getByText('新範圍的活動')).toBeTruthy();
  },
);

test('returning to the foreground updates event phases and removes its subscription on exit', async () => {
  let updateAppState: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    updateAppState = listener;
    return { remove };
  });
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T02:00:00Z'));
  jest.mocked(loadCampusEventPage).mockResolvedValueOnce({
    items: [
      {
        ...event,
        title: '上午活動',
        startsAt: '2026-10-25T03:00:00Z',
        endsAt: '2026-10-25T05:00:00Z',
      },
    ],
    source: event.source,
    nextCursor: null,
  });
  const view = render(<EventsScreen navigation={navigation} />);
  await view.findByText('上午活動');
  fireEvent.press(view.getByRole('button', { name: '篩選：進行中' }));
  expect(view.queryByText('上午活動')).toBeNull();
  now.mockReturnValue(Date.parse('2026-10-25T04:00:00Z'));
  act(() => updateAppState?.('active'));
  expect(view.getByText('上午活動')).toBeTruthy();
  expect(loadCampusEventPage).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test.each([
  [AnnouncementsScreen, '搜尋公告', '教務', '校方的新公告'],
  [EventsScreen, '搜尋活動', '未來活動', '校方的新活動'],
] as const)(
  'content lists expose selected filters and keep result taps available with the keyboard open',
  async (Screen, searchLabel, filterLabel, title) => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const view = render(<Screen navigation={navigation} />);
    await view.findByText(title);
    const filter = view.getByRole('button', { name: `篩選：${filterLabel}` });
    expect(StyleSheet.flatten(filter.props.style).minHeight).toBe(44);
    fireEvent.press(filter);
    expect(
      view.getByRole('button', { name: `篩選：${filterLabel}` }).props.accessibilityState.selected,
    ).toBe(true);
    expect(view.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
    expect(view.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('on-drag');
    fireEvent.changeText(view.getByLabelText(searchLabel), '校方');
    fireEvent.press(view.getByText(title));
    expect(dismiss).toHaveBeenCalled();
    expect(safeNavigate).toHaveBeenCalled();
  },
);

test('invalid event dates disable calendar export instead of leaving a silent action', async () => {
  jest.mocked(loadCampusEvent).mockResolvedValueOnce({ ...event, startsAt: 'invalid' });
  const view = render(<EventScreen route={{ params: { id: 'e1' } }} />);
  await view.findByText('校方的新活動');
  const exportButton = view.getByRole('button', { name: '匯出行事曆' });
  expect(exportButton.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(exportButton);
  expect(exportAndShareICalFile).not.toHaveBeenCalled();
});
