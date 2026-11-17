'use client';

import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '@/lib/firebase';

export type SchoolRole = 'student' | 'teacher' | 'admin' | 'editor' | 'vendor' | string;

type RoleResult =
  | { status: 'loading' | 'error'; role: null }
  | { status: 'ready'; role: SchoolRole | null };

export type SchoolRoleState = RoleResult & { retry: () => void };

/** Loading, unavailable and confirmed non-membership have different recovery paths. */
export function useSchoolRoleState(
  uid: string | null | undefined,
  schoolId: string | null | undefined,
): SchoolRoleState {
  const key = uid && schoolId ? JSON.stringify([schoolId, uid]) : '';
  const [state, setState] = useState<RoleResult & { key: string; request: number }>(() => ({
    key,
    request: 0,
    status: key ? 'loading' : 'ready',
    role: null,
  }));
  // Record every scope transition, including A -> B -> A before B responds.
  // A previous role must not reappear before the new subscription confirms it.
  if (state.key !== key)
    setState({ key, request: state.request + 1, status: key ? 'loading' : 'ready', role: null });
  const request = state.request;
  const retry = useCallback(() => {
    if (!key) return;
    setState((current) =>
      current.key === key && current.request === request
        ? { key, request: request + 1, status: 'loading', role: null }
        : current,
    );
  }, [key, request]);

  useEffect(() => {
    if (!key || !uid || !schoolId) return;
    let alive = true;
    const update = (result: RoleResult) => {
      if (alive)
        setState((current) =>
          current.key === key && current.request === request
            ? { key, request, ...result }
            : current,
        );
    };
    let unsubscribe: (() => void) | undefined;
    try {
      if (!isFirebaseConfigured()) throw new Error('School membership unavailable');
      unsubscribe = onSnapshot(
        doc(getDb(), 'schools', schoolId, 'members', uid),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
            update({ status: 'loading', role: null });
            return;
          }
          const member = snapshot.exists() ? snapshot.data() : null;
          update({
            status: 'ready',
            role:
              member?.status === 'active' && typeof member.role === 'string' ? member.role : null,
          });
        },
        () => update({ status: 'error', role: null }),
      );
    } catch {
      void Promise.resolve().then(() => update({ status: 'error', role: null }));
    }
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [key, uid, schoolId, request]);

  if (state.key !== key) return { status: key ? 'loading' : 'ready', role: null, retry };
  return state.status === 'ready'
    ? { status: 'ready', role: state.role, retry }
    : { status: state.status, role: null, retry };
}

/** Display only the current account's active, server-confirmed school membership. */
export function useSchoolRole(
  uid: string | null | undefined,
  schoolId: string | null | undefined,
): SchoolRole | null {
  return useSchoolRoleState(uid, schoolId).role;
}

export function isTeacherRole(role: SchoolRole | null) {
  return role === 'teacher' || role === 'admin' || role === 'editor';
}
