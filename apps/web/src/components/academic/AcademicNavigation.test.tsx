import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SiteShell } from '@/components/SiteShell';

const navigation = vi.hoisted(() => ({
  pathname: '/grades' as string | null,
  search: 'schoolId=pu&campus=pu',
  schoolId: 'pu' as string | null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: navigation.schoolId ? { id: navigation.schoolId } : null,
    loading: false,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/SiteFooter', () => ({ SiteFooter: () => null }));

beforeEach(() => {
  navigation.pathname = '/grades';
  navigation.search = 'schoolId=pu&campus=pu';
  navigation.schoolId = 'pu';
});

function renderShell() {
  return render(
    <SiteShell title="目前頁面">
      <p>此頁內容</p>
    </SiteShell>,
  );
}

function destination(label: string) {
  const nav = screen.getByRole('navigation', { name: '課務導覽' });
  return new URL(
    within(nav).getByRole('link', { name: label }).getAttribute('href')!,
    'https://campus.local',
  );
}

it.each([
  ['/timetable', '課表', 'timetable'],
  ['/classroom', '課程空間', 'timetable'],
  ['/grades', '成績', 'grades'],
  ['/credit-planner', '學分規劃', 'grades'],
  ['/credit-planner/review', '學分規劃', 'grades'],
  ['/calendar', '行事曆', 'events'],
  ['/import', '匯入資料', 'timetable'],
])(
  'adds one shared academic navigation on %s with the current page identified',
  (pathname, label, kind) => {
    navigation.pathname = pathname;
    renderShell();
    const nav = screen.getByRole('navigation', { name: '課務導覽' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      '課表',
      '課程空間',
      '成績',
      '學分規劃',
      '行事曆',
      '匯入資料',
    ]);
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toEqual([
      within(nav).getByRole('link', { name: label }),
    ]);
    expect(destination('匯入資料').searchParams.get('kind')).toBe(kind);
    expect(destination('課程空間').pathname).toBe('/classroom');
    expect(screen.getByText('此頁內容')).toBeTruthy();
  },
);

it('uses the current campus selection and passes only destination-specific context', () => {
  navigation.schoolId = 'nthu';
  navigation.search =
    'school=PU&schoolId=pu&campus=pu&term=115%7C2&tab=feedback&token=private&year=115&semester=2';
  renderShell();
  const nav = screen.getByRole('navigation', { name: '課務導覽' });
  for (const link of within(nav).getAllByRole('link')) {
    const url = new URL(link.getAttribute('href')!, 'https://campus.local');
    expect(url.searchParams.get('schoolId')).toBe('nthu');
    expect(url.searchParams.get('campus')).toBe('nthu');
    expect(url.searchParams.get('school')).toBe('NTHU');
    expect(url.searchParams.has('token')).toBe(false);
    expect(url.searchParams.has('tab')).toBe(false);
    expect(url.searchParams.has('year')).toBe(false);
    expect(url.searchParams.has('semester')).toBe(false);
    expect(url.searchParams.get('term')).toBe(url.pathname === '/timetable' ? '115|2' : null);
  }
  expect(destination('匯入資料').searchParams.get('kind')).toBe('grades');
});

it('retains the requested import kind and respects all-campuses selection', () => {
  navigation.pathname = '/import';
  navigation.schoolId = null;
  navigation.search = 'kind=events&schoolId=pu&campus=pu';
  renderShell();
  expect(destination('匯入資料').searchParams.get('kind')).toBe('events');
  expect(destination('匯入資料').searchParams.get('campus')).toBe('all');
  expect(destination('課表').searchParams.has('schoolId')).toBe(false);
});

it.each(['115|2', '2026|暑修', 'manual'])('retains the established timetable term %s', (term) => {
  navigation.search = new URLSearchParams({ term }).toString();
  renderShell();
  expect(destination('課表').searchParams.get('term')).toBe(term);
});

it.each(['invalid', '115|', '115|1|2'])('does not forward an invalid timetable term %s', (term) => {
  navigation.search = new URLSearchParams({ term }).toString();
  renderShell();
  expect(destination('課表').searchParams.has('term')).toBe(false);
});

it.each([
  '/admin',
  '/teacher',
  '/school-courses',
  '/school-lms',
  '/school-lms/homework/10001/20001',
  '/classroom/grades',
  '/timetable/s/shared',
  '/grades-other',
  '/life',
  null,
])('does not add academic navigation on %s', (pathname) => {
  navigation.pathname = pathname;
  renderShell();
  expect(screen.queryByRole('navigation', { name: '課務導覽' })).toBeNull();
  expect(screen.getByText('此頁內容')).toBeTruthy();
});
