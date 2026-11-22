'use client';

import { sha256 } from 'js-sha256';
import { useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';

/** Finder interpretation uses school auth; the full assistant also supports platform accounts. */
export function useCampusFinderAccount() {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const uid = auth.user?.uid || '';
  const platformAccountId = platform?.session?.platformAccountId || '';
  const platformContext = platform?.session?.context || '';
  const checking = Boolean(auth.loading || platform?.loading);
  const signingOut = Boolean(platform?.pendingLogout);
  const schoolAvailable = Boolean(uid && !auth.loading && !auth.error);
  const platformAvailable = Boolean(
    platform?.session && !platform.loading && !platform.error && !platform.pendingLogout,
  );
  const canInterpret = schoolAvailable && !checking && !signingOut;
  const canUseAssistant = !checking && !signingOut && (schoolAvailable || platformAvailable);
  const status = signingOut
    ? 'signing-out'
    : checking
      ? 'checking'
      : canUseAssistant
        ? 'ready'
        : auth.error || platform?.error
          ? 'error'
          : 'guest';
  // Keep session binding in the scope without persisting the session context itself.
  const ownerScope = sha256(JSON.stringify([uid, platformAccountId, platformContext]));
  const responseScope = JSON.stringify([
    ownerScope,
    status,
    Boolean(auth.loading),
    Boolean(auth.error),
    Boolean(platform?.loading),
    Boolean(platform?.error),
    signingOut,
  ]);
  return {
    uid,
    canInterpret,
    canUseAssistant,
    platformAudience: platformAvailable,
    ownerScope,
    // A failed verification can omit the identity for just one source.
    schoolDraftOwner: auth.loading || auth.error ? undefined : sha256(uid),
    platformDraftOwner:
      platform?.loading || platform?.error
        ? undefined
        : sha256(JSON.stringify([platformAccountId, platformContext])),
    responseScope,
    status,
    canRemember: status === 'ready' || status === 'guest',
  };
}

/** null is unresolved; an empty string is a confirmed choice with no campus. */
export function useCampusFinderDraftScope(ownerScope: string, campus: string | null) {
  const [binding, setBinding] = useState({ ownerScope, campus, revision: 0 });
  const ownerChanged = binding.ownerScope !== ownerScope;
  const campusChanged = campus !== null && binding.campus !== null && campus !== binding.campus;
  const revision = binding.revision + (ownerChanged || campusChanged ? 1 : 0);
  if (ownerChanged || (campus !== null && campus !== binding.campus)) {
    setBinding({ ownerScope, campus, revision });
  }
  // First campus resolution and same-campus rechecks retain the current draft.
  // Each real switch gets a new boundary, including a later return to the old account.
  return JSON.stringify([ownerScope, revision]);
}
