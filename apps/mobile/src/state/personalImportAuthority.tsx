import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useNuniSession } from './nuniSession';

const RevokedCampusEventDraftOwner = createContext<string | null>(null);

/** Track draft revocation above navigation so newly opened activity routes also observe it. */
export function PersonalImportAuthorityProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: firebaseLoading } = useAuth();
  const { session, loading, pendingLogout, error, signInGeneration } = useNuniSession();
  const firebaseUid = user?.uid;
  const nuniOwner = session ? `nuni:${session.platformAccountId}` : null;
  // Keep the last owner during revalidation, including when the session is temporarily absent.
  const nuniSignedOut = !session && !loading && !pendingLogout && !error;
  const previous = useRef({
    hadFirebaseUser: !!firebaseUid,
    nuniOwner,
    signInGeneration,
    revokedOwner: null as string | null,
  });
  const verifiedNuniOwner = !loading && !pendingLogout && !error ? nuniOwner : null;
  const retainedOwner = nuniSignedOut ? null : verifiedNuniOwner ?? previous.current.nuniOwner;
  const verifiedGeneration = verifiedNuniOwner ? signInGeneration : previous.current.signInGeneration;
  const hadFirebaseUser = !!firebaseUid || (firebaseLoading && previous.current.hadFirebaseUser);
  const firebaseJustSignedOut = !firebaseUid && !firebaseLoading && previous.current.hadFirebaseUser;
  const freshNuniSession = !!verifiedNuniOwner && (
    verifiedNuniOwner !== previous.current.nuniOwner ||
    verifiedGeneration !== previous.current.signInGeneration
  );
  const revokedOwner = firebaseUid || freshNuniSession
    ? null
    : firebaseJustSignedOut
      ? previous.current.nuniOwner ?? nuniOwner
      : previous.current.revokedOwner;

  useLayoutEffect(() => {
    previous.current = { hadFirebaseUser, nuniOwner: retainedOwner, revokedOwner, signInGeneration: verifiedGeneration };
  }, [hadFirebaseUser, retainedOwner, revokedOwner, verifiedGeneration]);

  return <RevokedCampusEventDraftOwner.Provider value={revokedOwner}>{children}</RevokedCampusEventDraftOwner.Provider>;
}

export function useRevokedCampusEventDraftOwner() {
  return useContext(RevokedCampusEventDraftOwner);
}
