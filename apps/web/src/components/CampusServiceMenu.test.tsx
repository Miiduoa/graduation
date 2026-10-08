import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampusServiceMenu } from './CampusServiceMenu';
import { AppHeader } from './AppHeader';

const navigation = vi.hoisted(() => ({ pathname: '/map', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: null, signOutUser: vi.fn() }),
}));

const originalServices = [
  ['/announcements', '公告'],
  ['/timetable', '課表'],
  ['/grades', '成績'],
  ['/credit-planner', '學分規劃'],
  ['/groups', '課程與群組'],
  ['/clubs', '社團活動'],
  ['/community', '校園交流'],
  ['/messages', '通知'],
  ['/dms', '私訊'],
  ['/map', '校園地圖'],
  ['/bus', '公車'],
  ['/cafeteria', '餐廳'],
  ['/library', '圖書館'],
  ['/ai-assistant', '校園助理'],
  ['/profile', '個人資料'],
  ['/settings', '設定'],
];

beforeEach(() => {
  navigation.pathname = '/map';
  navigation.search = '';
});

it('retains all existing services and search while adding a separate classroom entry', () => {
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [href, label] of originalServices) {
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
  }
  expect(screen.getByRole('link', { name: /尋找校園服務/ }).getAttribute('href')).toBe('/search');
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getAllByRole('link')).toHaveLength(18);
});

it('preserves school context without copying unrelated session or return parameters', () => {
  navigation.search = 'school=pu&schoolId=tw-pu&returnUrl=%2Fsettings&session=other';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const link of screen.getAllByRole('link')) {
    const target = new URL(link.getAttribute('href')!, 'https://campus.example');
    expect([...target.searchParams.entries()]).toEqual([
      ['school', 'pu'],
      ['schoolId', 'tw-pu'],
    ]);
  }
});

it('marks classroom children as part of the added service without selecting existing groups', () => {
  navigation.pathname = '/classroom/course/cw_11111111-1111-4111-8111-111111111111';
  render(<CampusServiceMenu />);
  fireEvent.click(screen.getByText('所有服務'));
  expect(screen.getByRole('link', { name: '課程空間' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '課程與群組' }).getAttribute('aria-current')).toBeNull();
});

it('keeps the Campus One header and original school login around the complete shared menu', () => {
  navigation.search = 'schoolId=tw-pu';
  render(<AppHeader />);
  fireEvent.click(screen.getByText('所有服務'));
  for (const [, label] of originalServices)
    expect(screen.getByRole('link', { name: label })).toBeTruthy();
  expect(screen.getByRole('link', { name: '課程空間' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmap%3FschoolId%3Dtw-pu',
  );
  expect(screen.getByRole('link', { name: '今日' }).getAttribute('href')).toBe('/?schoolId=tw-pu');
});

it('closes on Escape and returns keyboard focus to the service control', () => {
  render(<CampusServiceMenu />);
  const summary = screen.getByText('所有服務');
  const menu = summary.closest('details')!;
  menu.open = true;
  const link = screen.getByRole('link', { name: '課表' });
  link.focus();
  fireEvent.keyDown(link, { key: 'Escape' });
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('closes on outside interaction without dismissing interactions within the menu', () => {
  render(<CampusServiceMenu />);
  const menu = screen.getByText('所有服務').closest('details')!;
  menu.open = true;
  fireEvent.pointerDown(screen.getByRole('heading', { name: '學習與課務' }));
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(menu.open).toBe(false);
});

it('closes after choosing the current service and when keyboard focus leaves', () => {
  render(
    <>
      <CampusServiceMenu />
      <button type="button">下一個控制項</button>
    </>,
  );
  const menu = screen.getByText('所有服務').closest('details')!;
  menu.open = true;
  fireEvent.click(screen.getByRole('link', { name: '校園地圖' }));
  expect(menu.open).toBe(false);
  menu.open = true;
  fireEvent.blur(menu, { relatedTarget: screen.getByRole('button') });
  expect(menu.open).toBe(false);
});

it('identifies a nested service without selecting a route with only a matching prefix', () => {
  navigation.pathname = '/announcements/a1';
  const { rerender } = render(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '公告' }).getAttribute('aria-current')).toBe('page');
  navigation.pathname = '/announcements-old';
  rerender(<CampusServiceMenu />);
  screen.getByText('所有服務').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '公告' }).getAttribute('aria-current')).toBeNull();
});
