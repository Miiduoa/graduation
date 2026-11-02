import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import CalendarPage from './page';

const context = vi.hoisted(() => ({
  search: 'schoolId=pu&campus=pu',
  schoolId: 'pu' as string | null,
  ready: true,
  error: '',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(context.search),
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: context.schoolId ? { id: context.schoolId } : null,
    loading: false,
    catalogStatus: 'ready',
  }),
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title, subtitle }: {
    children: ReactNode;
    title?: string;
    subtitle?: string;
  }) => <main><h1>{title}</h1><p>{subtitle}</p>{children}</main>,
}));

vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: 'guest', schoolId: 'pu' },
    scopeKey: 'guest:pu',
    loading: false,
    schoolName: '靜宜大學',
  }),
  usePersonalImports: () => ({
    records: [],
    ready: context.ready,
    error: context.error,
    loading: false,
    syncEnabled: false,
  }),
}));

beforeEach(() => {
  context.search = 'schoolId=pu&campus=pu';
  context.schoolId = 'pu';
  context.ready = true;
  context.error = '';
});

function navigationLinks() {
  return within(screen.getByRole('navigation', { name: '行事曆與課表' }));
}

it('分清公開活動、個人行程與課表，並標出目前頁面', () => {
  render(<CalendarPage />);
  expect(screen.getByRole('heading', { name: '個人行事曆', level: 1 })).toBeTruthy();
  expect(screen.getByText('手動新增或匯入的活動與考試。上課時間請到「我的課表」查看。')).toBeTruthy();
  const links = navigationLinks().getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    '校園活動公開活動與講座另開分頁',
    '我的課表每週上課時間與教室另開分頁',
  ]);
  const current = navigationLinks().getByText('個人行程').parentElement!;
  expect(current.getAttribute('aria-current')).toBe('page');
  expect(current.textContent).toBe('個人行程自己新增或匯入的活動與考試');
  expect(navigationLinks().queryByRole('link', { name: /個人行程/ })).toBeNull();
  expect(links.map((link) => new URL(link.getAttribute('href')!, 'https://campus.local').pathname))
    .toEqual(['/events', '/timetable']);
  for (const link of links) {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
});

it('沿用目前所選校園，跳轉時不帶其他頁面的篩選條件', () => {
  context.schoolId = 'nthu';
  context.search = 'schoolId=pu&campus=pu&tab=month&date=2026-10-20';
  render(<CalendarPage />);
  for (const link of navigationLinks().getAllByRole('link')) {
    const destination = new URL(link.getAttribute('href')!, 'https://campus.local');
    expect(destination.searchParams.get('schoolId')).toBe('nthu');
    expect(destination.searchParams.get('campus')).toBe('nthu');
    expect(destination.searchParams.has('tab')).toBe(false);
    expect(destination.searchParams.has('date')).toBe(false);
  }
});

it('尚未選校時不把舊網址的學校帶入其他入口', () => {
  context.schoolId = null;
  render(<CalendarPage />);
  for (const link of navigationLinks().getAllByRole('link')) {
    const destination = new URL(link.getAttribute('href')!, 'https://campus.local');
    expect(destination.searchParams.get('campus')).toBe('all');
    expect(destination.searchParams.has('schoolId')).toBe(false);
  }
});

it('沒有個人行程時仍可新增或前往其他資料頁', () => {
  render(<CalendarPage />);
  expect(screen.getByText(/這個月還沒有行程/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '新增行程' }) as HTMLButtonElement).disabled).toBe(false);
  expect(navigationLinks().getAllByRole('link')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '新增行程' }));
  expect(screen.getByRole('region', { name: '新增行程' })).toBeTruthy();
});

it('個人紀錄讀取失敗時仍保留其他入口與資料範圍說明', () => {
  context.ready = false;
  context.error = '無法讀取個人紀錄。';
  render(<CalendarPage />);
  expect(screen.getByRole('alert').textContent).toContain('無法讀取個人紀錄');
  expect(navigationLinks().getByRole('link', { name: /校園活動/ })).toBeTruthy();
  expect(navigationLinks().getByRole('link', { name: /我的課表/ })).toBeTruthy();
  expect(navigationLinks().getByText('個人行程').parentElement!.getAttribute('aria-current'))
    .toBe('page');
});

it('前往另開分頁的資料入口，原頁保留月份、檢視與日期選擇', () => {
  const view = render(<CalendarPage />);
  fireEvent.change(screen.getByLabelText('查看月份'), { target: { value: '2026-10' } });
  fireEvent.click(screen.getByRole('button', { name: '列表' }));
  fireEvent.click(navigationLinks().getByRole('link', { name: /校園活動.*另開分頁/ }));
  view.rerender(<CalendarPage />);
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-10');
  expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '月格' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-10-20' }));
  fireEvent.click(navigationLinks().getByRole('link', { name: /我的課表.*另開分頁/ }));
  view.rerender(<CalendarPage />);
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-10');
  expect(screen.getByRole('button', { name: '月格' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '2026-10-20' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('2026-10-20 的行程')).toBeTruthy();
  expect(navigationLinks().getByText('個人行程').parentElement!.getAttribute('aria-current'))
    .toBe('page');
});
