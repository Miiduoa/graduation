'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  watchMessagingSession,
  type MessagingFailure,
  type MessagingSession,
} from '@/lib/privateMessages';

export type SchoolEventMembership =
  | { status: 'guest' }
  | { status: 'auth-loading' }
  | { status: 'membership-loading'; uid: string }
  | { status: 'ready'; uid: string; schoolId: string }
  | { status: 'stale'; uid: string }
  | { status: 'permission'; uid: string }
  | { status: 'unavailable'; uid: string }
  | { status: 'mismatch'; uid: string; schoolId: string; selectedSchoolId: string };

export type SchoolEventMembershipState = {
  membership: SchoolEventMembership;
  /** Bumps on revoke / identity change; captured guards stay false across newer epochs. */
  authorizationEpoch: number;
  /** Live authorization check; invalidated synchronously on watcher failure. */
  isAuthorized: () => boolean;
};

/**
 * Authoritative Firebase school membership for event registration.
 * Selected browsing school and Nuni identity are never treated as authorization.
 */
export function useSchoolEventMembership(selectedSchoolId: string | null): SchoolEventMembershipState {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;
  const [session, setSession] = useState<MessagingSession | null>(null);
  const [failure, setFailure] = useState<MessagingFailure | null>(null);
  const [watching, setWatching] = useState(false);
  const [authorizationEpoch, setAuthorizationEpoch] = useState(0);
  const watchGeneration = useRef(0);
  const authEpochRef = useRef(0);
  const authorizedRef = useRef<{ epoch: number; uid: string; schoolId: string } | null>(null);
  const latestUidRef = useRef(uid);
  const latestSelectedRef = useRef(selectedSchoolId);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authEpochRef.current += 1;
      authorizedRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestUidRef.current = uid;
    latestSelectedRef.current = selectedSchoolId;
  }, [uid, selectedSchoolId]);

  useEffect(() => {
    const request = ++watchGeneration.current;
    setSession(null);
    setFailure(null);
    authEpochRef.current += 1;
    authorizedRef.current = null;
    setAuthorizationEpoch(authEpochRef.current);

    if (loading || !uid) {
      setWatching(false);
      return;
    }

    setWatching(true);
    try {
      return watchMessagingSession(
        uid,
        (next) => {
          if (request !== watchGeneration.current || !mountedRef.current) return;
          if (next.uid !== latestUidRef.current) return;
          // Establish live auth before React flushes the ready membership render,
          // so keyed child effects can guard with the same epoch.
          authorizedRef.current = {
            epoch: authEpochRef.current,
            uid: next.uid,
            schoolId: next.schoolId,
          };
          setSession(next);
          setFailure(null);
          setWatching(false);
        },
        (reason) => {
          if (request !== watchGeneration.current || !mountedRef.current) return;
          // Invalidate before React flushes membership UI / child effects.
          authEpochRef.current += 1;
          authorizedRef.current = null;
          setAuthorizationEpoch(authEpochRef.current);
          setSession(null);
          setFailure(reason);
          setWatching(false);
        },
      );
    } catch {
      authEpochRef.current += 1;
      authorizedRef.current = null;
      setAuthorizationEpoch(authEpochRef.current);
      setSession(null);
      setFailure('unavailable');
      setWatching(false);
      return undefined;
    }
  }, [loading, uid]);

  let membership: SchoolEventMembership;
  if (loading) {
    membership = { status: 'auth-loading' };
  } else if (!uid) {
    membership = { status: 'guest' };
  } else if (session && session.uid !== uid) {
    // Reject a session whose uid differs from the latest useAuth uid during render.
    membership = { status: 'membership-loading', uid };
  } else if (watching && !session && !failure) {
    membership = { status: 'membership-loading', uid };
  } else if (failure === 'stale') {
    membership = { status: 'stale', uid };
  } else if (failure === 'permission') {
    membership = { status: 'permission', uid };
  } else if (failure === 'unavailable' || !session) {
    membership = { status: 'unavailable', uid };
  } else if (!selectedSchoolId || session.schoolId !== selectedSchoolId) {
    membership = {
      status: 'mismatch',
      uid,
      schoolId: session.schoolId,
      selectedSchoolId: selectedSchoolId || '',
    };
  } else {
    membership = { status: 'ready', uid: session.uid, schoolId: session.schoolId };
  }

  const isAuthorized = useCallback(() => {
    if (!mountedRef.current) return false;
    if (authEpochRef.current !== authorizationEpoch) return false;
    const auth = authorizedRef.current;
    if (!auth || auth.epoch !== authEpochRef.current) return false;
    const selected = latestSelectedRef.current;
    return (
      !!selected &&
      auth.uid === latestUidRef.current &&
      auth.schoolId === selected
    );
  }, [authorizationEpoch]);

  return {
    membership,
    authorizationEpoch,
    isAuthorized,
  };
}

export function schoolEventMembershipCurrent(
  membership: SchoolEventMembership,
  selectedSchoolId: string | null,
): boolean {
  return (
    membership.status === 'ready' &&
    !!selectedSchoolId &&
    membership.schoolId === selectedSchoolId
  );
}
