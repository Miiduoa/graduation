import { useEffect, useMemo, useRef, useState } from 'react';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';
import {
  createSavedCampusPlanSession,
  deleteSavedCampusPlan,
  readSavedCampusPlans,
  saveCampusPlan,
  setCampusPlanStepDone,
  subscribeSavedCampusPlanInvalidation,
  type SavedCampusPlan,
  type SavedCampusPlanScope,
  type SavedCampusPlanSession,
} from '../services/savedCampusPlans';

/** A screen owns one storage session; changing account or school retires it. */
export function useSavedCampusPlans(scope: SavedCampusPlanScope | null, isCurrent: () => boolean) {
  const [plans, setPlans] = useState<SavedCampusPlan[]>([]);
  const [loading, setLoading] = useState(Boolean(scope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const current = useRef(isCurrent);
  current.current = isCurrent;
  const lock = useRef(false);
  const owner = scope?.owner;
  const schoolId = scope?.schoolId;
  const identity = JSON.stringify([owner, schoolId, reload]);
  const active = useRef(identity);
  active.current = identity;
  const session = useMemo(() => createSavedCampusPlanSession(
    () => mounted.current && active.current === identity && current.current(),
  ), [identity]);
  const selected = useRef(session);
  selected.current = session;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => subscribeSavedCampusPlanInvalidation(() => {
    if (!mounted.current || !current.current()) return;
    setPlans([]);
    setLoading(false);
    setError('已儲存計畫的狀態已變更，請重新載入。');
  }), []);

  useEffect(() => {
    let live = true;
    setPlans([]);
    setError('');
    setLoading(Boolean(owner && schoolId));
    if (owner && schoolId) {
      void readSavedCampusPlans({ owner, schoolId }, session).then((saved) => {
        if (live && session()) setPlans(saved);
      }).catch((failure: unknown) => {
        if (live && mounted.current && current.current()) {
          setError(failure instanceof Error ? failure.message : '暫時無法讀取已儲存計畫，請再試一次。');
        }
      }).finally(() => {
        if (live && mounted.current && current.current()) setLoading(false);
      });
    }
    return () => { live = false; };
  }, [owner, schoolId, session]);

  const mutate = async (
    operation: (guard: SavedCampusPlanSession) => Promise<SavedCampusPlan[]>,
  ): Promise<boolean> => {
    if (!scope || lock.current || loading || !mounted.current || !current.current()) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await operation(session);
      if (selected.current !== session || !session()) return false;
      setPlans(saved);
      return true;
    } catch (failure) {
      if (selected.current === session && mounted.current && current.current()) {
        setError(failure instanceof Error ? failure.message : '這次變更尚未儲存，請再試一次。');
      }
      return false;
    } finally {
      lock.current = false;
      if (selected.current === session && mounted.current && current.current()) setBusy(false);
    }
  };

  return {
    plans, loading, busy, error,
    retry: () => { if (!lock.current && current.current()) setReload((value) => value + 1); },
    save: (question: string, plan: CampusEvidencePlan) => scope
      ? mutate((guard) => saveCampusPlan(scope, { question, plan }, guard)) : Promise.resolve(false),
    toggle: (id: string, stepId: string, done: boolean) => scope
      ? mutate((guard) => setCampusPlanStepDone(scope, id, stepId, done, guard)) : Promise.resolve(false),
    remove: (id: string) => scope
      ? mutate((guard) => deleteSavedCampusPlan(scope, id, guard)) : Promise.resolve(false),
  };
}
