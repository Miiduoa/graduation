import { File } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import {
  nextAdminExportFilename,
  shareScopedAdminCsv,
} from '../screens/admin/adminScopedExport';

const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockConstructedNames: string[] = [];

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn((...args: unknown[]) => {
    const name = String(args[1] ?? 'file.csv');
    mockConstructedNames.push(name);
    return {
      uri: `cache/${name}`,
      exists: true,
      write: mockWrite,
      delete: mockDelete,
    };
  }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConstructedNames.length = 0;
});

test('export filenames are unique per attempt even in the same millisecond', () => {
  const a = nextAdminExportFilename('admin-logs', 'PU');
  const b = nextAdminExportFilename('admin-logs', 'PU');
  expect(a).not.toBe(b);
  expect(a).toMatch(/^admin-logs-PU-\d+-\d+\.csv$/);
  expect(b).toMatch(/^admin-logs-PU-\d+-\d+\.csv$/);
});

test('successful share cleans up the owned temp file', async () => {
  const result = await shareScopedAdminCsv({
    kind: 'admin-logs',
    schoolCode: 'PU',
    csv: 'id,action\n1,x\n',
    scope: { generation: 1, identityKey: 'a' },
    isEligible: () => true,
  });
  expect(result).toBe('shared');
  expect(shareAsync).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(File).toHaveBeenCalled();
  expect(mockConstructedNames[0]).toMatch(/^admin-logs-PU-\d+-\d+\.csv$/);
});

test('unavailable share does not leave a private cache file', async () => {
  (isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
  const result = await shareScopedAdminCsv({
    kind: 'announcements',
    schoolCode: 'PU',
    csv: 'id\n1\n',
    scope: { generation: 1, identityKey: 'a' },
    isEligible: () => true,
  });
  expect(result).toBe('unavailable');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

test('scope invalidation after availability check aborts without sharing', async () => {
  let resolveAvailability!: (value: boolean) => void;
  (isAvailableAsync as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAvailability = resolve;
    }),
  );
  let eligible = true;
  const pending = shareScopedAdminCsv({
    kind: 'events',
    schoolCode: 'PU',
    csv: 'id\n1\n',
    scope: { generation: 1, identityKey: 'a' },
    isEligible: () => eligible,
  });
  eligible = false;
  resolveAvailability(true);
  await expect(pending).resolves.toBe('aborted');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});
