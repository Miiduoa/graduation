'use client';

import { useEffect, useState } from 'react';
import { browserRequest } from '@/features/nuni/Session';

export type SignInOptions = { google: boolean; studentId: boolean };
export type SignInOptionsScope = 'all' | 'school';

export { SCHOOL_LOGIN_BIND_HINT as STUDENT_ID_PREPARING_COPY } from '@campus/shared/src/schoolLogin';

export function parseSignInOptions(value: unknown): SignInOptions {
  if (!value || typeof value !== 'object') return { google: false, studentId: false };
  const row = value as Record<string, unknown>;
  return { google: row.google === true, studentId: row.studentId === true };
}

export function useSignInOptions(
  schoolId?: string | null,
  ready = true,
  scope: SignInOptionsScope = 'all',
) {
  const requestedSchoolId = schoolId ?? null;
  const [result, setResult] = useState<{
    attempt: number;
    schoolId: string | null;
    scope: SignInOptionsScope;
    options: SignInOptions | null;
    error: boolean;
  }>({ attempt: 0, schoolId: null, scope, options: null, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const query = scope === 'school'
      ? { scope: 'school', ...(requestedSchoolId ? { schoolId: requestedSchoolId } : {}) }
      : requestedSchoolId ? { schoolId: requestedSchoolId } : undefined;
    void browserRequest('sign-in-options', undefined, undefined, undefined, query)
      .then((value) => {
        // A missing or malformed response cannot establish which services are closed.
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('invalid-sign-in-options');
        }
        const row = value as Record<string, unknown>;
        if (
          typeof row.studentId !== 'boolean' ||
          (scope === 'all' && typeof row.google !== 'boolean')
        ) {
          throw new Error('invalid-sign-in-options');
        }
        if (active) {
          setResult({
            attempt,
            schoolId: requestedSchoolId,
            scope,
            // School-only consumers never infer Google availability from this response.
            options: scope === 'school'
              ? { google: false, studentId: row.studentId }
              : parseSignInOptions(value),
            error: false,
          });
        }
      })
      .catch(() => {
        if (active) setResult({ attempt, schoolId: requestedSchoolId, scope, options: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [attempt, ready, requestedSchoolId, scope]);
  const current = ready && result.attempt === attempt &&
    result.schoolId === requestedSchoolId && result.scope === scope;
  const options = current ? result.options : null;
  const error = current && result.error;
  return {
    google: options?.google === true,
    studentId: options?.studentId === true,
    loading: options === null && !error,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
