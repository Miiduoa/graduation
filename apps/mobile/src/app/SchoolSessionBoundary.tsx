import React from 'react';
import { useAuth } from '../state/auth';
import { isStudentIdLoginAvailable } from '../services/schoolLoginAvailability';

type SchoolSession = Pick<
  ReturnType<typeof useAuth>,
  'user' | 'profile' | 'loading' | 'profileLoading' | 'tokenExpired'
>;

export function hasReadySchoolSession(auth: SchoolSession): boolean {
  if (
    auth.loading ||
    auth.profileLoading ||
    auth.tokenExpired ||
    !auth.user ||
    !auth.profile ||
    auth.user.uid !== auth.profile.uid
  )
    return false;
  return isStudentIdLoginAvailable(auth.profile.schoolId);
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
  return hasReadySchoolSession(auth) ? (
    <React.Fragment key={`${auth.user!.uid}:${auth.profile!.schoolId ?? ''}`}>
      {children}
    </React.Fragment>
  ) : (
    <>{publicContent}</>
  );
}
