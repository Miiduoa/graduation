import { beforeEach, expect, it, vi } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import {
  assertEventRegistrationCurrent,
  changeEventRegistration,
  loadEventRegistrationStates,
  validateEventRegistrationState,
  verifyEventRegistrationMutationResult,
} from './campusEventRegistration';

let mockUid = 'alice';
const mockCall = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCall),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => args),
  doc: vi.fn(() => ({ id: 'requestid00000001' })),
}));

vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: { uid: mockUid } }),
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => true,
}));

const scope = { uid: 'alice', schoolId: 'pu' };
const state = {
  eventId: 'one',
  policyConfirmed: true,
  status: 'registered' as const,
  availability: 'open' as const,
  count: 1,
  capacity: null,
  canRegister: false,
  canCancel: false,
  opensAt: '2026-01-01T00:00:00.000Z',
  closesAt: '2026-12-31T00:00:00.000Z',
  cancellationClosesAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUid = 'alice';
  mockCall.mockReset();
});

it('batches getEventRegistrations with the exact callable name and payload', async () => {
  mockCall.mockImplementation(({ eventIds }: { eventIds: string[] }) =>
    Promise.resolve({
      data: {
        ok: true,
        states: eventIds.map((eventId) => ({
          ...state,
          eventId,
          status: 'not_registered',
          canRegister: true,
        })),
      },
    }),
  );
  const ids = Array.from({ length: 85 }, (_, index) => `event${index}`);
  expect(await loadEventRegistrationStates(scope, ids, () => true)).toHaveLength(85);
  expect(mockCall.mock.calls.map((call) => call[0].eventIds.length)).toEqual([40, 40, 5]);
  expect(httpsCallable).toHaveBeenCalledWith({}, 'getEventRegistrations');
  expect(mockCall.mock.calls[0][0]).toEqual({
    schoolId: 'pu',
    eventIds: ids.slice(0, 40),
  });
});

it('registers and cancels only through the authoritative callables', async () => {
  mockCall.mockResolvedValue({ data: { ok: true, reused: false, state } });
  const cancelledReceipt = await changeEventRegistration(
    scope,
    { eventId: 'one', requestId: 'request-000000001', action: 'cancel' },
    () => true,
  );
  expect(cancelledReceipt).toEqual({ state, reused: false });
  expect(
    verifyEventRegistrationMutationResult(cancelledReceipt, {
      uid: 'alice',
      schoolId: 'pu',
      eventId: 'one',
      action: 'cancel',
      requestId: 'request-000000001',
    }),
  ).toBe(true);
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'pu',
    eventId: 'one',
    requestId: 'request-000000001',
  });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'cancelCampusEventRegistration');

  mockCall.mockResolvedValue({
    data: {
      ok: true,
      reused: true,
      state: { ...state, status: 'cancelled', canRegister: true, canCancel: false },
    },
  });
  await expect(
    changeEventRegistration(
      scope,
      { eventId: 'one', requestId: 'request-000000001', action: 'register' },
      () => true,
    ),
  ).resolves.toMatchObject({
    reused: true,
    state: { status: 'cancelled', eventId: 'one' },
  });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'registerCampusEvent');
});

it('rejects malformed states, duplicate ids, and inconsistent boolean combinations', () => {
  expect(() =>
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      availability: 'open',
      canRegister: false,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      canRegister: true,
      canCancel: true,
    }),
  ).toThrow('not confirmed');
  expect(() => validateEventRegistrationState({ ...state, count: -1 })).toThrow('not confirmed');
  expect(() => validateEventRegistrationState({ ...state, eventId: 'other' })).not.toThrow();
});

it('rejects policyConfirmed without dates/count and open/full capacity contradictions', () => {
  expect(() =>
    validateEventRegistrationState({
      ...state,
      opensAt: null,
      closesAt: null,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      canRegister: true,
      count: null,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      policyConfirmed: false,
      availability: 'open',
      status: 'not_registered',
      canRegister: true,
      opensAt: null,
      closesAt: null,
      count: null,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      canRegister: true,
      availability: 'open',
      capacity: 2,
      count: 2,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      canRegister: false,
      availability: 'full',
      capacity: 10,
      count: 3,
    }),
  ).toThrow('not confirmed');
  expect(() =>
    validateEventRegistrationState({
      ...state,
      canCancel: true,
      cancellationClosesAt: null,
    }),
  ).toThrow('not confirmed');
});

it('accepts backend edge cases: canCancel without policyConfirmed, and full when count meets capacity', () => {
  expect(
    validateEventRegistrationState({
      eventId: 'one',
      policyConfirmed: false,
      status: 'registered',
      availability: 'unavailable',
      count: 1,
      capacity: null,
      canRegister: false,
      canCancel: true,
      opensAt: '2026-01-01T00:00:00.000Z',
      closesAt: '2026-12-31T00:00:00.000Z',
      cancellationClosesAt: '2026-12-30T00:00:00.000Z',
    }),
  ).toMatchObject({ canCancel: true, policyConfirmed: false, availability: 'unavailable' });

  expect(
    validateEventRegistrationState({
      ...state,
      status: 'not_registered',
      canRegister: false,
      availability: 'full',
      capacity: 5,
      count: 5,
    }),
  ).toMatchObject({ availability: 'full', count: 5, capacity: 5 });
});

it('allows punctuation-bearing Firebase uids and rejects slash or empty uids', () => {
  mockUid = 'saml:alice@school.edu';
  expect(() =>
    assertEventRegistrationCurrent({ uid: 'saml:alice@school.edu', schoolId: 'pu' }, () => true),
  ).not.toThrow();
  expect(() => assertEventRegistrationCurrent({ uid: '', schoolId: 'pu' }, () => true)).toThrow(
    'session changed',
  );
  expect(() =>
    assertEventRegistrationCurrent({ uid: 'alice/evil', schoolId: 'pu' }, () => true),
  ).toThrow('session changed');
});

it('rejects duplicate event ids before calling and re-checks scope after await', async () => {
  await expect(loadEventRegistrationStates(scope, ['one', 'one'], () => true)).rejects.toThrow(
    'not confirmed',
  );
  expect(mockCall).not.toHaveBeenCalled();

  let current = true;
  mockCall.mockImplementation(async () => {
    current = false;
    return { data: { ok: true, reused: false, state } };
  });
  await expect(
    changeEventRegistration(
      scope,
      { eventId: 'one', requestId: 'request-000000001', action: 'register' },
      () => current,
    ),
  ).rejects.toThrow('session changed');

  mockUid = 'bob';
  mockCall.mockResolvedValue({
    data: {
      ok: true,
      states: [{ ...state, status: 'not_registered', canRegister: true }],
    },
  });
  await expect(loadEventRegistrationStates(scope, ['one'], () => true)).rejects.toThrow(
    'session changed',
  );
});

it('does not treat ordinary read states or clones as mutation receipts', async () => {
  mockCall.mockResolvedValue({
    data: {
      ok: true,
      states: [{ ...state, status: 'not_registered', canRegister: true }],
    },
  });
  const [readState] = await loadEventRegistrationStates(scope, ['one'], () => true);
  expect(
    verifyEventRegistrationMutationResult(
      { reused: false, state: readState },
      {
        uid: 'alice',
        schoolId: 'pu',
        eventId: 'one',
        action: 'register',
        requestId: 'request-000000001',
      },
    ),
  ).toBe(false);

  mockCall.mockResolvedValue({ data: { ok: true, reused: false, state } });
  const receipt = await changeEventRegistration(
    scope,
    { eventId: 'one', requestId: 'request-000000001', action: 'register' },
    () => true,
  );
  expect(
    verifyEventRegistrationMutationResult(
      { ...receipt },
      {
        uid: 'alice',
        schoolId: 'pu',
        eventId: 'one',
        action: 'register',
        requestId: 'request-000000001',
      },
    ),
  ).toBe(false);
  expect(
    verifyEventRegistrationMutationResult(receipt, {
      uid: 'alice',
      schoolId: 'pu',
      eventId: 'one',
      action: 'cancel',
      requestId: 'request-000000001',
    }),
  ).toBe(false);
});
