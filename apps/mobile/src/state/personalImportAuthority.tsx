import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useNuniSession } from './nuniSession';

const RevokedNuniOwner = createContext<string | null>(null);

/** Track the account transition above navigation so newly opened routes see the same revocation. */
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
  const retainedOwner = nuniSignedOut ? null : nuniOwner ?? previous.current.nuniOwner;
  const hadFirebaseUser = !!firebaseUid || (firebaseLoading && previous.current.hadFirebaseUser);
  const firebaseJustSignedOut = !firebaseUid && !firebaseLoading && previous.current.hadFirebaseUser;
  const freshNuniSession = !!nuniOwner && (
    nuniOwner !== previous.current.nuniOwner ||
    signInGeneration !== previous.current.signInGeneration
  );
  const revokedOwner = firebaseJustSignedOut
    ? nuniOwner ?? previous.current.nuniOwner
    : firebaseUid || freshNuniSession
      ? null
      : previous.current.revokedOwner;

  useLayoutEffect(() => {
    previous.current = { hadFirebaseUser, nuniOwner: retainedOwner, revokedOwner, signInGeneration };
  }, [hadFirebaseUser, retainedOwner, revokedOwner, signInGeneration]);

  return <RevokedNuniOwner.Provider value={revokedOwner}>{children}</RevokedNuniOwner.Provider>;
}

export function useRevokedPersonalImportOwner() {
  return useContext(RevokedNuniOwner);
}
