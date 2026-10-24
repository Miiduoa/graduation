import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getAuthInstance } from '../firebase';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';

/** Module-level valid tokens — never reused after blur/unmount/identity change (survives remount ABA). */
const validScopeTokens = new Set<symbol>();
let identityEpochSeq = 0;
let tokenSeq = 0;

type ScopeSnapshot = {
  uid: string | undefined;
  schoolId: string;
  recordId: string;
  identityEpoch: number;
  token: symbol;
};

/** null means confirmed signed-out; undefined means the SDK is unavailable (for example demo mode). */
function readLiveAuthUid(): string | null | undefined {
  try {
    const uid = getAuthInstance().currentUser?.uid;
    return typeof uid === 'string' && uid ? uid : null;
  } catch {
    return undefined;
  }
}

/**
 * Generation-aware Lost & Found screen scope.
 * Each focused session gets a unique token registered in a module-level set.
 * Old isCurrent closures stay invalid forever after A→B→A, blur, or unmount —
 * even when a later remount recycles local ref counters.
 */
export function useLostFoundGenerationScope(recordId = '') {
  const { user } = useAuth();
  const { school } = useSchool();
  const uid = user?.uid;
  const schoolId = school.id;
  const identityRef = useRef(`${uid ?? ''}\0${schoolId}\0${recordId}`);
  const identityEpochRef = useRef(++identityEpochSeq);
  const liveUidRef = useRef(uid);
  const liveSchoolRef = useRef(schoolId);
  const activeTokenRef = useRef<symbol | null>(null);
  liveUidRef.current = uid;
  liveSchoolRef.current = schoolId;

  const identity = `${uid ?? ''}\0${schoolId}\0${recordId}`;
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    identityEpochRef.current = ++identityEpochSeq;
  }

  const [session, setSession] = useState<{
    token: symbol;
    tokenId: number;
    identityEpoch: number;
    focused: boolean;
  }>({
    token: Symbol('lf-unfocused'),
    tokenId: 0,
    identityEpoch: identityEpochRef.current,
    focused: false,
  });

  useFocusEffect(
    useCallback(() => {
      const token = Symbol('lf-scope');
      const tokenId = ++tokenSeq;
      validScopeTokens.add(token);
      activeTokenRef.current = token;
      const identityEpoch = identityEpochRef.current;
      setSession({ token, tokenId, identityEpoch, focused: true });
      return () => {
        validScopeTokens.delete(token);
        if (activeTokenRef.current === token) activeTokenRef.current = null;
        setSession((prev) => ({ ...prev, focused: false }));
      };
      // Rebind a fresh token whenever uid/school/record identity changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- identity string is the trigger
    }, [uid, schoolId, recordId]),
  );

  const snapshot: ScopeSnapshot = {
    uid,
    schoolId,
    recordId,
    identityEpoch: session.identityEpoch,
    token: session.token,
  };

  const isCurrent = useCallback(() => {
    // Token membership is the source of truth (survives remount ABA; ignores stale focused flags).
    if (!validScopeTokens.has(snapshot.token)) return false;
    if (identityEpochRef.current !== snapshot.identityEpoch) return false;
    if (liveUidRef.current !== snapshot.uid) return false;
    if (liveSchoolRef.current !== snapshot.schoolId) return false;
    if (snapshot.recordId !== recordId) return false;
    const authUid = readLiveAuthUid();
    if (authUid !== undefined && authUid !== snapshot.uid) {
      validScopeTokens.delete(snapshot.token);
      return false;
    }
    return true;
  }, [
    snapshot.token,
    snapshot.identityEpoch,
    snapshot.uid,
    snapshot.schoolId,
    snapshot.recordId,
    recordId,
  ]);

  const assertCurrentScope = useCallback(async () => isCurrent(), [isCurrent]);

  const scope = JSON.stringify([
    uid ?? null,
    schoolId,
    recordId,
    snapshot.identityEpoch,
    session.focused ? session.tokenId : 'blurred',
  ]);

  return {
    uid,
    schoolId,
    scope,
    generation: snapshot.identityEpoch,
    focused: session.focused,
    isCurrent,
    assertCurrentScope,
  };
}
