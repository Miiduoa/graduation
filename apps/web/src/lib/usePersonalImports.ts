'use client';

import { useEffect, useState } from 'react';
import type { PersonalImportRecord } from '@campus/shared';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import {
  PERSONAL_IMPORT_CHANGE,
  personalImportsStorageKey,
  readPersonalImports,
  readPersonalImportSyncState,
  type PersonalImportScope,
} from './personalImports';

export function usePersonalImportScope() {
  const auth = useAuth();
  const nuni = useOptionalNuniSession();
  const school = useOptionalSelectedSchool();
  const loading = auth.loading || !!nuni?.loading || !!school?.loading;
  const owner = nuni?.session
    ? `platform:${nuni.session.platformAccountId}`
    : auth.user
      ? `school:${auth.user.uid}`
      : 'guest';
  const scope: PersonalImportScope = { owner, schoolId: school?.selectedSchoolId || 'personal' };
  return {
    scope,
    scopeKey: personalImportsStorageKey(scope),
    loading,
    schoolName: school?.selectedSchool?.name || '未指定校園',
  };
}

export function usePersonalImports(scope: PersonalImportScope, enabled = true) {
  const key = personalImportsStorageKey(scope);
  const [state, setState] = useState<{
    key: string;
    records: PersonalImportRecord[];
    error: string;
    syncEnabled: boolean;
  } | null>(null);
  const owner = scope.owner;
  const schoolId = scope.schoolId;
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      try {
        const records = readPersonalImports({ owner, schoolId });
        const syncEnabled = readPersonalImportSyncState({ owner, schoolId }).enabled;
        setState({ key, records, error: '', syncEnabled });
      } catch (error) {
        setState({
          key,
          records: [],
          error: error instanceof Error ? error.message : '無法讀取匯入紀錄。',
          syncEnabled: false,
        });
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(PERSONAL_IMPORT_CHANGE, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(PERSONAL_IMPORT_CHANGE, refresh);
    };
  }, [key, enabled, owner, schoolId]);
  const visible = enabled && state?.key === key ? state : null;
  return {
    records: visible?.records ?? [],
    error: visible?.error ?? '',
    loading: !visible,
    syncEnabled: visible?.syncEnabled ?? false,
    /** True only after a successful read for this scope; load failures must not look empty. */
    ready: !!visible && !visible.error,
  };
}
