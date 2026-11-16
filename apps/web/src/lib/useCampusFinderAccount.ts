'use client';

import { sha256 } from 'js-sha256';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';

/** Finder interpretation uses school auth; the full assistant also supports platform accounts. */
export function useCampusFinderAccount() {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const uid = auth.user?.uid || '';
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
  const ownerScope = sha256(
    JSON.stringify([
      uid,
      platform?.session?.platformAccountId || '',
      platform?.session?.context || '',
    ]),
  );
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
    responseScope,
    status,
    canRemember: status === 'ready' || status === 'guest',
  };
}
