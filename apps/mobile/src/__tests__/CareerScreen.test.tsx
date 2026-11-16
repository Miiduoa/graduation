let mockUser: { uid: string } | null = null;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: async () => ({ courses: [] }),
}));
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { CareerScreen } from '../screens/CareerScreen';
import {
  CAREER_EMPTY,
  CAREER_JOBS_UNAVAILABLE,
  emptyCareerFeed,
  type CareerFeed,
} from '../../../../packages/shared/src/career';
let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, selectionReady: true }),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const originalFetch = global.fetch;
function respond(feed: CareerFeed) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => feed });
}
beforeEach(() => {
  mockUser = null;
  jest.spyOn(require('../firebase'), 'getAuthInstance').mockImplementation(() => ({
    currentUser: mockUser && { ...mockUser, getIdToken: async () => 'fixture' },
  }));
  mockSchool = { id: 'pu', name: '靜宜大學' };
  respond({ ...emptyCareerFeed(), announcementsUnavailable: false, jobsUnavailable: false });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});
test('guests see real public resources and exact empty text without personal write controls', async () => {
  const view = render(<CareerScreen />);
  await view.findByText('目前沒有可確認日期的近期截止日或活動。');
  expect(view.getByText(CAREER_EMPTY)).toBeTruthy();
  expect(view.getByText('登入後可申請校內工讀與查看實習學分')).toBeTruthy();
  expect(view.queryByText('新增紀錄')).toBeNull();
  expect(view.queryByText('登入以使用個人工作區')).toBeNull();
  await act(async () =>
    fireEvent.press(view.getByRole('button', { name: '前往靜宜職涯發展暨產業促進處' })),
  );
  expect(Linking.openURL).toHaveBeenCalledWith('https://cdif.pu.edu.tw/');
  expect(fetch).toHaveBeenCalledWith('https://nuni.tw/career/data?school=pu', expect.anything());
});
test('timeline opens a calendar confirmation; government jobs retain their source and original URL', async () => {
  respond({
    ...emptyCareerFeed(),
    announcementsUnavailable: false,
    jobsUnavailable: false,
    timeline: [
      {
        title: '2026/12/8 實習申請截止',
        date: '2026-12-08',
        url: 'https://cdif.pu.edu.tw/p/406-1102-1.php',
        source: '職產處',
      },
    ],
    jobs: [
      {
        title: '開放資料職稱',
        company: '來源公司欄位',
        url: 'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1',
        source: '台灣就業通',
      },
    ],
  });
  const view = render(<CareerScreen />);
  const calendar = await view.findByRole('link', { name: /加入行事曆/ });
  await act(async () => fireEvent.press(calendar));
  expect(Linking.openURL).toHaveBeenLastCalledWith(
    expect.stringContaining('calendar.google.com/calendar/render?'),
  );
  expect(view.getByText('台灣就業通 · 來源公司欄位')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '開放資料職稱 ↗' })));
  expect(Linking.openURL).toHaveBeenLastCalledWith(
    'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1',
  );
});
test('TaiwanJobs failure keeps campus resources visible and retry recovers', async () => {
  respond(emptyCareerFeed());
  const view = render(<CareerScreen />);
  expect(await view.findByText(CAREER_JOBS_UNAVAILABLE)).toBeTruthy();
  expect(view.getByText(CAREER_EMPTY)).toBeTruthy();
  respond({ ...emptyCareerFeed(), announcementsUnavailable: false, jobsUnavailable: false });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新整理' })));
  await waitFor(() => expect(view.queryByText(CAREER_JOBS_UNAVAILABLE)).toBeNull());
});
test('switching school drops PU information and does not fetch Shalu for other campuses', async () => {
  const view = render(<CareerScreen />);
  await view.findByText('目前沒有可確認日期的近期截止日或活動。');
  (fetch as jest.Mock).mockClear();
  mockSchool = { id: 'ntu', name: '臺灣大學' };
  view.rerender(<CareerScreen />);
  expect(await view.findByText(/目前尚未接上這所學校的公告來源/)).toBeTruthy();
  expect(view.queryByRole('button', { name: '前往靜宜職涯發展暨產業促進處' })).toBeNull();
  expect(view.getByRole('button', { name: '前往臺大學生專區（職涯資訊入口）' })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
test('external jobs only link out with approved labels', async () => {
  const view = render(<CareerScreen />);
  await view.findByText('目前沒有可確認日期的近期截止日或活動。');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '到 104 找更多 ↗' })));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://www.104.com.tw/jobs/main/');
  expect(view.getByRole('button', { name: '到 Cake 找更多 ↗' })).toBeTruthy();
  expect(view.queryByText('一鍵應徵')).toBeNull();
});

test('guest announcements stay in the public stack even when career sources are unavailable', async () => {
  respond(emptyCareerFeed());
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['LoginLanding', 'Career', '公告總覽'] }),
  };
  const view = render(<CareerScreen navigation={navigation} />);
  await view.findByText(CAREER_JOBS_UNAVAILABLE);
  fireEvent.press(view.getByRole('button', { name: '查看校方公告' }));
  expect(navigation.navigate).toHaveBeenCalledWith('公告總覽', undefined);
});

test('school-session announcements cross from life to the registered Today stack', async () => {
  respond(emptyCareerFeed());
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['CampusHome', 'Career'] }),
    getParent: () => ({
      getState: () => ({ routeNames: ['Today', '學習', '校園', '訊息', '我的'] }),
    }),
  };
  const view = render(<CareerScreen navigation={navigation} />);
  await view.findByText(CAREER_JOBS_UNAVAILABLE);
  fireEvent.press(view.getByRole('button', { name: '查看校方公告' }));
  expect(navigation.navigate).toHaveBeenCalledWith('Today', {
    screen: '公告總覽',
    params: undefined,
    initial: false,
  });
});

test('authenticated official screen uses hosted callables and hides forms until a successful retry', async () => {
  mockUser = { uid: 'student' };
  let available = false;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes('/api/fn/')) return { ok: true, json: async () => emptyCareerFeed() };
    const data = JSON.parse(String(init?.body)).data;
    if (!available || data.audience === 'staff')
      return { ok: false, json: async () => ({ error: { message: '尚未啟用' } }) };
    return {
      ok: true,
      json: async () => ({
        result: {
          snapshot: url.endsWith('careerWorkstudy')
            ? {
                opportunities: [],
                applications: [],
                events: [],
                audit: [],
                sources: null,
                canReview: false,
                canOperate: false,
              }
            : { rules: [], records: [], audit: [] },
        },
      }),
    };
  }) as unknown as typeof fetch;
  const view = render(<CareerScreen />);
  await waitFor(() => expect(view.getAllByText('尚未啟用').length).toBe(2));
  expect(view.queryByText('新增機會')).toBeNull();
  expect(view.queryByText('新增系所規則')).toBeNull();
  expect(view.queryByText('系所尚未設定實習學分規則，請洽系辦確認。')).toBeNull();
  available = true;
  await act(async () => fireEvent.press(view.getByText('重新整理實習進度')));
  expect(await view.findByText('系所尚未設定實習學分規則，請洽系辦確認。')).toBeTruthy();
  const calls = (fetch as jest.Mock).mock.calls.filter(([url]) => url.includes('/api/fn/'));
  expect(
    calls.every(
      ([url, init]) =>
        url.startsWith('https://nuni.tw/api/fn/') &&
        init.headers.Authorization === 'Bearer fixture',
    ),
  ).toBe(true);
});
