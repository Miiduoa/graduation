import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteShell } from '@/components/SiteShell';
import { ACADEMIC_LMS_SECTIONS, ACADEMIC_SECTIONS } from '@/lib/academicSections';

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

function renderShell(enabled = true) {
  return render(
    <SchoolLmsReadonlyProvider enabled={enabled}>
      <SiteShell title="目前頁面">
        <p>此頁內容</p>
      </SiteShell>
    </SchoolLmsReadonlyProvider>,
  );
}

function destination(label: string) {
  const nav = screen.getByRole('navigation', { name: '課務導覽' });
  return new URL(
    within(nav).getByRole('link', { name: label }).getAttribute('href')!,
    'https://campus.local',
  );
}

const enabledLabels = [
  ...ACADEMIC_SECTIONS.map((section) => section.label),
  ...ACADEMIC_LMS_SECTIONS.map((section) => section.label),
  '匯入資料',
];

const defaultLabels = [
  ...ACADEMIC_SECTIONS.map((section) => section.label),
  ACADEMIC_LMS_SECTIONS[0].label,
  '匯入資料',
];

it.each([
  ['/timetable', '課表', 'timetable'],
  ['/classroom', '課程與作業', 'timetable'],
  ['/classroom/course/cs101', '課程與作業', 'timetable'],
  ['/school-courses', '校方課程', 'timetable'],
  ['/school-lms', '校方作業與教材', 'timetable'],
  ['/school-lms/homework/10001/20001', '校方作業與教材', 'timetable'],
  ['/grades', '成績', 'grades'],
  ['/credit-planner', '學分規劃', 'grades'],
  ['/credit-planner/review', '學分規劃', 'grades'],
  ['/calendar', '行事曆', 'events'],
  ['/import', '匯入資料', 'timetable'],
])(
  'adds one shared academic navigation on %s with the current page identified',
  (pathname, label, kind) => {
    navigation.pathname = pathname;
    renderShell(true);
    const nav = screen.getByRole('navigation', { name: '課務導覽' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(enabledLabels);
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toEqual([
      within(nav).getByRole('link', { name: label }),
    ]);
    expect(destination('匯入資料').searchParams.get('kind')).toBe(kind);
    expect(screen.getByText('此頁內容')).toBeTruthy();
  },
);

it('uses the current campus selection and passes only destination-specific context', () => {
  navigation.schoolId = 'nthu';
  navigation.search =
    'school=PU&schoolId=pu&campus=pu&term=115%7C2&tab=feedback&token=private&year=115&semester=2';
  renderShell(true);
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
  renderShell(true);
  expect(destination('匯入資料').searchParams.get('kind')).toBe('events');
  expect(destination('匯入資料').searchParams.get('campus')).toBe('all');
  expect(destination('課表').searchParams.has('schoolId')).toBe(false);
});

it.each(['115|2', '2026|暑修', 'manual'])('retains the established timetable term %s', (term) => {
  navigation.search = new URLSearchParams({ term }).toString();
  renderShell(true);
  expect(destination('課表').searchParams.get('term')).toBe(term);
});

it.each(['invalid', '115|', '115|1|2'])('does not forward an invalid timetable term %s', (term) => {
  navigation.search = new URLSearchParams({ term }).toString();
  renderShell(true);
  expect(destination('課表').searchParams.has('term')).toBe(false);
});

it.each([
  '/admin',
  '/teacher',
  '/classroom/grades',
  '/classroom/account',
  '/timetable/s/shared',
  '/grades-other',
  '/life',
  null,
])('does not add academic navigation on %s', (pathname) => {
  navigation.pathname = pathname;
  renderShell(true);
  expect(screen.queryByRole('navigation', { name: '課務導覽' })).toBeNull();
  expect(screen.getByText('此頁內容')).toBeTruthy();
});

it('hides readonly homework navigation by default and keeps shared labels', () => {
  renderShell(false);
  expect(screen.queryByRole('link', { name: '校方作業與教材' })).toBeNull();
  expect(screen.queryByRole('link', { name: '作業與教材' })).toBeNull();
  const nav = screen.getByRole('navigation', { name: '課務導覽' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(defaultLabels);
  expect(destination('課表').pathname).toBe('/timetable');
  expect(destination('課程與作業').pathname).toBe('/classroom');
  expect(destination('校方課程').pathname).toBe('/school-courses');
});

describe('academic strip visibility', () => {
  let width: number;
  let textScale: number;
  const observers: Array<{
    update: () => void;
    observed: Element[];
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const linkWidths = [60, 110, 60, 96, 82, 96, 138];

  function bounds(left: number, width: number): DOMRect {
    return {
      x: left,
      y: 80,
      left,
      top: 80,
      width,
      height: 44,
      right: left + width,
      bottom: 124,
      toJSON: () => ({}),
    };
  }

  function strip() {
    return within(screen.getByRole('navigation', { name: '課務導覽' })).getByRole('list');
  }

  function expectVisible(link: HTMLElement) {
    const viewport = strip().getBoundingClientRect();
    const target = link.getBoundingClientRect();
    expect(target.left).toBeGreaterThanOrEqual(viewport.left);
    expect(target.right).toBeLessThanOrEqual(viewport.right);
  }

  beforeEach(() => {
    width = 278;
    textScale = 1;
    observers.length = 0;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'UL' ? width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'UL'
        ? linkWidths.reduce((total, item) => total + item * textScale + 2, 12)
        : 0;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.tagName === 'UL') return bounds(20, width);
      const list = this.closest('ul');
      if (this.tagName === 'A' && list) {
        const index = [...list.querySelectorAll('a')].indexOf(this as HTMLAnchorElement);
        const start = linkWidths
          .slice(0, index)
          .reduce((total, item) => total + item * textScale + 2, 6);
        return bounds(20 + start - list.scrollLeft, linkWidths[index] * textScale);
      }
      return bounds(0, 0);
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observed: Element[] = [];
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          observers.push({
            update: () => callback([], this as unknown as ResizeObserver),
            observed: this.observed,
            disconnect: this.disconnect,
          });
        }
        observe(element: Element) {
          this.observed.push(element);
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reveals a directly opened final section without moving page scroll or focus', () => {
    navigation.pathname = '/school-lms';
    const reading = document.createElement('button');
    reading.textContent = '目前閱讀位置';
    document.body.append(reading);
    reading.focus();
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderShell();
    expect(strip().scrollLeft).toBeGreaterThan(0);
    expectVisible(screen.getByRole('link', { name: '校方作業與教材' }));
    expect(document.activeElement).toBe(reading);
    expect(pageScroll).not.toHaveBeenCalled();
    reading.remove();
  });

  it('keeps an already visible current section still', () => {
    navigation.pathname = '/timetable';
    renderShell();
    expect(strip().scrollLeft).toBe(0);
    expectVisible(screen.getByRole('link', { name: '課表' }));
    act(() => observers[0].update());
    expect(strip().scrollLeft).toBe(0);
  });

  it('reveals keyboard-focused links and preserves them when the strip resizes', () => {
    navigation.pathname = '/school-lms';
    renderShell();
    const link = screen.getByRole('link', { name: '學分規劃' });
    act(() => link.focus());
    expectVisible(link);
    width = 180;
    act(() => observers[0].update());
    expectVisible(link);
    expect(document.activeElement).toBe(link);
  });

  it('rechecks the current section after text grows and disconnects on unmount', () => {
    navigation.pathname = '/calendar';
    const view = renderShell();
    const observer = observers[0];
    expect(observer.observed).toContain(strip());
    expect(observer.observed.filter((element) => element.tagName === 'A')).toHaveLength(7);
    textScale = 2;
    act(() => observer.update());
    expectVisible(screen.getByRole('link', { name: '行事曆' }));
    view.unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('uses a local resize fallback when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    navigation.pathname = '/grades';
    renderShell();
    width = 180;
    fireEvent(window, new Event('resize'));
    expectVisible(screen.getByRole('link', { name: '成績' }));
  });
});
