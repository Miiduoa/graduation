import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { clubRosterCsv } from '../../../../packages/shared/src/clubExport';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
export async function shareClubCsv(view: ClubPortalView) {
  const csv = clubRosterCsv(view);
  if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) {
    await Share.share({ message: csv, title: '社團名冊與活動 CSV' });
    return;
  }
  const path = `${FileSystem.cacheDirectory}club-roster-${Date.now()}.csv`;
  try {
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: '匯出社團名冊與活動',
    });
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}
