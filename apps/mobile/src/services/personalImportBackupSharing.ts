import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { serializePersonalImportBackup, createPersonalImportId } from '@campus/shared';
import { snapshotPersonalImports, type PersonalImportScope } from './personalImports';

type BackupShareDependencies = {
  isAvailable(): Promise<boolean>;
  write(content: string): Promise<{ uri: string; remove(): void }>;
  share(uri: string): Promise<void>;
};
const nativeShare: BackupShareDependencies = {
  isAvailable: isAvailableAsync,
  async write(content) {
    const file = new File(Paths.cache, `campus-one-backup-${createPersonalImportId()}.json`);
    await file.write(content);
    return {
      uri: file.uri,
      remove: () => {
        if (file.exists) file.delete();
      },
    };
  },
  share: (uri) =>
    shareAsync(uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: '保存 Campus One 個人資料備份',
    }),
};

/** A completed native share sheet does not prove that its recipient saved the file. */
export async function sharePersonalImportBackup(
  scope: PersonalImportScope,
  active: () => boolean,
  dependencies = nativeShare,
): Promise<void> {
  const requireActive = () => {
    if (!active()) throw new Error('帳號或學校已切換，這次備份已停止。');
  };
  requireActive();
  const ledger = await snapshotPersonalImports(scope, active);
  requireActive();
  if (!ledger.records.length) throw new Error('目前沒有可備份的個人資料。');
  const available = await dependencies.isAvailable();
  requireActive();
  if (!available) throw new Error('這台裝置暫時無法開啟分享選單，資料仍保留，請稍後再試。');
  const content = serializePersonalImportBackup(ledger.records, { schoolId: scope.schoolId });
  const file = await dependencies.write(content);
  try {
    requireActive();
  } catch (error) {
    file.remove();
    throw error;
  }
  try {
    await dependencies.share(file.uri);
  } catch (error) {
    file.remove();
    throw error instanceof Error ? error : new Error('分享選單未能開啟，請重試。');
  }
  // Keep the owned cache file after the sheet closes: some targets finish reading asynchronously.
  // No recipient, upload or successful durable save is inferred from shareAsync resolving.
  requireActive();
}
