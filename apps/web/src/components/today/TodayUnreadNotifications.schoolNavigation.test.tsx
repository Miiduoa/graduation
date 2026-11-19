import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import {
  SelectedSchoolProvider,
  schoolPreferenceKey,
  useSelectedSchool,
} from '@/components/SelectedSchoolProvider';
import type { NotificationFeed } from '@/lib/privateMessages';
import { TodayUnreadNotifications } from './TodayUnreadNotifications';

const state = vi.hoisted(() => ({
  pathname: '/',
  search: 'campus=ntu',
  watch: null as null | { receive: (feed: NotificationFeed) => void; fail: () => void },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: 'alice' }, loading: false }),
}));
vi.mock('@/lib/firebase', () => ({ isFirebaseConfigured: () => true }));
vi.mock('@/lib/privateMessages', async (original) => ({
  ...(await original<typeof import('@/lib/privateMessages')>()),
  watchAccountNotifications: vi.fn((_session, receive, fail) => {
    state.watch = { receive, fail };
    return () => {
      state.watch = null;
    };
  }),
}));

const schools = [
  { id: 'pu', name: '靜宜大學' },
  { id: 'ntu', name: '國立臺灣大學' },
];

function Contents() {
  const school = useSelectedSchool();
  return (
    <>
      <output data-testid="school">
        {school.loading ? 'loading' : (school.selectedSchoolId ?? 'all')}
      </output>
      <TodayUnreadNotifications unsigned={false} />
    </>
  );
}

function App() {
  return (
    <SelectedSchoolProvider
      ownerKey="alice|"
      loading={false}
      schools={schools}
      catalogStatus="ready"
    >
      <Contents />
    </SelectedSchoolProvider>
  );
}

beforeEach(() => {
  Object.assign(state, { pathname: '/', search: 'campus=ntu', watch: null });
  localStorage.setItem(schoolPreferenceKey('alice|'), JSON.stringify({ schoolId: 'pu' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No network is allowed in this navigation test');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(['empty', 'error', 'fallback', 'overflow', 'all'] as const)(
  'keeps the current campus when opening the inbox from the %s home state',
  async (mode) => {
    const campus = mode === 'all' ? 'all' : 'ntu';
    state.search = `campus=${campus}&token=private&q=old-search`;
    const view = render(<App />);
    await waitFor(() => expect(screen.getByTestId('school').textContent).toBe(campus));
    if (mode !== 'all') {
      await waitFor(() => expect(state.watch).not.toBeNull());
      act(() => {
        if (mode === 'error') state.watch!.fail();
        else
          state.watch!.receive({
            notifications: ['fallback', 'overflow'].includes(mode)
              ? Array.from({ length: mode === 'overflow' ? 4 : 1 }, (_, index) => ({
                  id: `notice-${index}`,
                  source: 'user' as const,
                  title: `未分類通知 ${index}`,
                  body: '',
                  type: 'unknown',
                  read: false,
                  createdAt: null,
                  data: { schoolId: campus },
                }))
              : [],
            unscopedCount: 0,
          });
      });
    }
    const label =
      mode === 'fallback'
        ? /^未分類通知 0/
        : mode === 'overflow'
          ? '還有 1 則未讀'
          : ['error', 'all'].includes(mode)
            ? '前往通知匣'
            : '查看全部通知';
    const link = screen.getByRole('link', { name: label });
    const destination = new URL(link.getAttribute('href')!, 'https://fixture.invalid');
    expect(destination.pathname).toBe('/messages');
    expect(Object.fromEntries(destination.searchParams)).toEqual(
      campus === 'all' ? { campus: 'all' } : { schoolId: 'ntu', campus: 'ntu', school: 'NTU' },
    );
    state.pathname = destination.pathname;
    state.search = destination.search.slice(1);
    view.rerender(<App />);
    await waitFor(() => expect(screen.getByTestId('school').textContent).toBe(campus));
    expect(JSON.parse(localStorage.getItem(schoolPreferenceKey('alice|'))!)).toEqual({
      schoolId: 'pu',
    });
  },
);
