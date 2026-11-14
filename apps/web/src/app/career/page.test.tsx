import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CAREER_EMPTY,
  CAREER_JOBS_UNAVAILABLE,
  emptyCareerFeed,
  type CareerFeed,
} from '@campus/shared/src/career';
import CareerPage from './page';
const campus = vi.hoisted(() => ({ schoolId: 'pu' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/career',
  useSearchParams: () => new URLSearchParams(`schoolId=${campus.schoolId}&campus=${campus.schoolId}&token=private`),
}));
vi.mock('@/components/SiteShell', async () => {
  const { ServiceBreadcrumbs } = await import('@/components/ServiceBreadcrumbs');
  return {
    SiteShell: ({ children, title }: { children: ReactNode; title?: string }) => (
      <main>
        <ServiceBreadcrumbs title={title} />
        {title && <h1>{title}</h1>}
        {children}
      </main>
    ),
  };
});
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
  campus.schoolId = 'pu';
  respond({ ...emptyCareerFeed(), announcementsUnavailable: false, jobsUnavailable: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('uses one page title and one campus-preserving route back to life', async () => {
  render(<CareerPage />);
  await screen.findByText('目前沒有可確認日期的近期截止日或活動。');
  expect(screen.getAllByRole('heading', { name: '職涯', level: 1 })).toHaveLength(1);
  const links = screen.getAllByRole('link', { name: '生活' });
  expect(links).toHaveLength(1);
  const target = new URL(links[0].getAttribute('href')!, 'https://nuni.tw');
  expect(target.pathname).toBe('/life');
  expect([...target.searchParams.entries()]).toEqual([
    ['schoolId', 'pu'],
    ['campus', 'pu'],
  ]);
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
