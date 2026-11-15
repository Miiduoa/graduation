import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { PersonalImportRecord } from '@campus/shared';
import type { CampusPersonalizationPreferences } from '@campus/shared/src/campusPersonalization';
import {
  campusPreferencesStorageKey,
  loadCampusPreferences,
  resetCampusPreferences,
  saveCampusPreferences,
  subscribeCampusPreferences,
} from '../services/campusPersonalization';
import {
  loadPersonalImports,
  subscribePersonalImports,
  type PersonalImportScope,
} from '../services/personalImports';

type Snapshot = {
  epoch: object;
  preferences: CampusPersonalizationPreferences | null;
  error: string;
  events: PersonalImportRecord[];
  eventsError: string;
};

/** Device preferences never establish account, course, campus or role permissions. */
export function useCampusPersonalization(scope: PersonalImportScope | null, enabled = true) {
  const key = scope && enabled ? campusPreferencesStorageKey(scope) : null;
  const owner = scope?.owner;
  const schoolId = scope?.schoolId;
  const epoch = useMemo(() => ({ key }), [key]);
  const currentEpoch = useRef(epoch);
  currentEpoch.current = epoch;
  const mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [savingEpoch, setSavingEpoch] = useState<object | null>(null);
  const savingRef = useRef<object | null>(null);
  const writeRevision = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!key || !owner || !schoolId) return;
    const activeScope = { owner, schoolId };
    let active = true;
    let request = 0;
    const read = async () => {
      const run = ++request;
      const readingRevision = writeRevision.current;
      const [preferences, imports] = await Promise.allSettled([
        loadCampusPreferences(activeScope),
        loadPersonalImports(activeScope),
      ]);
      if (
        !active ||
        currentEpoch.current !== epoch ||
        run !== request ||
        readingRevision !== writeRevision.current
      )
        return;
      setSnapshot({
        epoch,
        preferences: preferences.status === 'fulfilled' ? preferences.value : null,
        error: preferences.status === 'fulfilled' ? '' : '目前無法讀取首頁偏好，請重試。',
        events:
          imports.status === 'fulfilled'
            ? imports.value.records.filter((row) => row.kind === 'events')
            : [],
        eventsError:
          imports.status === 'fulfilled' ? '' : '個人行程暫時讀不到，時間推薦會在重新讀取後更新。',
      });
    };
    void read();
    const unsubscribePreferences = subscribeCampusPreferences((changed) => {
      if (changed === key) void read();
    });
    const unsubscribeImports = subscribePersonalImports((change) => {
      if (change.scope.owner === owner && change.scope.schoolId === schoolId) void read();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => {
      active = false;
      unsubscribePreferences();
      unsubscribeImports();
      app.remove();
    };
  }, [key, owner, schoolId, epoch, attempt]);

  const visible = key && snapshot?.epoch === epoch ? snapshot : null;
  const persist = useCallback(
    async (preferences: CampusPersonalizationPreferences | null) => {
      const latest = snapshotRef.current;
      const resetting = preferences === null;
      if (
        !key ||
        !owner ||
        !schoolId ||
        !mounted.current ||
        currentEpoch.current !== epoch ||
        savingRef.current === epoch ||
        latest?.epoch !== epoch ||
        (resetting ? latest.preferences !== null || !latest.error : !latest.preferences)
      )
        return false;
      savingRef.current = epoch;
      writeRevision.current += 1;
      setSavingEpoch(epoch);
      const isCurrent = () => mounted.current && currentEpoch.current === epoch;
      try {
        const saved = resetting
          ? await resetCampusPreferences({ owner, schoolId }, isCurrent)
          : await saveCampusPreferences({ owner, schoolId }, preferences, isCurrent);
        if (!isCurrent()) return false;
        setSnapshot((previous) =>
          previous?.epoch === epoch ? { ...previous, preferences: saved, error: '' } : previous,
        );
        return true;
      } catch {
        if (isCurrent())
          setSnapshot((previous) =>
            previous?.epoch === epoch
              ? {
                  ...previous,
                  error: resetting
                    ? '這次未能重新設定首頁偏好，請確認裝置儲存空間後再試。'
                    : '這次沒有存成，請確認裝置儲存空間後再試。你的選擇還在。',
                }
              : previous,
          );
        return false;
      } finally {
        if (savingRef.current === epoch) savingRef.current = null;
        if (isCurrent()) setSavingEpoch(null);
      }
    },
    [key, owner, schoolId, epoch],
  );
  const save = useCallback(
    (preferences: CampusPersonalizationPreferences) => persist(preferences),
    [persist],
  );
  const reset = useCallback(() => persist(null), [persist]);

  return {
    scopeKey: key,
    ready: !!visible?.preferences,
    preferences: visible?.preferences ?? null,
    events: visible?.events ?? [],
    error: visible?.error ?? '',
    eventsError: visible?.eventsError ?? '',
    saving: savingEpoch === epoch,
    save,
    reset,
    retry,
  };
}
