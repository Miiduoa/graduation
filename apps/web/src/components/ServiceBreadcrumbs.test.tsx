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
  expect(within(nav).getByRole('link', { name: '生活' }).getAttribute('href')).toBe(
    '/life?campus=nthu',
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
    expect(screen.queryByRole('link', { name: '生活' })).toBeNull();
  },
);

it.each(['/', '/life', '/connect', '/profile', '/timetable', '/login', '/unknown'])(
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
