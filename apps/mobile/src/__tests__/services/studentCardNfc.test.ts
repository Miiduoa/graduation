jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

import {
  createStudentCardNfcClient,
  getStudentCardNfcCapabilities,
  StudentCardNfcError,
  type StudentCardNfcNativeAdapter,
} from '../../services/studentCardNfc';
import type { StudentCardCode } from '../../services/studentCard';

const now = 1_793_923_200_000;
const token = 'a'.repeat(32);
const code: StudentCardCode = { token, expiresAt: now + 30_000, studentId: 'S12345' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const listeners = new Set<(event: { presentationId: string }) => void>();
  const subscriptions: Array<{ remove: jest.Mock }> = [];
  const adapter: StudentCardNfcNativeAdapter = {
    getCapabilities: jest.fn(async () => ({ canRead: true, canPresent: true, enabled: true })),
    beginPresentation: jest.fn(async () => undefined),
    endPresentation: jest.fn(async () => undefined),
    readPresentation: jest.fn(async () => token),
    cancelRead: jest.fn(async () => undefined),
    addListener: jest.fn((_event, listener) => {
      listeners.add(listener);
      const subscription = {
        remove: jest.fn(() => {
          listeners.delete(listener);
        }),
      };
      subscriptions.push(subscription);
      return subscription;
    }),
  };
  const emitEnded = (presentationId: string) => {
    listeners.forEach((listener) => listener({ presentationId }));
  };
  return { adapter, client: createStudentCardNfcClient(adapter), emitEnded, subscriptions };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('student card NFC capabilities', () => {
  test('distinguishes an old app without the native module', async () => {
    await expect(getStudentCardNfcCapabilities()).resolves.toEqual({
      moduleAvailable: false,
      canRead: false,
      canPresent: false,
      enabled: false,
    });
    const client = createStudentCardNfcClient(null);
    await expect(client.read()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(client.beginPresentation(code)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(client.endPresentation()).resolves.toBeUndefined();
    await expect(client.cancelRead()).resolves.toBeUndefined();
  });

  test('returns independently reported read, present and enabled capabilities', async () => {
    const { adapter, client } = setup();
    jest
      .mocked(adapter.getCapabilities)
      .mockResolvedValue({ canRead: true, canPresent: false, enabled: false });
    await expect(client.getCapabilities()).resolves.toEqual({
      moduleAvailable: true,
      canRead: true,
      canPresent: false,
      enabled: false,
    });
  });

  test.each([null, [], true, {}, { canRead: 'true', canPresent: true, enabled: true }])(
    'fails closed for malformed native capabilities',
    async (capabilities) => {
      const { adapter, client } = setup();
      jest.mocked(adapter.getCapabilities).mockResolvedValue(capabilities);
      await expect(client.getCapabilities()).rejects.toMatchObject({ code: 'FAILED' });
    },
  );
});

describe('student card NFC presentation', () => {
  test('passes the token, expiry and an unrelated local session ID to native', async () => {
    const { adapter, client } = setup();
    await client.beginPresentation(code);
    expect(adapter.beginPresentation).toHaveBeenCalledWith(
      token,
      code.expiresAt,
      expect.any(String),
    );
    const presentationId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    expect(presentationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(presentationId).not.toContain(token);
    await client.endPresentation();
  });

  test.each([
    [{ token: 'short' }, 'INVALID'],
    [{ token: 'a'.repeat(33) }, 'INVALID'],
    [{ token: token + '\n' }, 'INVALID'],
    [{ token: 'https://nuni.tw/' + token }, 'INVALID'],
    [{ expiresAt: NaN }, 'INVALID'],
    [{ expiresAt: now + 0.5 }, 'INVALID'],
    [{ expiresAt: now + 65_001 }, 'INVALID'],
    [{ expiresAt: now }, 'EXPIRED'],
    [{ expiresAt: now - 1 }, 'EXPIRED'],
  ] as const)('rejects invalid presentation input %p', async (patch, errorCode) => {
    const { adapter, client } = setup();
    await expect(client.beginPresentation({ ...code, ...patch })).rejects.toMatchObject({
      code: errorCode,
    });
    expect(adapter.beginPresentation).not.toHaveBeenCalled();
  });

  test('does not begin for an already aborted signal', async () => {
    const { adapter, client } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.beginPresentation(code, controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(adapter.beginPresentation).not.toHaveBeenCalled();
    expect(adapter.endPresentation).not.toHaveBeenCalled();
  });

  test('does not restart native when cancelled before its queued start', async () => {
    const { adapter, client } = setup();
    const controller = new AbortController();
    const pending = client.beginPresentation(code, controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await cancelled;
    await client.endPresentation();
    expect(adapter.beginPresentation).not.toHaveBeenCalled();
  });

  test('holds ownership through a late start and clears it before another session', async () => {
    const { adapter, client } = setup();
    const nativeStart = deferred<void>();
    jest.mocked(adapter.beginPresentation).mockReturnValueOnce(nativeStart.promise);
    const controller = new AbortController();
    const pending = client.beginPresentation(code, controller.signal);
    await Promise.resolve();
    expect(adapter.beginPresentation).toHaveBeenCalledTimes(1);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await cancelled;
    await expect(client.beginPresentation(code)).rejects.toMatchObject({ code: 'BUSY' });
    await expect(client.read()).rejects.toMatchObject({ code: 'BUSY' });
    nativeStart.resolve();
    await client.endPresentation();
    expect(adapter.endPresentation).toHaveBeenCalledTimes(2);
    await client.beginPresentation(code);
    await client.endPresentation();
  });

  test('keeps a new session active when an old signal is aborted later', async () => {
    const { adapter, client } = setup();
    const old = new AbortController();
    const current = new AbortController();
    await client.beginPresentation(code, old.signal);
    await client.endPresentation();
    await client.beginPresentation(code, current.signal);
    const stopped = jest.mocked(adapter.endPresentation).mock.calls.length;
    old.abort();
    await Promise.resolve();
    expect(adapter.endPresentation).toHaveBeenCalledTimes(stopped);
    await expect(client.read()).rejects.toMatchObject({ code: 'BUSY' });
    current.abort();
    await client.endPresentation();
    await expect(client.read()).resolves.toBe(token);
  });

  test('rejects a presentation that expired while native was starting', async () => {
    const { adapter, client } = setup();
    const nativeStart = deferred<void>();
    jest.mocked(adapter.beginPresentation).mockReturnValueOnce(nativeStart.promise);
    const pending = client.beginPresentation(code);
    await Promise.resolve();
    jest.setSystemTime(code.expiresAt);
    nativeStart.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'EXPIRED' });
    await client.endPresentation();
    expect(adapter.endPresentation).toHaveBeenCalledTimes(2);
  });

  test('stops an active presentation at its deadline', async () => {
    const { adapter, client } = setup();
    await client.beginPresentation(code);
    jest.advanceTimersByTime(30_000);
    await client.endPresentation();
    expect(adapter.endPresentation).toHaveBeenCalledTimes(2);
    await expect(client.read()).resolves.toBe(token);
  });

  test('blocks a new session until failed cleanup succeeds on retry', async () => {
    const { adapter, client } = setup();
    await client.beginPresentation(code);
    jest.mocked(adapter.endPresentation).mockRejectedValueOnce(new Error('private native details'));
    await expect(client.endPresentation()).rejects.toMatchObject({
      code: 'FAILED',
      message: 'NFC 暫時無法使用，請稍後再試。',
    });
    await expect(client.beginPresentation(code)).rejects.toMatchObject({ code: 'BUSY' });
    await client.endPresentation();
    await client.beginPresentation(code);
    await client.endPresentation();
  });

  test('cancelling a read leaves an active presentation alone', async () => {
    const { adapter, client } = setup();
    await client.beginPresentation(code);
    await client.cancelRead();
    expect(adapter.cancelRead).not.toHaveBeenCalled();
    expect(adapter.endPresentation).not.toHaveBeenCalled();
    await client.endPresentation();
  });

  test('notifies once when native ends the current presentation', async () => {
    const { adapter, client, emitEnded, subscriptions } = setup();
    const onStopped = jest.fn();
    await client.beginPresentation(code, undefined, onStopped);
    const presentationId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    emitEnded(presentationId);
    emitEnded(presentationId);
    expect(onStopped).toHaveBeenCalledTimes(1);
    await client.endPresentation();
    expect(subscriptions[0].remove).toHaveBeenCalledTimes(1);
    await expect(client.read()).resolves.toBe(token);
  });

  test('ignores a late event for the old ID while a new presentation is active', async () => {
    const { adapter, client, emitEnded } = setup();
    const onOldStopped = jest.fn();
    const onCurrentStopped = jest.fn();
    await client.beginPresentation(code, undefined, onOldStopped);
    const oldId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    await client.endPresentation();
    await client.beginPresentation(code, undefined, onCurrentStopped);
    const currentId = jest.mocked(adapter.beginPresentation).mock.calls[1][2];
    expect(currentId).not.toBe(oldId);
    const stopped = jest.mocked(adapter.endPresentation).mock.calls.length;
    emitEnded(oldId);
    await Promise.resolve();
    expect(onOldStopped).not.toHaveBeenCalled();
    expect(onCurrentStopped).not.toHaveBeenCalled();
    expect(adapter.endPresentation).toHaveBeenCalledTimes(stopped);
    await expect(client.read()).rejects.toMatchObject({ code: 'BUSY' });
    emitEnded(currentId);
    expect(onCurrentStopped).toHaveBeenCalledTimes(1);
    await client.endPresentation();
  });

  test('ignores a queued native event after the presentation has been closed', async () => {
    const { adapter, client, subscriptions } = setup();
    const controller = new AbortController();
    const onStopped = jest.fn();
    await client.beginPresentation(code, controller.signal, onStopped);
    const presentationId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    const queuedListener = jest.mocked(adapter.addListener).mock.calls[0][1];
    controller.abort();
    queuedListener({ presentationId });
    await client.endPresentation();
    queuedListener({ presentationId });
    expect(onStopped).not.toHaveBeenCalled();
    expect(subscriptions[0].remove).toHaveBeenCalledTimes(1);
  });

  test('cancels a pending begin before notifying that native presentation ended', async () => {
    const { adapter, client, emitEnded, subscriptions } = setup();
    const nativeStart = deferred<void>();
    jest.mocked(adapter.beginPresentation).mockReturnValueOnce(nativeStart.promise);
    const onStopped = jest.fn();
    const pending = client.beginPresentation(code, undefined, onStopped);
    await Promise.resolve();
    const presentationId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    emitEnded(presentationId);
    expect(onStopped).toHaveBeenCalledTimes(1);
    await cancelled;
    await expect(client.beginPresentation(code)).rejects.toMatchObject({ code: 'BUSY' });
    nativeStart.resolve();
    await client.endPresentation();
    expect(subscriptions[0].remove).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledTimes(1);
    await client.beginPresentation(code);
    await client.endPresentation();
  });

  test('does not notify for an event emitted by explicit native cleanup', async () => {
    const { adapter, client, emitEnded } = setup();
    const onStopped = jest.fn();
    await client.beginPresentation(code, undefined, onStopped);
    const presentationId = jest.mocked(adapter.beginPresentation).mock.calls[0][2];
    jest.mocked(adapter.endPresentation).mockImplementation(async () => {
      emitEnded(presentationId);
    });
    await client.endPresentation();
    expect(onStopped).not.toHaveBeenCalled();
  });
});

describe('student card NFC reading', () => {
  test('returns a valid token without starting a presentation', async () => {
    const { adapter, client } = setup();
    await expect(client.read()).resolves.toBe(token);
    expect(adapter.readPresentation).toHaveBeenCalledWith();
    expect(adapter.beginPresentation).not.toHaveBeenCalled();
    await expect(client.read()).resolves.toBe(token);
  });

  test.each([
    null,
    123,
    {},
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    token + '\n',
    'https://nuni.tw/' + token,
  ])('rejects malformed native tokens without exposing their content', async (value) => {
    const { adapter, client } = setup();
    jest.mocked(adapter.readPresentation).mockResolvedValue(value);
    await expect(client.read()).rejects.toMatchObject({
      code: 'INVALID',
      message: '感應資料無法確認，請對方重新出示。',
    });
    await client.cancelRead();
  });

  test('does not start a read for an aborted signal', async () => {
    const { adapter, client } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.read(controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(adapter.readPresentation).not.toHaveBeenCalled();
    expect(adapter.cancelRead).not.toHaveBeenCalled();
  });

  test('cancels promptly and discards a late token before allowing a new read', async () => {
    const { adapter, client } = setup();
    const nativeRead = deferred<unknown>();
    jest.mocked(adapter.readPresentation).mockReturnValueOnce(nativeRead.promise);
    const controller = new AbortController();
    const pending = client.read(controller.signal);
    await Promise.resolve();
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    controller.abort();
    await cancelled;
    await expect(client.read()).rejects.toMatchObject({ code: 'BUSY' });
    nativeRead.resolve(token);
    await client.cancelRead();
    expect(adapter.cancelRead).toHaveBeenCalledTimes(2);
    await expect(client.read()).resolves.toBe(token);
  });

  test('explicit cancellation rejects the reader and consumes a late native rejection', async () => {
    const { adapter, client } = setup();
    const nativeRead = deferred<unknown>();
    jest.mocked(adapter.readPresentation).mockReturnValueOnce(nativeRead.promise);
    const pending = client.read();
    await Promise.resolve();
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    const stopping = client.cancelRead();
    await cancelled;
    nativeRead.reject(new Error('private late error'));
    await stopping;
    await expect(client.read()).resolves.toBe(token);
  });

  test('ending a presentation leaves an active reader alone', async () => {
    const { adapter, client } = setup();
    const nativeRead = deferred<unknown>();
    jest.mocked(adapter.readPresentation).mockReturnValueOnce(nativeRead.promise);
    const pending = client.read();
    await Promise.resolve();
    await client.endPresentation();
    expect(adapter.cancelRead).not.toHaveBeenCalled();
    expect(adapter.endPresentation).not.toHaveBeenCalled();
    nativeRead.resolve(token);
    await expect(pending).resolves.toBe(token);
  });

  test.each(['CANCELLED', 'UNAVAILABLE', 'DISABLED', 'BUSY', 'INVALID', 'EXPIRED', 'READ_FAILED'])(
    'maps ERR_NFC_%s to a safe typed error',
    async (code) => {
      const { adapter, client } = setup();
      jest
        .mocked(adapter.readPresentation)
        .mockRejectedValue({ code: 'ERR_NFC_' + code, message: 'private token ' + token });
      const result = client.read();
      await expect(result).rejects.toBeInstanceOf(StudentCardNfcError);
      await expect(result).rejects.toMatchObject({ code });
      await expect(result).rejects.not.toThrow(token);
      await client.cancelRead();
    },
  );

  test('sanitizes synchronous native failures', async () => {
    const { adapter, client } = setup();
    jest.mocked(adapter.readPresentation).mockImplementation(() => {
      throw new Error('private token ' + token);
    });
    await expect(client.read()).rejects.toMatchObject({
      code: 'FAILED',
      message: 'NFC 暫時無法使用，請稍後再試。',
    });
    await client.cancelRead();
  });

  test.each(['ERR_NFC_CANCELLED\n', 'ERR_NFC_UNKNOWN', 'CANCELLED'])(
    'uses a generic error for an unrecognized native code %p',
    async (code) => {
      const { adapter, client } = setup();
      jest.mocked(adapter.readPresentation).mockRejectedValue({ code, message: token });
      await expect(client.read()).rejects.toMatchObject({
        code: 'FAILED',
        message: 'NFC 暫時無法使用，請稍後再試。',
      });
      await client.cancelRead();
    },
  );
});
