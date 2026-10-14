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
  const [options, setOptions] = useState<SignInOptions | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOptions(null);
    void browserRequest('sign-in-options')
      .then((value) => {
        if (active) setOptions(parseSignInOptions(value));
      })
      .catch(() => {
        if (active) setOptions({ google: false, studentId: false });
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return {
    google: options?.google === true,
    studentId: options?.studentId === true,
    loading: options === null,
    retry: () => setAttempt((value) => value + 1),
  };
}
