'use client';

import { useEffect, useState } from 'react';
import { browserRequest } from '@/features/nuni/Session';

export type SignInOptions = { google: boolean; studentId: boolean };

export { SCHOOL_LOGIN_BIND_HINT as STUDENT_ID_PREPARING_COPY } from '@campus/shared/src/schoolLogin';

export function parseSignInOptions(value: unknown): SignInOptions {
  if (!value || typeof value !== 'object') return { google: false, studentId: false };
  const row = value as Record<string, unknown>;
  return { google: row.google === true, studentId: row.studentId === true };
}

export function useSignInOptions() {
  const [result, setResult] = useState<{
    attempt: number;
    options: SignInOptions | null;
    error: boolean;
  }>({ attempt: 0, options: null, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void browserRequest('sign-in-options')
      .then((value) => {
        // A missing or malformed response cannot establish which services are closed.
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('invalid-sign-in-options');
        }
        const row = value as Record<string, unknown>;
        if (typeof row.google !== 'boolean' || typeof row.studentId !== 'boolean') {
          throw new Error('invalid-sign-in-options');
        }
        if (active) setResult({ attempt, options: parseSignInOptions(value), error: false });
      })
      .catch(() => {
        if (active) setResult({ attempt, options: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const current = result.attempt === attempt;
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
