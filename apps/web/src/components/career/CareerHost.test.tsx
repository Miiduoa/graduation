import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CareerHost } from './CareerHost';
import type { CareerWorkstudyProps } from './CareerWorkstudy';
import type { InternshipCalendarItem } from '@campus/shared/src/careerInternship';
import { savePersonalImportBatch } from '@/lib/personalImports';
const state = vi.hoisted(() => ({
  user: { uid: 'alice' },
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

it('keeps permission-denied hidden without offering or looping a staff retry', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: '目前沒有實習承辦權限。' } }),
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<CareerHost schoolId="pu" />);
  await act(async () => {});
  view.rerender(<CareerHost schoolId="pu" />);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(view.queryByText('實習工作區 staff')).toBeNull();
  expect(view.queryByText('重新確認承辦權限')).toBeNull();
  expect(view.queryByText('目前沒有實習承辦權限。')).toBeNull();
});

it.each(['尚未啟用', '等候逾時', 'network failure'])(
  'allows a failed staff probe (%s) to succeed on explicit retry',
  async (message) => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        if (message === 'network failure') throw new TypeError('Failed to fetch');
        return { ok: false, json: async () => ({ error: { message } }) };
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ result: { snapshot: { rules: [], records: [], audit: [] } } }),
      });
    vi.stubGlobal('fetch', fetcher);
    const view = render(<CareerHost schoolId="pu" />);
    const retry = await view.findByText('重新確認承辦權限');
    expect(view.queryByText('實習工作區 staff')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(view.getByText('實習工作區 staff')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.queryByText('重新確認承辦權限')).toBeNull();
  },
);

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
