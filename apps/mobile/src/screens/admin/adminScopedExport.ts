import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

export type AdminExportScopeToken = {
  generation: number;
  identityKey: string;
};

let exportSequence = 0;

/** Unique cache filename per export attempt (timestamp + module sequence). */
export function nextAdminExportFilename(kind: string, schoolCode: string): string {
  exportSequence += 1;
  const safeCode = (schoolCode || 'school').replace(/[^\w.-]+/g, '_');
  return `${kind}-${safeCode}-${Date.now()}-${exportSequence}.csv`;
}

export function cleanupAdminExportFile(file: File | null | undefined): void {
  if (!file) return;
  try {
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup of owned temp CSV only.
  }
}

/**
 * Write a scoped CSV, share if still eligible, always clean up the owned temp file.
 * Native share already shown cannot be revoked; cleanup still runs afterward.
 */
export async function shareScopedAdminCsv(args: {
  kind: string;
  schoolCode: string;
  csv: string;
  scope: AdminExportScopeToken;
  isEligible: (scope: AdminExportScopeToken) => boolean;
}): Promise<'shared' | 'unavailable' | 'aborted' | 'failed'> {
  const filename = nextAdminExportFilename(args.kind, args.schoolCode);
  const file = new File(Paths.cache, filename);
  let owned: File | null = file;

  try {
    if (!args.isEligible(args.scope)) {
      return 'aborted';
    }
    file.write(args.csv);

    const canShare = await isAvailableAsync();
    if (!args.isEligible(args.scope)) {
      cleanupAdminExportFile(owned);
      owned = null;
      return 'aborted';
    }

    if (!canShare) {
      cleanupAdminExportFile(owned);
      owned = null;
      return 'unavailable';
    }

    await shareAsync(file.uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });

    cleanupAdminExportFile(owned);
    owned = null;

    if (!args.isEligible(args.scope)) {
      return 'aborted';
    }
    return 'shared';
  } catch (error) {
    cleanupAdminExportFile(owned);
    owned = null;
    if (!args.isEligible(args.scope)) {
      return 'aborted';
    }
    throw error;
  }
}
