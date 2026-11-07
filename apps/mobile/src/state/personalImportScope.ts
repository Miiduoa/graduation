import { useMemo } from 'react';
import { useAuth } from './auth';
import { useNuniSession } from './nuniSession';
import { useSchool } from './school';
import type { PersonalImportScope } from '../services/personalImports';

export function usePersonalImportScope(): PersonalImportScope | null {
  const legacy = useAuth();
  const platform = useNuniSession();
  const { schoolId, selectionReady } = useSchool();
  const unresolved = !!(
    !selectionReady || legacy.loading ||
    platform.loading ||
    platform.pendingLogout ||
    platform.error
  );
  const owner = platform.session
    ? `nuni:${platform.session.platformAccountId}`
    : legacy.user?.uid
      ? `firebase:${legacy.user.uid}`
      : 'guest:device';
  // Session revalidation must not expose another namespace while the account is unresolved.
  return useMemo(() => (unresolved || !schoolId ? null : { owner, schoolId }), [unresolved, owner, schoolId]);
}
