import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { CareerHost } from '../components/career/CareerHost';
import type { CareerWorkbenchEvent } from '@campus/shared/src/careerWorkstudy';
let mockEvents: (filter: { category: 'career'; event?: CareerWorkbenchEvent }) => void;
let mockUser: { uid: string } | null = { uid: 'staff' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'staff', getIdToken: async () => 'fixture' } }),
}));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: async () => ({ courses: [] }),
}));
jest.mock('../components/career/CareerWorkstudy', () => ({
  CareerWorkstudy: ({ onCareerEvents }: { onCareerEvents: typeof mockEvents }) => {
    mockEvents = onCareerEvents;
    return null;
  },
}));
jest.mock('../components/career/CareerInternship', () => ({
  CareerInternship: ({ audience }: { audience: string }) =>
    require('react').createElement(require('react-native').Text, null, '實習工作區 ' + audience),
}));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});
test('keeps permission-denied hidden without offering or looping a staff retry', async () => {
  const fetcher = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: '目前沒有實習承辦權限。' } }),
  });
  global.fetch = fetcher;
  const view = render(<CareerHost schoolId="pu" />);
  await act(async () => {});
  view.rerender(<CareerHost schoolId="pu" />);
  expect(fetcher).toHaveBeenCalledTimes(0);
  expect(view.queryByText('實習工作區 staff')).toBeNull();
  expect(view.queryByText('目前沒有實習承辦權限。')).toBeNull();
});

test('opens the school event list and both event sources on nuni.tw', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: '目前沒有實習承辦權限。' } }),
  });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  render(<CareerHost schoolId="pu" />);
  await act(async () => {});
  mockEvents({ category: 'career' });
  expect(open).toHaveBeenLastCalledWith('https://nuni.tw/events?schoolId=pu');
  for (const source of ['school-club-events', 'school-events'] as const) {
    mockEvents({
      category: 'career',
      event: { id: 'event /1', title: '活動', startsAt: '', source },
    });
    expect(open).toHaveBeenLastCalledWith(
      'https://nuni.tw/events/event%20%2F1?schoolId=pu&source=' + source,
    );
  }
});

test('shows an honest sign-in state for guests before querying opportunities', () => {
  mockUser = null;
  const view = render(<CareerHost schoolId="pu" />);
  expect(view.getByText('登入後查看本校工讀、實習與校徵')).toBeTruthy();
  expect(view.queryByText(/職產處還沒/)).toBeNull();
  expect(view.queryByText(/實習工作區/)).toBeNull();
  mockUser = { uid: 'staff' };
});
