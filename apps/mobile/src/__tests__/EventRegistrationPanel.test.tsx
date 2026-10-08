import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { EventRegistrationPanel } from '../components/EventRegistrationPanel';
import {
  changeEventRegistration,
  loadEventRegistrationStates,
} from '../services/eventRegistration';
let mockUid = 'alice';
let mockSchool = 'pu';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/eventRegistration', () => ({
  ...jest.requireActual('../services/eventRegistration'),
  loadEventRegistrationStates: jest.fn(),
  changeEventRegistration: jest.fn(),
  createEventRegistrationRequestId: jest.fn(() => 'fixed-request-id-0001'),
}));
const available = {
  eventId: 'one',
  policyConfirmed: true,
  status: 'not_registered',
  availability: 'open',
  count: 0,
  capacity: 5,
  canRegister: true,
  canCancel: false,
  opensAt: '2030-01-01T00:00:00Z',
  closesAt: '2030-02-01T00:00:00Z',
  cancellationClosesAt: '2030-02-02T00:00:00Z',
};
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
  mockSchool = 'pu';
  (loadEventRegistrationStates as jest.Mock).mockResolvedValue([available]);
});
test('a failed registration has no success and retries the exact same request ID', async () => {
  (changeEventRegistration as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      ...available,
      status: 'registered',
      count: 1,
      canRegister: false,
      canCancel: true,
    });
  const view = render(<EventRegistrationPanel eventId="one" />);
  await view.findByText('確認報名');
  await act(async () => fireEvent.press(view.getByText('確認報名')));
  expect(view.getByText(/尚未確認操作結果/)).toBeTruthy();
  expect(view.queryByText('已報名')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重試這次報名')));
  expect(view.getByText('已報名')).toBeTruthy();
  expect(
    (changeEventRegistration as jest.Mock).mock.calls.map((call) => call[1].requestId),
  ).toEqual(['fixed-request-id-0001', 'fixed-request-id-0001']);
  expect(view.getByText('取消報名')).toBeTruthy();
});
test.each(['account', 'school', 'back'])(
  '%s switch ignores an old committed response and clears status immediately',
  async (kind) => {
    const pending = deferred();
    (changeEventRegistration as jest.Mock).mockReturnValue(pending.promise);
    const view = render(<EventRegistrationPanel eventId="one" />);
    await view.findByText('確認報名');
    fireEvent.press(view.getByText('確認報名'));
    const current = (changeEventRegistration as jest.Mock).mock.calls[0][2];
    if (kind === 'school') mockSchool = 'other';
    else mockUid = 'bob';
    view.rerender(<EventRegistrationPanel eventId="one" />);
    if (kind === 'back') {
      mockUid = 'alice';
      view.rerender(<EventRegistrationPanel eventId="one" />);
    }
    expect(current()).toBe(false);
    await act(async () =>
      pending.resolve({ ...available, status: 'registered', canRegister: false }),
    );
    expect(view.queryByText('已報名')).toBeNull();
  },
);
test('status failure does not become unregistered and gives a working retry', async () => {
  (loadEventRegistrationStates as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const view = render(<EventRegistrationPanel eventId="one" />);
  await view.findByText(/無法確認報名狀態/);
  expect(view.queryByText('確認報名')).toBeNull();
  fireEvent.press(view.getByText('更新報名狀態'));
  await view.findByText('確認報名');
});
test('double tapping sends once and cancellation uses its own operation', async () => {
  const pending = deferred();
  (changeEventRegistration as jest.Mock)
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ...available, status: 'cancelled' });
  const view = render(<EventRegistrationPanel eventId="one" />);
  const button = await view.findByText('確認報名');
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(changeEventRegistration).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ ...available, status: 'registered', canRegister: false, canCancel: true }),
  );
  await act(async () => fireEvent.press(view.getByText('取消報名')));
  expect((changeEventRegistration as jest.Mock).mock.calls[1][1].action).toBe('cancel');
  expect(view.getByText('已取消報名')).toBeTruthy();
});
test('unavailable or invalid policy never implies free admission or unlimited capacity', async () => {
  (loadEventRegistrationStates as jest.Mock).mockResolvedValue([
    {
      ...available,
      availability: 'unavailable',
      policyConfirmed: false,
      count: null,
      capacity: null,
      canRegister: false,
    },
  ]);
  const view = render(<EventRegistrationPanel eventId="one" />);
  await view.findByText(/主辦單位尚未開放 App 報名/);
  expect(view.queryByText(/免費活動/)).toBeNull();
  expect(view.queryByText(/人數不限/)).toBeNull();
  expect(view.queryByText('確認報名')).toBeNull();
});
