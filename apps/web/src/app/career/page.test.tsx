import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CAREER_EMPTY,
  CAREER_JOBS_UNAVAILABLE,
  emptyCareerFeed,
  type CareerFeed,
} from '@campus/shared/src/career';
import CareerPage from './page';
import { opportunity } from '@campus/shared/testFixtures/careerWorkstudy';
const identity = vi.hoisted(() => ({ user: null as { uid: string } | null }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => identity }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({
    currentUser: identity.user && { ...identity.user, getIdToken: async () => 'fixture' },
  }),
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
}));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: async () => ({ courses: [] }) }));
const campus = vi.hoisted(() => ({ schoolId: 'pu' }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready',
    schoolId: campus.schoolId,
    schoolName: '目前學校',
  }),
}));
function respond(feed: CareerFeed) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => feed }));
}
beforeEach(() => {
  identity.user = null;
  campus.schoolId = 'pu';
  respond({ ...emptyCareerFeed(), announcementsUnavailable: false, jobsUnavailable: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('opens the public career page with locked empty copy and official link without requiring login', async () => {
  render(<CareerPage />);
  expect(await screen.findByText('目前沒有可確認日期的近期截止日或活動。')).toBeTruthy();
  expect(screen.getByText(CAREER_EMPTY)).toBeTruthy();
  expect(screen.getByRole('link', { name: /靜宜職涯/ }).getAttribute('href')).toBe(
    'https://cdif.pu.edu.tw/',
  );
  expect(screen.queryByText(/登入以使用/)).toBeNull();
  expect(screen.queryByText(/新增紀錄/)).toBeNull();
  expect(screen.getByRole('link', { name: '到 104 找更多 ↗' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '到 Cake 找更多 ↗' })).toBeTruthy();
});
it('renders sourced announcements and calendar confirmation links, not publication dates as deadlines', async () => {
  respond({
    ...emptyCareerFeed(),
    announcementsUnavailable: false,
    jobsUnavailable: false,
    announcements: [
      {
        title: '實習公告',
        date: '2026-11-12',
        source: '職產處',
        url: 'https://cdif.pu.edu.tw/p/406-1102-1.php',
      },
    ],
    timeline: [
      {
        title: '2026/12/8 實習申請截止',
        date: '2026-12-08',
        source: '職產處',
        url: 'https://cdif.pu.edu.tw/p/406-1102-2.php',
      },
    ],
  });
  render(<CareerPage />);
  expect(await screen.findByText('實習公告 ↗')).toBeTruthy();
  const calendar = screen.getByRole('link', { name: /加入行事曆/ });
  expect(new URL(calendar.getAttribute('href')!).searchParams.get('dates')).toBe(
    '20261208/20261209',
  );
  expect(screen.getByText('職產處 · 2026-11-12')).toBeTruthy();
});
it('keeps campus sections visible when TaiwanJobs fails and allows retry', async () => {
  render(<CareerPage />);
  await screen.findByText('目前沒有可確認日期的近期截止日或活動。');
  respond(emptyCareerFeed());
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  expect(await screen.findByText(CAREER_JOBS_UNAVAILABLE)).toBeTruthy();
  expect(screen.getByText(CAREER_EMPTY)).toBeTruthy();
  expect(screen.getByRole('heading', { name: '校方職涯公告' })).toBeTruthy();
});
it('labels TaiwanJobs records and links directly to the original job page', async () => {
  respond({
    ...emptyCareerFeed(),
    jobsUnavailable: false,
    jobs: [
      {
        title: '開放資料職缺',
        company: '來源公司欄位',
        source: '台灣就業通',
        url: 'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1',
      },
    ],
  });
  render(<CareerPage />);
  expect(
    (await screen.findByRole('link', { name: '開放資料職缺 ↗' })).getAttribute('href'),
  ).toContain('job.taiwanjobs.gov.tw');
  expect(screen.getByText('台灣就業通 · 來源公司欄位')).toBeTruthy();
});
it('does not display PU feeds or Shalu jobs for other schools', async () => {
  campus.schoolId = 'ntu';
  render(<CareerPage />);
  expect(await screen.findByText(/目前尚未接上這所學校的公告來源/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /靜宜職涯/ })).toBeNull();
  expect(screen.getByRole('link', { name: /臺大學生專區/ })).toBeTruthy();
});
it('handles a failed feed without replacing the official school link', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
  render(<CareerPage />);
  expect(await screen.findByText(CAREER_JOBS_UNAVAILABLE)).toBeTruthy();
  expect(screen.getByRole('link', { name: /靜宜職涯/ })).toBeTruthy();
});

it('mounts authenticated callable hosts, keeping forms hidden while unavailable and until retry succeeds', async () => {
  identity.user = { uid: 'student' };
  let available = false;
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/fn/')) return { ok: true, json: async () => emptyCareerFeed() };
    const data = JSON.parse(String(init?.body)).data;
    if (!available || data.audience === 'staff')
      return { ok: false, json: async () => ({ error: { message: '尚未啟用' } }) };
    return {
      ok: true,
      json: async () => ({
        result: {
          snapshot: url.endsWith('careerWorkstudy')
            ? {
                opportunities: [opportunity],
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
  });
  vi.stubGlobal('fetch', calls);
  render(<CareerPage />);
  expect(screen.getByText('我的實習')).toBeTruthy();
  expect(screen.queryByText('新增系所規則')).toBeNull();
  expect(screen.queryByText('申請名單')).toBeNull();
  expect((await screen.findAllByText('尚未啟用')).length).toBe(2);
  expect(screen.queryByRole('button', { name: `應徵${opportunity.title}` })).toBeNull();
  available = true;
  await act(async () => {
    fireEvent.click(screen.getByText('重新整理實習進度'));
    fireEvent.click(screen.getByText('重新整理工讀資料'));
  });
  expect(await screen.findByRole('button', { name: `應徵${opportunity.title}` })).toBeTruthy();
  expect(screen.getByText('系所尚未設定實習學分規則，請洽系辦確認。')).toBeTruthy();
  expect(
    calls.mock.calls
      .filter(([url]) => url.startsWith('/api/fn/'))
      .every(
        ([, init]) => (init?.headers as Record<string, string>).Authorization === 'Bearer fixture',
      ),
  ).toBe(true);
});

it('shows independent internship department review while workstudy staff and ops stay hidden', async () => {
  identity.user = { uid: 'reviewer' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/fn/')
          ? {
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
                  : { rules: [], records: [], audit: [], canManage: true },
              },
            }
          : emptyCareerFeed(),
    })),
  );
  render(<CareerPage />);
  expect(await screen.findByText('新增系所規則')).toBeTruthy();
  expect(screen.getByText('實習紀錄確認')).toBeTruthy();
  expect(screen.queryByText('新增機會')).toBeNull();
  expect(screen.queryByText('職涯來源與操作紀錄')).toBeNull();
});
it('mounts the granted workstudy staff and ops workbenches after the student snapshot', async () => {
  identity.user = { uid: 'admin' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/fn/')
          ? {
              result: {
                snapshot: url.endsWith('careerWorkstudy')
                  ? {
                      opportunities: [],
                      applications: [],
                      events: [],
                      audit: [],
                      sources: null,
                      canReview: true,
                      canOperate: true,
                    }
                  : { rules: [], records: [], audit: [], canManage: true },
              },
            }
          : emptyCareerFeed(),
    })),
  );
  render(<CareerPage />);
  expect(await screen.findByText('新增機會')).toBeTruthy();
  expect(await screen.findByText('職涯來源與操作紀錄')).toBeTruthy();
  expect(await screen.findByText('實習規則與操作紀錄')).toBeTruthy();
});
