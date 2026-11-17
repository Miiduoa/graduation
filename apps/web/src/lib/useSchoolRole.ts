'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '@/lib/firebase';

export type SchoolRole = 'student' | 'teacher' | 'admin' | 'editor' | 'vendor' | string;

/** Display only the current account's active, server-confirmed school membership. */
export function useSchoolRole(
  uid: string | null | undefined,
  schoolId: string | null | undefined,
): SchoolRole | null {
  const key = uid && schoolId ? JSON.stringify([schoolId, uid]) : '';
  const [role, setRole] = useState<{ key: string; value: SchoolRole | null }>({
    key: '',
    value: null,
  });
  // Record every scope transition, including A -> B -> A before B responds.
  // A previous role must not reappear before the new subscription confirms it.
  if (role.key !== key) setRole({ key, value: null });

  useEffect(() => {
    if (!key || !uid || !schoolId || !isFirebaseConfigured()) return;
    let alive = true;
    const unsubscribe = onSnapshot(
      doc(getDb(), 'schools', schoolId, 'members', uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!alive) return;
        const member = snapshot.exists() ? snapshot.data() : null;
        const value =
          !snapshot.metadata.fromCache &&
          !snapshot.metadata.hasPendingWrites &&
          member?.status === 'active' &&
          typeof member.role === 'string'
            ? member.role
            : null;
        setRole({ key, value });
      },
      () => {
        if (alive) setRole({ key, value: null });
      },
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [key, uid, schoolId]);

  return role.key === key ? role.value : null;
}

export function isTeacherRole(role: SchoolRole | null) {
  return role === 'teacher' || role === 'admin' || role === 'editor';
}
