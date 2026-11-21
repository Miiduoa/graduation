import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PageRecovery } from './PageRecovery';

const navigation = vi.hoisted(() => ({
  pathname: '/library/unavailable',
  search: 'schoolId=pu&campus=pu&session=private&q=personal&next=https://other.example',
  selection: null as null | {
    selectedSchool: { id: string; code: string } | null;
    loading: boolean;
    catalogStatus: string;
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => navigation.selection,
}));

beforeEach(() => {
  navigation.pathname = '/library/unavailable';
  navigation.search = 'schoolId=pu&campus=pu&session=private&q=personal&next=https://other.example';
  navigation.selection = null;
});

it.each([
  ['/library/unavailable', '生活', '/life'],
  ['/classroom/course/missing', '課務', '/timetable'],
  ['/community/post/missing', '交流', '/connect'],
  ['/student-card/missing', '我的', '/profile'],
  ['/unknown', '今天', '/'],
])('offers a known destination after a missing link at %s', (path, label, href) => {
  navigation.pathname = path;
  render(<PageRecovery kind="missing" />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: `返回${label}` }).getAttribute('href')).toBe(
    `${href}?schoolId=pu&campus=pu`,
  );
  expect(screen.getByRole('link', { name: '查看全部校園服務' }).getAttribute('href')).toBe(
    '/search?schoolId=pu&campus=pu',
  );
  expect(screen.queryByRole('button', { name: '重新載入' })).toBeNull();
});

it('retries only on request and keeps an alternative out of a failing section root', () => {
  navigation.pathname = '/life';
  const retry = vi.fn();
  render(<PageRecovery kind="error" onRetry={retry} />);
  expect(retry).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '這個頁面暫時打不開' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: '返回今天' }).getAttribute('href')).toBe(
    '/?schoolId=pu&campus=pu',
  );
});

it('uses the current campus when the selected school has changed since the broken link', () => {
  navigation.selection = {
    selectedSchool: { id: 'nchu', code: 'NCHU' },
    loading: false,
    catalogStatus: 'ready',
  };
  render(<PageRecovery kind="error" onRetry={() => {}} />);
  expect(screen.getByRole('link', { name: '返回生活' }).getAttribute('href')).toBe(
    '/life?schoolId=nchu&campus=nchu&school=NCHU',
  );
  expect(screen.getByRole('link', { name: '查看全部校園服務' }).getAttribute('href')).toBe(
    '/search?schoolId=nchu&campus=nchu&school=NCHU',
  );
});

it('preserves an explicit all-campus selection instead of reviving the broken URL campus', () => {
  navigation.selection = { selectedSchool: null, loading: false, catalogStatus: 'ready' };
  render(<PageRecovery kind="missing" />);
  expect(screen.getByRole('link', { name: '返回生活' }).getAttribute('href')).toBe(
    '/life?campus=all',
  );
});

it('offers a different destination even when the home page itself has failed', () => {
  navigation.pathname = '/';
  render(<PageRecovery kind="error" onRetry={() => {}} />);
  expect(screen.getByRole('link', { name: '返回校園服務' }).getAttribute('href')).toBe(
    '/search?schoolId=pu&campus=pu',
  );
  expect(screen.getAllByRole('link')).toHaveLength(1);
});

it.each(['missing', 'error'] as const)(
  'does not link back to a broken search root (%s)',
  (kind) => {
    navigation.pathname = '/search';
    render(
      kind === 'error' ? (
        <PageRecovery kind="error" onRetry={() => {}} />
      ) : (
        <PageRecovery kind="missing" />
      ),
    );
    expect(screen.getByRole('link', { name: '返回今天' }).getAttribute('href')).toBe(
      '/?schoolId=pu&campus=pu',
    );
    expect(screen.queryByRole('link', { name: '查看全部校園服務' })).toBeNull();
  },
);
