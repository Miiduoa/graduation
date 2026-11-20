import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePersonalImportBackup } from '@campus/shared';
import { appendPersonalImports, loadPersonalImports } from '../services/personalImports';
import { sharePersonalImportBackup } from '../services/personalImportBackupSharing';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
const scope = { owner: 'nuni:owner-a', schoolId: 'pu' };
beforeEach(async () => {
  await AsyncStorage.clear();
  await appendPersonalImports(scope, [
    {
      id: 'grade',
      kind: 'grades',
      title: '英文',
      credits: 3,
      grade: 'A-',
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
      source: { type: 'screenshot', line: 2, rawText: '英文 3 A-' },
    },
  ]);
});
function dependencies() {
  const remove = jest.fn();
  return {
    remove,
    isAvailable: jest.fn().mockResolvedValue(true),
    write: jest.fn().mockResolvedValue({ uri: 'file:///owned-backup.json', remove }),
    share: jest.fn().mockResolvedValue(undefined),
  };
}

test('native export writes a portable backup and invokes only the real share interface', async () => {
  const deps = dependencies();
  await sharePersonalImportBackup(scope, () => true, deps);
  const parsed = parsePersonalImportBackup(deps.write.mock.calls[0][0]);
  expect(parsed.rows[0]).toMatchObject({
    kind: 'grades',
    grade: 'A-',
    source: { type: 'screenshot', rawText: '英文 3 A-' },
  });
  expect(deps.share).toHaveBeenCalledWith('file:///owned-backup.json');
  // A recipient may finish reading after the sheet closes; do not remove its file prematurely.
  expect(deps.remove).not.toHaveBeenCalled();
});

test('unavailable sharing does not create a file or touch the ledger', async () => {
  const before = await loadPersonalImports(scope);
  const deps = dependencies();
  deps.isAvailable.mockResolvedValue(false);
  await expect(sharePersonalImportBackup(scope, () => true, deps)).rejects.toThrow('分享選單');
  expect(deps.write).not.toHaveBeenCalled();
  expect(await loadPersonalImports(scope)).toEqual(before);
});

test('share failure cleans only the owned output and preserves the source records', async () => {
  const deps = dependencies();
  deps.share.mockRejectedValue(new Error('分享選單失敗'));
  await expect(sharePersonalImportBackup(scope, () => true, deps)).rejects.toThrow();
  expect(deps.remove).toHaveBeenCalledTimes(1);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('account switch while a native file is being written prevents opening the share sheet', async () => {
  const deps = dependencies();
  let active = true;
  deps.write.mockImplementation(async () => {
    active = false;
    return { uri: 'file:///owned-backup.json', remove: deps.remove };
  });
  await expect(sharePersonalImportBackup(scope, () => active, deps)).rejects.toThrow('切換');
  expect(deps.share).not.toHaveBeenCalled();
  expect(deps.remove).toHaveBeenCalledTimes(1);
});
