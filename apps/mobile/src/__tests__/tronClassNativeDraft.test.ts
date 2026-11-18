import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  nativeTronClassPayloadIssue,
  readNativeTronClassPending,
  saveNativeTronClassPending,
  clearNativeTronClassPending,
} from '../services/tronClassNativeDraft';
import { operationId, preparation } from './fixtures/tronClassIntegration';

const otherOperation = '22222222-2222-4222-8222-222222222222';
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const file = {
  key: 'local-file',
  uri: 'file:///local/a.pdf',
  name: 'a.pdf',
  size: 3,
  contentType: 'application/pdf',
};
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
it('keeps uncertain operation IDs scoped by owner and homework, without persisting any draft data', async () => {
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(operationId);
  expect(await readNativeTronClassPending('platform:b', 10, 20)).toBeNull();
  expect(await readNativeTronClassPending('platform:a', 10, 21)).toBeNull();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    expect.stringContaining('pending.v1:'),
    operationId,
  );
  await clearNativeTronClassPending('platform:a', 10, 20, operationId);
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBeNull();
});
it('blocks ambiguous or corrupted journal values', async () => {
  await expect(saveNativeTronClassPending('owner', 10, 20, '{}')).rejects.toThrow(
    'INVALID_PENDING_OPERATION',
  );
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{"draft":"secret"}');
  await expect(readNativeTronClassPending('owner', 10, 20)).rejects.toThrow(
    'INVALID_PENDING_OPERATION',
  );
});
it('permits an idempotent save but never replaces a different pending operation', async () => {
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  await expect(saveNativeTronClassPending('platform:a', 10, 20, otherOperation))
    .rejects.toThrow('PENDING_OPERATION_CONFLICT');
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(operationId);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
it('only clears the expected operation and leaves the queue usable after a mismatch', async () => {
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  await expect(clearNativeTronClassPending('platform:a', 10, 20, otherOperation))
    .rejects.toThrow('PENDING_OPERATION_CONFLICT');
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(operationId);
  await clearNativeTronClassPending('platform:a', 10, 20, operationId);
  await clearNativeTronClassPending('platform:a', 10, 20, operationId);
  await saveNativeTronClassPending('platform:a', 10, 20, otherOperation);
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(otherOperation);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
});
it('rejects malformed expected IDs and corrupted stored IDs without clearing or replacing them', async () => {
  await expect(clearNativeTronClassPending('platform:a', 10, 20, '{}'))
    .rejects.toThrow('INVALID_PENDING_OPERATION');
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{"draft":"secret"}');
  await expect(clearNativeTronClassPending('platform:a', 10, 20, operationId))
    .rejects.toThrow('INVALID_PENDING_OPERATION');
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('{"draft":"secret"}');
  await expect(saveNativeTronClassPending('platform:a', 10, 20, operationId))
    .rejects.toThrow('INVALID_PENDING_OPERATION');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});
it('serializes concurrent saves so only one operation can acquire an empty local journal', async () => {
  const started = deferred<void>();
  const read = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => {
    started.resolve();
    return read.promise;
  });
  const first = saveNativeTronClassPending('platform:a', 10, 20, operationId);
  await started.promise;
  const second = saveNativeTronClassPending('platform:a', 10, 20, otherOperation);
  const rejected = expect(second).rejects.toThrow('PENDING_OPERATION_CONFLICT');
  read.resolve(null);
  await first;
  await rejected;
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(operationId);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
it('queues a save until a conditional clear finishes its read/remove interval without blocking other keys', async () => {
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  const readStarted = deferred<void>();
  const read = deferred<string | null>();
  const removeStarted = deferred<void>();
  const releaseRemove = deferred<void>();
  const remove = jest.mocked(AsyncStorage.removeItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => {
    readStarted.resolve();
    return read.promise;
  });
  jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async (key) => {
    removeStarted.resolve();
    await releaseRemove.promise;
    return remove(key);
  });
  const clearing = clearNativeTronClassPending('platform:a', 10, 20, operationId);
  await readStarted.promise;
  const saving = saveNativeTronClassPending('platform:a', 10, 20, otherOperation);
  let saved = false;
  void saving.then(() => { saved = true; });
  // A different owner and a different homework must not queue behind this key.
  await saveNativeTronClassPending('platform:b', 10, 20, otherOperation);
  await saveNativeTronClassPending('platform:a', 10, 21, otherOperation);
  expect(saved).toBe(false);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(3);
  read.resolve(operationId);
  await removeStarted.promise;
  expect(saved).toBe(false);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(3);
  releaseRemove.resolve();
  await clearing;
  await saving;
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(otherOperation);
  expect(await readNativeTronClassPending('platform:b', 10, 20)).toBe(otherOperation);
  expect(await readNativeTronClassPending('platform:a', 10, 21)).toBe(otherOperation);
});
it('retains the old operation after removal failure and rejects a queued replacement', async () => {
  await saveNativeTronClassPending('platform:a', 10, 20, operationId);
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('storage unavailable'));
  const clearing = clearNativeTronClassPending('platform:a', 10, 20, operationId);
  const saving = saveNativeTronClassPending('platform:a', 10, 20, otherOperation);
  await expect(clearing).rejects.toThrow('storage unavailable');
  await expect(saving).rejects.toThrow('PENDING_OPERATION_CONFLICT');
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBe(operationId);
  await clearNativeTronClassPending('platform:a', 10, 20, operationId);
  expect(await readNativeTronClassPending('platform:a', 10, 20)).toBeNull();
});
it('allows local preparation with unknown rules but never grants confirmed submission', () => {
  const unknown = { ...preparation, rules: { status: 'unknown' as const } };
  expect(nativeTronClassPayloadIssue('my draft', [file], unknown)).toBeNull();
  expect(nativeTronClassPayloadIssue('my draft', [file], unknown, true)).toMatch('尚未確認');
});
it('enforces text/attachment rules, exact MIME, local file URI and size limits', () => {
  expect(
    nativeTronClassPayloadIssue('my draft', [], {
      ...preparation,
      rules: {
        status: 'confirmed',
        allowsText: false,
        allowsAttachments: true,
        maxTotalBytes: 100,
      },
    }),
  ).toMatch('nuni 目前未開放這份作業的文字繳交');
  expect(
    nativeTronClassPayloadIssue('', [file], {
      ...preparation,
      allowedContentTypes: ['text/plain'],
    }),
  ).toMatch('目前無法在 nuni 繳交的附件格式');
  expect(
    nativeTronClassPayloadIssue(
      '',
      [{ ...file, uri: 'https://foreign.test/private' }],
      preparation,
    ),
  ).toMatch('讀取位置');
  expect(nativeTronClassPayloadIssue('', [{ ...file, size: 0 }], preparation)).toMatch('單一附件');
  expect(
    nativeTronClassPayloadIssue('', [file], {
      ...preparation,
      rules: {
        status: 'confirmed',
        allowsText: true,
        allowsAttachments: false,
        maxTotalBytes: 100,
      },
    }),
  ).toMatch('nuni 目前未開放這份作業的附件繳交');
});
