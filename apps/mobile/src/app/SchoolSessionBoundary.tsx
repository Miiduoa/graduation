import React from 'react';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { toPublicSchoolId } from '../data/schoolIds';
import { isStudentIdLoginAvailable } from '../services/schoolLoginAvailability';

type SchoolSession = Pick<
  ReturnType<typeof useAuth>,
  'user' | 'profile' | 'loading' | 'profileLoading' | 'tokenExpired'
>;

type SchoolSessionReadyListener = (ready: boolean) => void;

const schoolSessionReadyListeners = new Set<SchoolSessionReadyListener>();
let schoolSessionReady = false;

export function isSchoolSessionReady(): boolean {
  return schoolSessionReady;
}

export function subscribeSchoolSessionReady(listener: SchoolSessionReadyListener): () => void {
  schoolSessionReadyListeners.add(listener);
  listener(schoolSessionReady);
  return () => {
    schoolSessionReadyListeners.delete(listener);
  };
}

export function publishSchoolSessionReady(ready: boolean): void {
  if (schoolSessionReady === ready) return;
  schoolSessionReady = ready;
  schoolSessionReadyListeners.forEach((listener) => listener(ready));
}

export function waitForSchoolSessionReady(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (schoolSessionReady) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = subscribeSchoolSessionReady((ready) => {
      if (!ready) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

export function hasReadySchoolSession(auth: SchoolSession, browsingSchoolId: string | null): boolean {
  if (
    auth.loading ||
    auth.profileLoading ||
    auth.tokenExpired ||
    !auth.user ||
    !auth.profile ||
    auth.user.uid !== auth.profile.uid
  )
    return false;
  const accountSchoolId = toPublicSchoolId(auth.profile.schoolId);
  if (!accountSchoolId) return false;
  // Browsing another university never grants access to the signed-in school's private data.
  if (toPublicSchoolId(browsingSchoolId) !== accountSchoolId) return false;
  return isStudentIdLoginAvailable(accountSchoolId);
}

/** Public and platform flows never wait for the independent school profile request. */
export function SchoolSessionBoundary({
  children,
  publicContent,
}: {
  children: React.ReactNode;
  publicContent: React.ReactNode;
}) {
  const auth = useAuth();
  const { schoolId, selectionReady } = useSchool();
  return selectionReady && hasReadySchoolSession(auth, schoolId) ? (
    <React.Fragment key={`${auth.user!.uid}:${schoolId}`}>
      {children}
    </React.Fragment>
  ) : (
    <>{publicContent}</>
  );
}
