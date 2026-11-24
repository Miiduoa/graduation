import { useMemo } from 'react';
import { useAuth } from './auth';
import { useRevokedPersonalImportOwner } from './personalImportAuthority';
import { useNuniSession } from './nuniSession';
import { useSchool } from './school';
import type { PersonalImportScope } from '../services/personalImports';

export function usePersonalImportScope(): PersonalImportScope | null {
  const legacy = useAuth();
  const platform = useNuniSession();
  const { schoolId, selectionReady } = useSchool();
  const revokedOwner = useRevokedPersonalImportOwner();
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
  const verified = !unresolved && owner !== revokedOwner && !!schoolId;
  return useMemo(() => (verified ? { owner, schoolId } : null), [verified, owner, schoolId]);
}
