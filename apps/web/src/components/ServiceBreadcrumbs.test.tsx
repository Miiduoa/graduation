import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceBreadcrumbs } from './ServiceBreadcrumbs';

const navigation = vi.hoisted(() => ({ pathname: '/food', search: 'campus=nthu&session=old' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  navigation.pathname = '/food';
  navigation.search = 'campus=nthu&session=old';
});

it('offers a direct return to life from a service while preserving only campus context', () => {
  render(<ServiceBreadcrumbs title="點餐與取餐" />);
  const nav = screen.getByRole('navigation', { name: '目前位置' });
  expect(within(nav).getByRole('link', { name: '探索' }).getAttribute('href')).toBe(
    '/explore?campus=nthu',
  );
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('點餐與取餐');
  expect(within(nav).getAllByRole('link')).toHaveLength(1);
});

it('returns a restaurant detail to the food journey without forcing browser history', () => {
  navigation.pathname = '/cafeteria/restaurant-1';
  render(<ServiceBreadcrumbs title="校園餐廳" />);
  expect(screen.getByRole('link', { name: '點餐與取餐' }).getAttribute('href')).toBe(
    '/food?campus=nthu',
  );
  expect(screen.getByText('校園餐廳').getAttribute('aria-current')).toBe('page');
});

it.each(['/social', '/community/post/topic-1', '/dms/chat-1', '/messages'])(
  'keeps %s inside exchange',
  (pathname) => {
    navigation.pathname = pathname;
    render(<ServiceBreadcrumbs title="目前內容" />);
    expect(screen.getByRole('link', { name: '交流' }).getAttribute('href')).toBe(
      '/connect?campus=nthu',
    );
    expect(screen.queryByRole('link', { name: '探索' })).toBeNull();
  },
);

it.each(['/', '/explore', '/connect', '/profile', '/timetable', '/login', '/unknown'])(
  'does not repeat the main navigation on %s',
  (pathname) => {
    navigation.pathname = pathname;
    render(<ServiceBreadcrumbs title="入口" />);
    expect(screen.queryByRole('navigation')).toBeNull();
  },
);

it('returns a personal document to the account center', () => {
  navigation.pathname = '/student-card';
  render(<ServiceBreadcrumbs title="數位學生證" />);
  expect(screen.getByRole('link', { name: '我的' }).getAttribute('href')).toBe(
    '/profile?campus=nthu',
  );
});

it('keeps career in campus life and returns with the selected school', () => {
  navigation.pathname = '/career';
  navigation.search = 'schoolId=pu&campus=pu&session=private';
  render(<ServiceBreadcrumbs title="職涯" />);
  const nav = screen.getByRole('navigation', { name: '目前位置' });
  expect(within(nav).getByRole('link', { name: '探索' }).getAttribute('href')).toBe(
    '/explore?schoolId=pu&campus=pu',
  );
  expect(within(nav).getAllByRole('link')).toHaveLength(1);
  expect(within(nav).getByText('職涯').getAttribute('aria-current')).toBe('page');
});

it.each(['/groups/club-1/club', '/groups/club-1/club/overview', '/groups/club-1/club/members'])(
  'returns the club route %s to life and the club directory with the browsing campus',
  (pathname) => {
    navigation.pathname = pathname;
    navigation.search = 'schoolId=pu&campus=pu&school=PU&session=private';
    render(<ServiceBreadcrumbs title="攝影社" />);
    const nav = screen.getByRole('navigation', { name: '目前位置' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['探索', '社團活動']);
    expect(within(nav).getByRole('link', { name: '探索' }).getAttribute('href')).toBe(
      '/explore?school=PU&schoolId=pu&campus=pu',
    );
    expect(within(nav).getByRole('link', { name: '社團活動' }).getAttribute('href')).toBe(
      '/clubs?school=PU&schoolId=pu&campus=pu',
    );
    expect(within(nav).queryByRole('link', { name: '課務' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: '課程與作業' })).toBeNull();
    expect(within(nav).getByText('攝影社').getAttribute('aria-current')).toBe('page');
  },
);

it('keeps ordinary group pages inside the coursework journey and returns to school groups', () => {
  navigation.pathname = '/groups/group-1';
  render(<ServiceBreadcrumbs title="讀書群" />);
  expect(screen.getByRole('link', { name: '課務' }).getAttribute('href')).toBe(
    '/timetable?campus=nthu',
  );
  expect(screen.getByRole('link', { name: '課程與群組' }).getAttribute('href')).toBe(
    '/groups?campus=nthu',
  );
  expect(screen.queryByRole('link', { name: '課程與作業' })).toBeNull();
  expect(screen.queryByRole('link', { name: '社團活動' })).toBeNull();
});

it('keeps a teaching workspace in coursework without directing it to Google courses or appeals', () => {
  navigation.pathname = '/teacher/course/cs101';
  navigation.search = 'schoolId=pu&campus=pu&session=private';
  render(<ServiceBreadcrumbs title="資料庫系統" />);
  const nav = screen.getByRole('navigation', { name: '目前位置' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['課務']);
  expect(within(nav).getByRole('link', { name: '課務' }).getAttribute('href')).toBe(
    '/timetable?schoolId=pu&campus=pu',
  );
  expect(within(nav).queryByRole('link', { name: '課程與作業' })).toBeNull();
  expect(within(nav).queryByRole('link', { name: '課務申訴審核' })).toBeNull();
});

it.each(['attendance', 'gradebook', 'quizzes'])(
  'returns the teaching %s tool to the same course workspace and campus',
  (tool) => {
    navigation.pathname = `/teacher/course/course%20one/${tool}`;
    navigation.search = 'schoolId=pu&campus=pu&session=private';
    render(<ServiceBreadcrumbs title="課堂工具" />);
    expect(screen.getByRole('link', { name: '課程工作台' }).getAttribute('href')).toBe(
      '/teacher/course/course%20one?schoolId=pu&campus=pu',
    );
    expect(screen.queryByRole('link', { name: '課務申訴審核' })).toBeNull();
    expect(screen.queryByRole('link', { name: '課程與作業' })).toBeNull();
  },
);

it('returns a school course detail to that course and preserves its campus', () => {
  navigation.pathname = '/course/course%20one/attendance';
  navigation.search = 'schoolId=pu&campus=pu&session=private';
  render(<ServiceBreadcrumbs title="課程出席" />);
  expect(screen.getByRole('link', { name: '課程內容' }).getAttribute('href')).toBe(
    '/course/course%20one?schoolId=pu&campus=pu',
  );
  expect(screen.queryByRole('link', { name: '課程與作業' })).toBeNull();
});

it.each(['/groups', '/course/course%20one'])(
  'does not send a school workspace root %s through Google Classroom',
  (pathname) => {
    navigation.pathname = pathname;
    render(<ServiceBreadcrumbs title="學校工作" />);
    const nav = screen.getByRole('navigation', { name: '目前位置' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['課務']);
    expect(within(nav).queryByRole('link', { name: '課程與作業' })).toBeNull();
  },
);

it('keeps the real Google course return inside Google Classroom', () => {
  navigation.pathname = '/classroom/course/google-course';
  navigation.search = 'campus=nthu&session=private';
  render(<ServiceBreadcrumbs title="Google 課程" />);
  expect(screen.getByRole('link', { name: '課程與作業' }).getAttribute('href')).toBe(
    '/classroom?campus=nthu',
  );
  expect(screen.queryByRole('link', { name: '課程與群組' })).toBeNull();
});

it('keeps the separate teacher appeals desk in its original place', () => {
  navigation.pathname = '/teacher';
  render(<ServiceBreadcrumbs />);
  expect(screen.getByText('課務申訴審核').getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('link', { name: '課程工作台' })).toBeNull();
});

it.each(['feedback', 'semester'])(
  'does not turn the %s grade tab into a school-account detour',
  (tab) => {
    navigation.pathname = '/grades';
    navigation.search = `tab=${tab}&campus=nthu`;
    render(<ServiceBreadcrumbs />);
    const nav = screen.getByRole('navigation', { name: '目前位置' });
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
    expect(within(nav).getByRole('link', { name: '課務' }).getAttribute('href')).toBe(
      '/timetable?campus=nthu',
    );
  },
);
