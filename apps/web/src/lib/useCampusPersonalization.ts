'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultCampusPreferences,
  type CampusPersonalizationPreferences,
} from '@campus/shared/src/campusPersonalization';
import type { PersonalImportScope } from './personalImports';
import {
  CAMPUS_PREFERENCES_CHANGE,
  campusPreferencesStorageKey,
  readCampusPreferences,
  writeCampusPreferences,
} from './campusPreferences';

type State = {
  key: string;
  preferences: CampusPersonalizationPreferences;
  error: string;
};

/** Hide a previous account/school before effects run, including during session revalidation. */
export function useCampusPersonalization(scope: PersonalImportScope | null) {
  const owner = scope?.owner;
  const schoolId = scope?.schoolId;
  const key = scope ? campusPreferencesStorageKey(scope) : null;
  const lease = useMemo(() => ({ key }), [key]);
  const activeLease = useRef<typeof lease | null>(null);
  const [state, setState] = useState<State | null>(null);

  useLayoutEffect(() => {
    activeLease.current = lease;
    return () => {
      activeLease.current = null;
    };
  }, [lease]);

  useEffect(() => {
    if (!key || !owner || !schoolId) return;
    let active = true;
    const refresh = () => {
      if (!active || activeLease.current !== lease) return;
      try {
        const preferences = readCampusPreferences({ owner, schoolId });
        setState({ key, preferences, error: '' });
      } catch (error) {
        setState({
          key,
          preferences: createDefaultCampusPreferences(),
          error: error instanceof Error ? error.message : '首頁偏好暫時讀不到，請稍後再試。',
        });
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) refresh();
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ key?: string }>).detail?.key === key) refresh();
    };
    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(CAMPUS_PREFERENCES_CHANGE, onChange);
    return () => {
      active = false;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CAMPUS_PREFERENCES_CHANGE, onChange);
    };
  }, [key, owner, schoolId, lease]);

  const save = useCallback(
    (preferences: CampusPersonalizationPreferences): boolean => {
      if (!key || !owner || !schoolId || activeLease.current !== lease) return false;
      try {
        const saved = writeCampusPreferences({ owner, schoolId }, preferences);
        if (activeLease.current !== lease) return false;
        setState({ key, preferences: saved, error: '' });
        return true;
      } catch (error) {
        if (activeLease.current === lease)
          setState((previous) => ({
            key,
            preferences:
              previous?.key === key ? previous.preferences : createDefaultCampusPreferences(),
            error: error instanceof Error ? error.message : '首頁偏好尚未儲存，請再試一次。',
          }));
        return false;
      }
    },
    [key, owner, schoolId, lease],
  );

  const visible = key !== null && state?.key === key ? state : null;
  return {
    preferences: visible?.preferences ?? null,
    storageError: visible?.error ?? '',
    loading: key !== null && visible === null,
    save,
  };
}
