import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CareerHost } from './CareerHost';
import type { CareerWorkstudyProps } from './CareerWorkstudy';
import type { InternshipCalendarItem } from '@campus/shared/src/careerInternship';
import { savePersonalImportBatch } from '@/lib/personalImports';
const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  events: null as CareerWorkstudyProps['onCareerEvents'] | null,
  calendar: null as null | ((item: InternshipCalendarItem) => Promise<unknown>),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({ currentUser: { ...state.user, getIdToken: async () => 'fixture' } }),
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
}));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: async () => ({ courses: [] }) }));
vi.mock('@/lib/personalImports', () => ({
  savePersonalImportBatch: vi.fn(
    async (_scope: unknown, _items: unknown, active: () => boolean) => {
      if (!active()) throw new Error('資料範圍已變更');
    },
  ),
}));
vi.mock('./CareerWorkstudy', () => ({
  CareerWorkstudy: ({ service, onCareerEvents }: CareerWorkstudyProps) => {
    state.events = onCareerEvents;
    expect(service.subscribe).toBeUndefined();
    return null;
  },
}));
vi.mock('./CareerInternship', () => ({
  CareerInternship: ({
    onAddCalendar,
    audience,
  }: {
    audience: string;
    onAddCalendar: (item: InternshipCalendarItem) => Promise<unknown>;
  }) => {
    state.calendar = onAddCalendar;
    return <span>實習工作區 {audience}</span>;
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.user = { uid: 'alice' };
});

it('preserves the career campus on both the login form and its return destination', () => {
  state.user = null;
  const view = render(<CareerHost schoolId="pu" />);
  const destination = () =>
    new URL(
      screen
        .getByRole('link', { name: '登入後可申請校內工讀與查看實習學分' })
        .getAttribute('href')!,
      'https://campus.local',
    );
  expect(destination().searchParams.get('schoolId')).toBe('pu');
  expect(destination().searchParams.get('returnUrl')).toBe('/career?schoolId=pu');
  view.rerender(<CareerHost schoolId="nthu" />);
  expect(destination().searchParams.get('schoolId')).toBe('nthu');
  expect(destination().searchParams.get('returnUrl')).toBe('/career?schoolId=nthu');
});
it('invalidates old calendar scopes on school/account changes and unmount', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: { message: '沒有權限' } }) }),
  );
  state.user = { uid: 'alice' };
  const view = render(<CareerHost schoolId="pu" />);
  const alice = state.calendar!;
  const item = {
    id: 'deadline',
    title: '測試截止日',
    startsAt: '2099-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T01:00:00.000Z',
    description: '測試',
    sourceUrl: 'https://school.edu.tw/',
  } as InternshipCalendarItem;
  await act(async () => {
    await alice(item);
  });
  expect(savePersonalImportBatch).toHaveBeenLastCalledWith(
    { owner: 'platform:alice', schoolId: 'pu' },
    expect.any(Array),
    expect.any(Function),
  );
  view.rerender(<CareerHost schoolId="other" />);
  await expect(alice(item)).rejects.toThrow('資料範圍已變更');
  const schoolChanged = state.calendar!;
  state.user = { uid: 'bob' };
  view.rerender(<CareerHost schoolId="other" />);
  await expect(schoolChanged(item)).rejects.toThrow('資料範圍已變更');
  const bob = state.calendar!;
  await bob(item);
  expect(savePersonalImportBatch).toHaveBeenLastCalledWith(
    { owner: 'platform:bob', schoolId: 'other' },
    expect.any(Array),
    expect.any(Function),
  );
  view.unmount();
  await expect(bob(item)).rejects.toThrow('資料範圍已變更');
});

it('does not issue an internship staff probe from student host rendering', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: '目前沒有實習承辦權限。' } }),
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CareerHost schoolId="pu" />);
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
});

it('navigates in the same tab to school event list and both event sources', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: '目前沒有實習承辦權限。' } }),
    }),
  );
  render(<CareerHost schoolId="pu" />);
  await act(async () => {});
  const location = { href: '' };
  vi.stubGlobal('window', { location });
  state.events!({ category: 'career' });
  expect(location.href).toBe('/events?schoolId=pu');
  for (const source of ['school-club-events', 'school-events'] as const) {
    state.events!({
      category: 'career',
      event: { id: 'event /1', title: '活動', startsAt: '', source },
    });
    expect(location.href).toBe('/events/event%20%2F1?schoolId=pu&source=' + source);
  }
});

it('shows an honest sign-in state for guests before querying opportunities', () => {
  state.user = null;
  const view = render(<CareerHost schoolId="pu" />);
  expect(view.getByText('登入後查看本校工讀、實習與校徵')).toBeTruthy();
  expect(view.queryByText(/職產處還沒/)).toBeNull();
  expect(view.queryByText(/實習工作區/)).toBeNull();
  state.user = { uid: 'alice' };
});
