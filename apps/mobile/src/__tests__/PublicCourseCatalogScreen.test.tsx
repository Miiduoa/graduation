import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog } from '../services/courseCatalogClient';

let mockSchoolId = 'ncnu';
const setBrowsingSchoolId = (value: string) => { mockSchoolId = value; };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId, name: mockSchoolId } }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('../state/schedule', () => ({ useSchedule: () => ({ courses: [] }) }));
jest.mock('../services/courseCatalogClient', () => ({ queryCatalog: jest.fn() }));
jest.mock('../services/analytics', () => ({ analytics: {} }));
jest.mock('../services/tronClassWebUiGate', () => ({}));
jest.mock('../services/tronClassDataEnabled', () => ({}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0,
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});
afterEach(() => { jest.restoreAllMocks(); });

function ncnuJson(courses: unknown[], schoolId = 'ncnu') {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
    truncated: false, courses,
  }) };
}
const ncnuDatabaseCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '', time: '4efg',
  room: '管268', semester: '1151', credits: '3.0',
};
const nthuCourse = {
  code: '11510AES 520300', section: '00', title: '分析化學專題', department: 'AES', teacher: '王老師',
  time: 'M3M4\nR5R6', room: '教室甲\n教室乙', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '教室甲' }, { time: 'R5R6', room: '教室乙' }],
};
function nthuJson(courses: unknown[] = [nthuCourse], extra: Record<string, unknown> = {}) {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId: 'nthu', sourceUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json', fetchedAt: '2026-11-06T08:00:00.000Z',
    truncated: false, courses, ...extra,
  }) };
}
test('NTHU preserves classroom pairs and provides reviewed CSV import without writing private records', async () => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  const fetchSource = jest.fn().mockResolvedValue(nthuJson());
  const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalImport'] }) };
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen navigation={navigation} />);
    fireEvent.changeText(view.getByLabelText('搜尋清大課程'), 'AES');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('分析化學專題')).toBeTruthy();
    expect(view.getByText('星期一 3、4 節 · 10:10–12:00 · 教室甲')).toBeTruthy();
    expect(view.getByText('校方資料擷取：2026-11-06 16:00（台灣時間；非校方更新時間）')).toBeTruthy();
    expect(view.getByText('星期四 5、6 節 · 13:20–15:10 · 教室乙')).toBeTruthy();
    expect(fetchSource).toHaveBeenCalledWith('https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES', expect.objectContaining({ credentials: 'omit' }));
    fireEvent.press(view.getByText('複製課表匯入資料'));
    expect(await view.findByText('已複製，請到匯入頁貼上並核對上課時間。')).toBeTruthy();
    const csv = jest.mocked(Clipboard.setStringAsync).mock.calls[0][0];
    expect(csv).toContain('11510AES 520300');
    expect(csv).toContain('教室甲');
    expect(csv).toContain('教室乙');
    expect(csv).toContain('13:20');
    fireEvent.press(view.getByText('前往課表匯入'));
    expect(navigation.navigate).toHaveBeenCalledWith('PersonalImport', undefined);
    expect(queryCatalog).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test('NTHU clipboard rejection retains selectable import data and unscheduled courses stay readable', async () => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('unavailable'));
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson([nthuCourse, {
      ...nthuCourse, code: '11510AES 520301', section: '01', title: '待公告時間課程',
      time: '', room: '', meetings: [],
    }]));
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    await view.findByText('分析化學專題');
    expect(view.getByText('待公告時間課程')).toBeTruthy();
    expect(view.getByText('上課時間未提供')).toBeTruthy();
    expect(view.getAllByText('複製課表匯入資料')).toHaveLength(1);
    fireEvent.press(view.getByText('複製課表匯入資料'));
    const fallback = await view.findByLabelText('可複製的課表資料');
    expect(fallback.props.children).toContain('11510AES 520300');
    expect(fallback.props.selectable).toBe(true);
  } finally { globalThis.fetch = original; }
});

test.each(['false', 'rejection'])('a clipboard %s after a successful copy clears the success message and preserves manual copy', async (failure) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  const clipboard = jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(true);
  if (failure === 'false') clipboard.mockResolvedValueOnce(false);
  else clipboard.mockRejectedValueOnce(new Error('unavailable'));
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson());
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    await view.findByText('分析化學專題');
    fireEvent.press(view.getByText('複製課表匯入資料'));
    expect(await view.findByText('已複製，請到匯入頁貼上並核對上課時間。')).toBeTruthy();
    fireEvent.press(view.getByText('複製課表匯入資料'));
    const fallback = await view.findByLabelText('可複製的課表資料');
    expect(view.queryByText('已複製，請到匯入頁貼上並核對上課時間。')).toBeNull();
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(fallback.props.children).toBe(clipboard.mock.calls[0][0]);
    expect(fallback.props.selectable).toBe(true);
    expect(view.getByText('前往課表匯入')).toBeTruthy();
  } finally { globalThis.fetch = original; }
});

test('switching between public campuses aborts the old request and ignores its late reply', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  let finish!: (data: ReturnType<typeof ncnuJson>) => void;
  const fetchSource = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(nthuJson());
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
    setBrowsingSchoolId('nthu');
    view.rerender(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    expect(await view.findByText('分析化學專題')).toBeTruthy();
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { finish(ncnuJson([ncnuDatabaseCourse])); });
    expect(view.queryByText('資料庫管理系統')).toBeNull();
  } finally { globalThis.fetch = original; }
});

test('a pending catalog response times out and allows retry with the same keyword', async () => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  jest.useFakeTimers();
  const fetchSource = jest.fn().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(nthuJson());
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen />);
    fireEvent.changeText(view.getByLabelText('搜尋清大課程'), 'AES');
    fireEvent.press(view.getByText('查詢課程'));
    await act(async () => { jest.advanceTimersByTime(25_000); });
    expect(view.getByText('暫時無法讀取清大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { fireEvent.press(view.getByText('重新查詢')); });
    expect(view.getByText('分析化學專題')).toBeTruthy();
    view.unmount();
  } finally { globalThis.fetch = original; jest.useRealTimers(); }
});

test('NCNU guest catalog opens directly and supports code search, empty results and the official guest link', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  const fetchSource = jest.fn().mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse])).mockResolvedValueOnce(ncnuJson([]));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen />);
    const input = await view.findByLabelText('搜尋暨大課程');
    fireEvent.changeText(input, '130032');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('資料庫管理系統')).toBeTruthy();
    expect(view.getByText('星期四 e、f、g 節 · 13:30–16:20 · 管268')).toBeTruthy();
    expect(fetchSource).toHaveBeenCalledWith('https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=130032', expect.objectContaining({ credentials: 'omit' }));
    fireEvent.changeText(input, '其他');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('找不到「其他」的開課資料。')).toBeTruthy();
    fireEvent.press(view.getByText('開啟暨大官方課程目錄'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall');
    expect(queryCatalog).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test('NCNU late response is cancelled on school switch and a different-campus payload fails closed', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  let finish!: (data: ReturnType<typeof ncnuJson>) => void;
  const fetchSource = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse], 'pu'));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
    setBrowsingSchoolId('ncku');
    view.rerender(<CourseCatalogScreen />);
    await waitFor(() => expect(view.queryByLabelText('搜尋暨大課程')).toBeNull());
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { finish(ncnuJson([ncnuDatabaseCourse])); });
    expect(view.queryByText('資料庫管理系統')).toBeNull();
    setBrowsingSchoolId('ncnu');
    view.rerender(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    expect(await view.findByText('暫時無法讀取暨大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(view.queryByText('資料庫管理系統')).toBeNull();
  } finally { globalThis.fetch = original; }
});

test.each([
  { sourceUrl: 'https://example.test/unverified-courses' },
  { operation: { id: 'ncnu.courses.search', version: 1, responseSchemaVersion: 1, access: 'anonymous-public' } },
  { operation: { id: 'nthu.courses.search', version: 2, responseSchemaVersion: 1, access: 'anonymous-public' } },
])('a source or operation mismatch cannot become a mobile import: %j', async (extra) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson([nthuCourse], extra));
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    expect(await view.findByText('暫時無法讀取清大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(view.queryByText('分析化學專題')).toBeNull();
    expect(view.queryByText('複製課表匯入資料')).toBeNull();
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test('the real native Request keeps the strict API query without adding a cache-busting underscore', async () => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  const { Request: NativeRequest } = jest.requireActual('whatwg-fetch') as {
    Request: new (url: string, init?: RequestInit) => Request;
  };
  const expectedUrl = 'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES';
  // This control exercises the actual polyfill behavior that broke native GETs.
  expect(new URL(new NativeRequest(expectedUrl, { cache: 'no-store' }).url).searchParams.has('_')).toBe(true);
  let request: Request | undefined;
  const fetchSource = jest.fn(async (url: string, options: RequestInit) => {
    request = new NativeRequest(url, options);
    return { ...nthuJson(), url: request.url };
  });
  try {
    globalThis.fetch = fetchSource as unknown as typeof fetch;
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    expect(await view.findByText('分析化學專題')).toBeTruthy();
    expect(request?.url).toBe(expectedUrl);
    expect(request?.credentials).toBe('omit');
    expect(fetchSource.mock.calls[0][1]).not.toHaveProperty('cache');
    expect(new URL(request!.url).searchParams.has('_')).toBe(false);
  } finally { globalThis.fetch = original; }
});

test.each([
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES%20A',
  'https://nuni.tw/api/public-course-catalog?q=AES+A&schoolId=nthu',
])('accepts a reported final URL only for the same endpoint, campus and decoded query: %s', async (url) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = jest.fn().mockResolvedValue({ ...nthuJson(), url });
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES A' } } }} />);
    expect(await view.findByText('分析化學專題')).toBeTruthy();
  } finally { globalThis.fetch = original; }
});

test.each([
  'https://other.test/api/public-course-catalog?schoolId=nthu&q=AES',
  'https://nuni.tw.evil.test/api/public-course-catalog?schoolId=nthu&q=AES',
  'http://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES',
  'https://nuni.tw/elsewhere?schoolId=nthu&q=AES',
  'https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=AES',
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=other',
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES&_=123',
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&schoolId=nthu&q=AES',
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES&q=AES',
  'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES#unverified',
  'https://account:secret@nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES',
  '/api/public-course-catalog?schoolId=nthu&q=AES',
])('a different reported final URL cannot display or import an otherwise valid catalog: %s', async (url) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  const body = jest.fn(nthuJson().text);
  try {
    globalThis.fetch = jest.fn().mockResolvedValue({ ...nthuJson(), url, text: body });
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    expect(await view.findByText('暫時無法讀取清大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
    expect(view.queryByText('分析化學專題')).toBeNull();
    expect(view.queryByText('複製課表匯入資料')).toBeNull();
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test.each([
  { earlier: true, later: false, feedback: '請選取下方資料複製，再到匯入頁貼上。' },
  { earlier: false, later: true, feedback: '已複製，請到匯入頁貼上並核對上課時間。' },
])('overlapping clipboard attempts keep only the latest result (earlier=$earlier, later=$later)', async ({ earlier, later, feedback }) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  let resolveEarlier!: (value: boolean) => void;
  const clipboard = jest.mocked(Clipboard.setStringAsync);
  clipboard.mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveEarlier = resolve; }));
  clipboard.mockResolvedValueOnce(later);
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson());
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    await view.findByText('分析化學專題');
    fireEvent.press(view.getByText('複製課表匯入資料'));
    expect(clipboard).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByText('複製課表匯入資料'));
    // The newer native write must start only after the older write finishes:
    // otherwise the earlier OS completion could replace the latest clipboard.
    expect(clipboard).toHaveBeenCalledTimes(1);
    await act(async () => { resolveEarlier(earlier); });
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    expect(await view.findByText(feedback)).toBeTruthy();
    if (later) {
      expect(view.queryByLabelText('可複製的課表資料')).toBeNull();
    } else {
      expect(view.queryByText('已複製，請到匯入頁貼上並核對上課時間。')).toBeNull();
      expect(view.getByLabelText('可複製的課表資料').props.selectable).toBe(true);
    }
  } finally { globalThis.fetch = original; }
});

test('copying a different course while the old native write is pending leaves the later course on the OS clipboard', async () => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  const secondCourse = {
    ...nthuCourse, code: '11510AES 520401', section: '01', title: '第二門課',
    meetings: [{ time: 'T3T4', room: '第二教室' }],
  };
  const clipboard = jest.mocked(Clipboard.setStringAsync);
  let finishFirst!: () => void;
  let actualClipboard = '';
  clipboard.mockImplementationOnce((value) => new Promise<boolean>((resolve) => {
    finishFirst = () => { actualClipboard = value; resolve(true); };
  }));
  clipboard.mockImplementationOnce(async (value) => { actualClipboard = value; return true; });
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson([nthuCourse, secondCourse]));
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    await view.findByText('第二門課');
    const actions = view.getAllByText('複製課表匯入資料');
    expect(actions).toHaveLength(2);
    fireEvent.press(actions[0]);
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    fireEvent.press(actions[1]);
    expect(clipboard).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst(); });
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    await view.findByText('已複製，請到匯入頁貼上並核對上課時間。');
    expect(clipboard.mock.calls[0][0]).toContain('11510AES 520300');
    expect(clipboard.mock.calls[1][0]).toContain('11510AES 520401');
    expect(actualClipboard).toContain('11510AES 520401');
  } finally { globalThis.fetch = original; }
});

test.each([
  {
    name: 'older than 24 hours', fetchedAt: '2026-11-06T08:00:00.000Z',
    now: '2026-11-07T08:00:01.000Z', warning: /距離伺服器上次取得校方資料已超過 24 小時/,
  },
  {
    name: 'within 24 hours', fetchedAt: '2026-11-06T08:00:00.000Z',
    now: '2026-11-07T07:59:59.000Z', warning: null,
  },
  {
    name: 'future timestamp beyond clock-skew tolerance', fetchedAt: '2026-11-08T08:05:01.000Z',
    now: '2026-11-08T08:00:00.000Z', warning: /擷取時間比此裝置時間晚超過 5 分鐘/,
  },
  {
    name: 'five-minute clock skew is tolerated', fetchedAt: '2026-11-08T08:05:00.000Z',
    now: '2026-11-08T08:00:00.000Z', warning: null,
  },
  {
    name: 'missing timestamp', fetchedAt: undefined,
    now: '2026-11-08T08:00:00.000Z', warning: /目前沒有校方資料的擷取時間/,
  },
])('public course data freshness: $name', async ({ fetchedAt, now, warning }) => {
  setBrowsingSchoolId('nthu');
  const original = globalThis.fetch;
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
  try {
    globalThis.fetch = jest.fn().mockResolvedValue(nthuJson([nthuCourse], { fetchedAt }));
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: 'AES' } } }} />);
    expect(await view.findByText('分析化學專題')).toBeTruthy();
    if (warning) expect(view.getByText(warning)).toBeTruthy();
    else {
      expect(view.queryByText(/距離伺服器上次取得校方資料已超過 24 小時/)).toBeNull();
      expect(view.queryByText(/擷取時間比此裝置時間晚超過 5 分鐘/)).toBeNull();
      expect(view.queryByText(/目前沒有校方資料的擷取時間/)).toBeNull();
    }
    // Freshness is a warning, not proof of enrollment or a silent private write.
    expect(view.getByText('複製課表匯入資料')).toBeTruthy();
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = original;
  }
});
