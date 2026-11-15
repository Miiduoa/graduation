import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CareerHost } from './CareerHost';
import type { CareerWorkstudyProps } from './CareerWorkstudy';
import type { InternshipCalendarItem } from '@campus/shared/src/careerInternship';
import { savePersonalImportBatch } from '@/lib/personalImports';
const state = vi.hoisted(() => ({
  user: { uid: 'alice' },
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
  CareerWorkstudy: ({ service }: CareerWorkstudyProps) => {
    expect(service.subscribe).toBeUndefined();
    return null;
  },
}));
vi.mock('./CareerInternship', () => ({
  CareerInternship: ({
    onAddCalendar,
  }: {
    onAddCalendar: (item: InternshipCalendarItem) => Promise<unknown>;
  }) => {
    state.calendar = onAddCalendar;
    return null;
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
