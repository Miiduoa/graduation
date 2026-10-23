'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '@/lib/firebase';

export type SchoolRole = 'student' | 'teacher' | 'admin' | 'editor' | 'vendor' | string;

const cache = new Map<string, SchoolRole | null>();

/** 自己在這所學校的身分（讀自己的 members 文件）。還沒讀到或讀不到是 null。 */
export function useSchoolRole(uid: string | null | undefined, schoolId: string): SchoolRole | null {
  const key = uid ? `${schoolId}:${uid}` : '';
  const [role, setRole] = useState<{ key: string; value: SchoolRole | null }>({ key: '', value: null });

  useEffect(() => {
    if (!key || !uid || !isFirebaseConfigured()) return;
    if (cache.has(key)) {
      void Promise.resolve().then(() => setRole({ key, value: cache.get(key) ?? null }));
      return;
    }
    let alive = true;
    getDoc(doc(getDb(), 'schools', schoolId, 'members', uid))
      .then((snap) => {
        const value = snap.exists() ? ((snap.data() as { role?: string }).role ?? null) : null;
        cache.set(key, value);
        if (alive) setRole({ key, value });
      })
      .catch(() => {
        if (alive) setRole({ key, value: null });
      });
    return () => {
      alive = false;
    };
  }, [key, uid, schoolId]);

  return role.key === key ? role.value : null;
}

export function isTeacherRole(role: SchoolRole | null) {
  return role === 'teacher' || role === 'admin' || role === 'editor';
}
