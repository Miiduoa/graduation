'use client';

import { sha256 } from 'js-sha256';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { matchDirectoryDraft, mergeDraftBinding, type DirectoryDraftBinding } from './campusDirectorySearch';
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
  const fullyVerified = !auth.loading && !auth.error && !platform?.loading && !platform?.error;
  const draftSchoolOwner = schoolAvailable ? sha256(uid) : undefined;
  const draftPlatformOwner = platformAvailable
    ? sha256(JSON.stringify([platformAccountId, platformContext]))
    : undefined;
  return {
    draftOwnerScope: sha256(JSON.stringify([
      schoolAvailable ? uid : '',
      platformAvailable ? platformAccountId : '',
      platformAvailable ? platformContext : '',
    ])),
    fullyVerified: Boolean(fullyVerified),
    draftSchoolOwner,
    draftPlatformOwner,
    draftOwnerConfirmed: !signingOut && Boolean(schoolAvailable || platformAvailable || fullyVerified),
    uid,
    canInterpret,
    canUseAssistant,
    platformAudience: platformAvailable,
    ownerScope,
    responseScope,
    status,
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

export function useDirectoryDraftIdentity(account: ReturnType<typeof useCampusFinderAccount>, campus?: string) {
  const { draftSchoolOwner, draftPlatformOwner, status } = account;
  const binding = useMemo<DirectoryDraftBinding>(() => ({
    campus,
    schoolOwner: draftSchoolOwner,
    platformOwner: draftPlatformOwner,
    guest: status === 'guest' ? true : undefined,
  }), [campus, draftSchoolOwner, draftPlatformOwner, status]);
  const [previous, setPrevious] = useState<{
    scope: string;
    binding?: DirectoryDraftBinding;
  }>(() => ({ scope: account.ownerScope }));
  const currentScope = account.draftOwnerConfirmed ? account.draftOwnerScope : account.ownerScope;
  const decision = previous.binding && matchDirectoryDraft(previous.binding, { ...binding, campus: '' });
  const scope = !previous.binding || (account.draftOwnerConfirmed && decision === 'restore')
    ? previous.scope
    : currentScope;
  if (account.draftOwnerConfirmed) {
    const schoolOwner = binding.schoolOwner ?? (decision === 'restore' ? previous.binding?.schoolOwner : undefined);
    const platformOwner = binding.platformOwner ?? (decision === 'restore' ? previous.binding?.platformOwner : undefined);
    if (!previous.binding || previous.scope !== scope || previous.binding.schoolOwner !== schoolOwner ||
        previous.binding.platformOwner !== platformOwner || previous.binding.guest !== binding.guest) {
      setPrevious({ scope, binding: { schoolOwner, platformOwner, guest: binding.guest } });
    }
  }
  const bindRestoredDraft = useCallback((saved: DirectoryDraftBinding | undefined) => {
    if (!saved) return;
    setPrevious((current) => {
      if (!current.binding) return current;
      const { schoolOwner, platformOwner } = mergeDraftBinding(saved, current.binding);
      if (current.binding.schoolOwner === schoolOwner && current.binding.platformOwner === platformOwner)
        return current;
      return { ...current, binding: { ...current.binding, schoolOwner, platformOwner } };
    });
  }, []);
  return {
    binding,
    scope,
    canRestore: account.draftOwnerConfirmed && campus !== undefined,
    bindRestoredDraft,
  };
}
