import { beforeEach, expect, it, vi } from 'vitest';
import {
  campusEventIntentsStorageKey,
  finalizeCampusEventIntent,
  prepareCampusEventIntent,
  readPendingCampusEventIntent,
  submitCampusEventIntent,
} from './campusEventIntents';

let mockUid = 'alice';
const mockCall = vi.fn();
let requestSerial = 0;

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCall),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => args),
  doc: vi.fn(() => {
    requestSerial += 1;
    return { id: `requestid${String(requestSerial).padStart(8, '0')}` };
  }),
}));

vi.mock('./firebase', () => ({
  getAuth: () => ({ currentUser: { uid: mockUid } }),
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  isFirebaseConfigured: () => true,
}));

const scope = { uid: 'alice', schoolId: 'pu' };

function openState(eventId = 'evt-1') {
  return {
    eventId,
    policyConfirmed: true,
    status: 'not_registered' as const,
    availability: 'open' as const,
    count: 0,
    capacity: 10,
    canRegister: true,
    canCancel: false,
    opensAt: '2026-01-01T00:00:00.000Z',
    closesAt: '2026-12-31T00:00:00.000Z',
    cancellationClosesAt: null,
  };
}

function registeredState(eventId = 'evt-1') {
  return {
    ...openState(eventId),
    status: 'registered' as const,
    count: 1,
    canRegister: false,
    canCancel: true,
    cancellationClosesAt: '2026-12-30T00:00:00.000Z',
  };
}

function installLockQueue() {
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, fn: () => unknown) => {
        const task = lock.then(fn);
        lock = task.then(
          () => undefined,
          () => undefined,
        );
        return task;
      },
    },
  });
}

function storageTarget() {
  return Object.hasOwn(localStorage, 'setItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  mockUid = 'alice';
  mockCall.mockReset();
  requestSerial = 0;
  installLockQueue();
});

it('persists before any callable and refuses network work when storage fails', async () => {
  vi.spyOn(storageTarget(), 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(
    prepareCampusEventIntent(scope, { eventId: 'evt-1', action: 'register' }),
  ).rejects.toThrow('尚未送出網路請求');
  expect(mockCall).not.toHaveBeenCalled();
  expect(localStorage.getItem(campusEventIntentsStorageKey(scope))).toBeNull();
});

it('rejects prototype-hazard event ids before any persistence', async () => {
  await expect(
    prepareCampusEventIntent(scope, { eventId: '__proto__', action: 'register' }),
  ).rejects.toThrow('not confirmed');
  await expect(
    prepareCampusEventIntent(scope, { eventId: 'constructor', action: 'register' }),
  ).rejects.toThrow('not confirmed');
  expect(mockCall).not.toHaveBeenCalled();
  expect(localStorage.getItem(campusEventIntentsStorageKey(scope))).toBeNull();
});

it('reuses the same persisted payload after reopen and rejects tampered readbacks', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);

  const key = campusEventIntentsStorageKey(scope);
  const saved = localStorage.getItem(key);
  expect(saved).toContain(intent.requestId);

  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);

  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const first = await submitCampusEventIntent(scope, intent);
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'pu',
    eventId: 'evt-1',
    requestId: intent.requestId,
  });
  expect(first.state.status).toBe('registered');

  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      intents: {
        'evt-1': { ...intent, uid: 'intruder' },
      },
    }),
  );
  await expect(readPendingCampusEventIntent(scope, 'evt-1')).rejects.toThrow('原始資料仍保留');
  expect(localStorage.getItem(key)).toContain('intruder');
});

it('blocks opposite actions over an unknown pending intent and keeps refresh from erasing it', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  await expect(
    prepareCampusEventIntent(scope, { eventId: 'evt-1', action: 'cancel' }),
  ).rejects.toThrow('相反報名操作');
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);

  expect(
    await prepareCampusEventIntent(scope, { eventId: 'evt-1', action: 'register' }),
  ).toEqual(intent);

  mockCall.mockResolvedValue({
    data: {
      ok: true,
      states: [openState()],
    },
  });
  const { loadEventRegistrationStates } = await import('./campusEventRegistration');
  await loadEventRegistrationStates(scope, ['evt-1'], () => true);
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);
});

it('completes a reused register receipt that now reads cancelled without issuing a new mutation id', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: {
      ok: true,
      reused: true,
      state: {
        ...openState(),
        status: 'cancelled',
        canRegister: true,
        canCancel: false,
      },
    },
  });
  const result = await submitCampusEventIntent(scope, intent);
  expect(result).toEqual({
    reused: true,
    state: expect.objectContaining({ status: 'cancelled', eventId: 'evt-1' }),
  });
  expect(mockCall).toHaveBeenCalledTimes(1);
  expect(mockCall.mock.calls[0][0].requestId).toBe(intent.requestId);

  expect(await finalizeCampusEventIntent(scope, intent, result)).toBe(true);
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toBeNull();
});

it('rejects forged or wrapped-read receipts and retains the pending intent', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: { ok: true, states: [registeredState()] },
  });
  const { loadEventRegistrationStates } = await import('./campusEventRegistration');
  const [readState] = await loadEventRegistrationStates(scope, ['evt-1'], () => true);
  const wrapped = { reused: false, state: readState };

  await expect(finalizeCampusEventIntent(scope, intent, wrapped)).rejects.toThrow('not confirmed');
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);

  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const authentic = await submitCampusEventIntent(scope, intent);
  const clone = { ...authentic };
  await expect(finalizeCampusEventIntent(scope, intent, clone)).rejects.toThrow('not confirmed');
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);
});

it('rejects a valid receipt bound to a different request or action', async () => {
  const registerIntent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const registerResult = await submitCampusEventIntent(scope, registerIntent);
  expect(await finalizeCampusEventIntent(scope, registerIntent, registerResult)).toBe(true);

  const cancelIntent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'cancel',
  });
  mockCall.mockResolvedValue({
    data: {
      ok: true,
      reused: false,
      state: { ...openState(), status: 'cancelled', canRegister: true, canCancel: false },
    },
  });
  const cancelResult = await submitCampusEventIntent(scope, cancelIntent);

  await expect(finalizeCampusEventIntent(scope, cancelIntent, registerResult)).rejects.toThrow(
    'not confirmed',
  );
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(cancelIntent);

  const mismatched = {
    ...cancelIntent,
    requestId: 'requestid00000099',
  };
  await expect(submitCampusEventIntent(scope, mismatched)).rejects.toThrow('找不到可送出');
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(cancelIntent);

  expect(await finalizeCampusEventIntent(scope, cancelIntent, cancelResult)).toBe(true);
});

it('reopens from persisted storage, replays the same request id, and mints a fresh authentic result', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  const persisted = await readPendingCampusEventIntent(scope, 'evt-1');
  expect(persisted).toEqual(intent);

  mockCall.mockResolvedValue({
    data: { ok: true, reused: true, state: registeredState() },
  });
  const result = await submitCampusEventIntent(scope, persisted!);
  expect(mockCall.mock.calls[0][0].requestId).toBe(intent.requestId);
  expect(await finalizeCampusEventIntent(scope, persisted!, result)).toBe(true);
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toBeNull();
});

it('serializes concurrent prepares and refuses late cleanup of a newer different intent', async () => {
  let releaseFirst!: () => void;
  const barrier = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const locks = navigator.locks!;
  const originalRequest = locks.request.bind(locks);
  let seen = 0;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (key: string, fn: () => unknown) =>
        originalRequest(key, async () => {
          seen += 1;
          if (seen === 1) await barrier;
          return fn();
        }),
    },
  });

  const firstPromise = prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  const secondPromise = prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  releaseFirst();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  expect(first).toEqual(second);
  expect(first.requestId).toBe('requestid00000001');

  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const result = await submitCampusEventIntent(scope, first);

  localStorage.setItem(
    campusEventIntentsStorageKey(scope),
    JSON.stringify({
      version: 1,
      intents: {
        'evt-1': {
          version: 1,
          uid: 'alice',
          schoolId: 'pu',
          eventId: 'evt-1',
          action: 'cancel',
          requestId: 'requestid00000099',
          createdAt: '2026-10-24T00:00:00.000Z',
        },
      },
    }),
  );
  expect(await finalizeCampusEventIntent(scope, first, result)).toBe(false);
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toMatchObject({
    action: 'cancel',
    requestId: 'requestid00000099',
  });
});

it('fails closed without locks and preserves pending intents when finalize storage cleanup fails', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  await expect(
    prepareCampusEventIntent(scope, { eventId: 'evt-1', action: 'register' }),
  ).rejects.toThrow('無法安全儲存');
  expect(mockCall).not.toHaveBeenCalled();

  installLockQueue();
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const result = await submitCampusEventIntent(scope, intent);

  vi.spyOn(storageTarget(), 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(finalizeCampusEventIntent(scope, intent, result)).rejects.toThrow(
    '報名已確認，但此裝置的紀錄尚未更新，請重試',
  );
  vi.restoreAllMocks();
  installLockQueue();
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);
});

it('distinguishes prepare quota copy from finalize cleanup quota copy', async () => {
  vi.spyOn(storageTarget(), 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(
    prepareCampusEventIntent(scope, { eventId: 'evt-1', action: 'register' }),
  ).rejects.toThrow('尚未送出網路請求');
  expect(mockCall).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  installLockQueue();

  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const result = await submitCampusEventIntent(scope, intent);
  vi.spyOn(storageTarget(), 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(finalizeCampusEventIntent(scope, intent, result)).rejects.toThrow(
    '報名已確認，但此裝置的紀錄尚未更新，請重試',
  );
  vi.restoreAllMocks();
  installLockQueue();
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);
});

it('restores the original pending intent when cleanup write succeeds but readback fails once', async () => {
  const intent = await prepareCampusEventIntent(scope, {
    eventId: 'evt-1',
    action: 'register',
  });
  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const result = await submitCampusEventIntent(scope, intent);

  const target = storageTarget();
  const originalGetItem = target.getItem.bind(target);
  let readFailOnce = false;
  vi.spyOn(target, 'getItem').mockImplementation((...args: unknown[]) => {
    const key = String(args[0] ?? '');
    const value = originalGetItem(key);
    if (
      !readFailOnce &&
      key === campusEventIntentsStorageKey(scope) &&
      value &&
      !value.includes(intent.requestId)
    ) {
      readFailOnce = true;
      throw new Error('readback-tamper');
    }
    return value;
  });

  await expect(finalizeCampusEventIntent(scope, intent, result)).rejects.toThrow('原始資料仍保留');
  vi.restoreAllMocks();
  installLockQueue();

  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toEqual(intent);

  mockCall.mockResolvedValue({
    data: { ok: true, reused: true, state: registeredState() },
  });
  const retry = await submitCampusEventIntent(scope, intent);
  expect(mockCall.mock.calls.at(-1)?.[0].requestId).toBe(intent.requestId);
  expect(await finalizeCampusEventIntent(scope, intent, retry)).toBe(true);
  expect(await readPendingCampusEventIntent(scope, 'evt-1')).toBeNull();
});

it('works with a punctuation-bearing Firebase uid scope', async () => {
  mockUid = 'oidc:alice';
  const punctuated = { uid: 'oidc:alice', schoolId: 'pu' };
  const intent = await prepareCampusEventIntent(punctuated, {
    eventId: 'evt-1',
    action: 'register',
  });
  expect(intent.uid).toBe('oidc:alice');
  expect(campusEventIntentsStorageKey(punctuated)).toContain(encodeURIComponent('oidc:alice'));
  mockCall.mockResolvedValue({
    data: { ok: true, reused: false, state: registeredState() },
  });
  const result = await submitCampusEventIntent(punctuated, intent);
  expect(await finalizeCampusEventIntent(punctuated, intent, result)).toBe(true);
});
