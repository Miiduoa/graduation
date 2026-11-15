import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { CareerHost } from '../components/career/CareerHost';
import type { CareerWorkbenchEvent } from '@campus/shared/src/careerWorkstudy';
let mockEvents: (filter: { category: 'career'; event?: CareerWorkbenchEvent }) => void;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'staff' } }) }));
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
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(view.queryByText('實習工作區 staff')).toBeNull();
  expect(view.queryByText('重新確認承辦權限')).toBeNull();
  expect(view.queryByText('目前沒有實習承辦權限。')).toBeNull();
});

test.each(['尚未啟用', '等候逾時', 'network failure'])(
  'allows a failed staff probe (%s) to succeed on explicit retry',
  async (message) => {
    const fetcher = jest
      .fn()
      .mockImplementationOnce(async () => {
        if (message === 'network failure') throw new TypeError('Failed to fetch');
        return { ok: false, json: async () => ({ error: { message } }) };
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ result: { snapshot: { rules: [], records: [], audit: [] } } }),
      });
    global.fetch = fetcher;
    const view = render(<CareerHost schoolId="pu" />);
    const retry = await view.findByText('重新確認承辦權限');
    expect(view.queryByText('實習工作區 staff')).toBeNull();
    fireEvent.press(retry);
    await waitFor(() => expect(view.getByText('實習工作區 staff')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(view.queryByText('重新確認承辦權限')).toBeNull();
  },
);

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
