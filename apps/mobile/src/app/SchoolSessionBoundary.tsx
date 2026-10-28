import React, { useEffect, useRef } from 'react';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { toPublicSchoolId } from '../data/schoolIds';
import { isStudentIdLoginAvailable } from '../services/schoolLoginAvailability';
import { invalidateSchoolLoginSync } from '../services/schoolLoginSync';

type SchoolSession = Pick<
  ReturnType<typeof useAuth>,
  'user' | 'profile' | 'loading' | 'profileLoading' | 'tokenExpired'
>;

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
  const { school } = useSchool();
  const previous = useRef({ user: auth.user, schoolId: toPublicSchoolId(school.id) });
  useEffect(() => {
    const schoolId = toPublicSchoolId(school.id);
    if (previous.current.user !== auth.user || previous.current.schoolId !== schoolId) {
      invalidateSchoolLoginSync(previous.current.user, previous.current.schoolId);
    }
    previous.current = { user: auth.user, schoolId };
    if (auth.tokenExpired) invalidateSchoolLoginSync(auth.user, schoolId);
  }, [auth.user, auth.tokenExpired, school.id]);
  return hasReadySchoolSession(auth, school.id) ? (
    <React.Fragment key={`${auth.user!.uid}:${school.id}`}>
      {children}
    </React.Fragment>
  ) : (
    <>{publicContent}</>
  );
}
