import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  nativeTronClassPayloadIssue,
  readNativeTronClassPending,
  saveNativeTronClassPending,
  clearNativeTronClassPending,
} from '../services/tronClassNativeDraft';
import { operationId, preparation } from './fixtures/tronClassIntegration';

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
  await clearNativeTronClassPending('platform:a', 10, 20);
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
  ).toMatch('不接受文字');
  expect(
    nativeTronClassPayloadIssue('', [file], {
      ...preparation,
      allowedContentTypes: ['text/plain'],
    }),
  ).toMatch('不接受');
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
  ).toMatch('不接受附件');
});
