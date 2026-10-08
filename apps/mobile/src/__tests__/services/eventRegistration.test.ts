import { httpsCallable } from 'firebase/functions';
import {
  changeEventRegistration,
  loadEventRegistrationStates,
} from '../../services/eventRegistration';
let mockUid = 'alice';
const mockCall = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCall) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
const scope = { uid: 'alice', schoolId: 'pu' };
const state = {
  eventId: 'one',
  policyConfirmed: true,
  status: 'registered',
  availability: 'open',
  count: 1,
  capacity: null,
  canRegister: false,
  canCancel: false,
  opensAt: null,
  closesAt: null,
  cancellationClosesAt: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'alice';
});
test('reads statuses in bounded batches without sending an authority-bearing userId', async () => {
  mockCall.mockImplementation(({ eventIds }) =>
    Promise.resolve({
      data: { ok: true, states: eventIds.map((eventId: string) => ({ ...state, eventId })) },
    }),
  );
  const ids = Array.from({ length: 85 }, (_, index) => `event${index}`);
  expect(await loadEventRegistrationStates(scope, ids, () => true)).toHaveLength(85);
  expect(mockCall.mock.calls.map((call) => call[0].eventIds.length)).toEqual([40, 40, 5]);
  expect(httpsCallable).toHaveBeenCalledWith({}, 'getEventRegistrations');
});
test('mutations only return verified receipts and preserve the request ID', async () => {
  mockCall.mockResolvedValue({ data: { ok: true, state } });
  await expect(
    changeEventRegistration(
      scope,
      { eventId: 'one', requestId: 'request-000000001', action: 'cancel' },
      () => true,
    ),
  ).resolves.toEqual(state);
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'pu',
    eventId: 'one',
    requestId: 'request-000000001',
  });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'cancelCampusEventRegistration');
});
test.each([
  null,
  { ...state, eventId: 'other' },
  { ...state, count: -1 },
  { ...state, status: 'success' },
])('malformed or wrong event receipts reject %p', async (value) => {
  mockCall.mockResolvedValue({ data: { ok: true, state: value } });
  await expect(
    changeEventRegistration(
      scope,
      { eventId: 'one', requestId: 'request-000000001', action: 'register' },
      () => true,
    ),
  ).rejects.toThrow();
});
test('account and school changes reject results without presenting success', async () => {
  let current = true;
  mockCall.mockImplementation(async () => {
    current = false;
    return { data: { ok: true, state } };
  });
  await expect(
    changeEventRegistration(
      scope,
      { eventId: 'one', requestId: 'request-000000001', action: 'register' },
      () => current,
    ),
  ).rejects.toThrow('session changed');
  mockUid = 'bob';
  await expect(loadEventRegistrationStates(scope, ['one'], () => true)).rejects.toThrow(
    'session changed',
  );
  expect(mockCall).toHaveBeenCalledTimes(1);
});
