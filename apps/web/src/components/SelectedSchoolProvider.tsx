'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { findSchoolById, findSchoolsByCode, normalizeSchoolCode } from '@campus/shared/src/schools';
import { defaultBrowseSchoolId } from '@/lib/defaultBrowseSchool';
import {
  discardActiveCampusDrafts,
  hasCampusDraftActivity,
} from './CampusDraftProvider';
import { ConfirmModal } from './ui/Modal';

export type BrowseSchool = {
  id: string;
  name: string;
  shortName?: string;
  code?: string;
  status?: 'open' | 'not-open';
};

export type SelectedSchoolProviderProps = {
  ownerKey: string | null;
  identityReady?: boolean;
  loading: boolean;
  schools: readonly BrowseSchool[];
  catalogStatus: 'loading' | 'ready' | 'error';
  catalogError?: string;
  onRetryCatalog?: () => void;
  children: ReactNode;
};

type SelectionContext = {
  schools: readonly BrowseSchool[];
  selectedSchool: BrowseSchool | null;
  selectedSchoolId: string | null;
  selectSchool: (id: string | null) => void;
  loading: boolean;
  catalogStatus: SelectedSchoolProviderProps['catalogStatus'];
  catalogError?: string;
  onRetryCatalog?: () => void;
  selectionError: string | null;
  /** Explicit URL/code asked for a campus that is not in the live directory. */
  requestedUnavailable: boolean;
};

/**
 * Resolve browsing campus from the URL, then saved preference.
 * Precedence: campus (incl. all) > schoolId > unique legacy school code > preference.
 * Live catalog membership is required; bundled codes only map a unique id.
 */
export function resolveBrowseQuerySchoolId(
  catalog: readonly BrowseSchool[],
  query: { campus?: string | null; schoolId?: string | null; school?: string | null },
  stored: boolean,
  savedSchoolId: string | null,
): string | null {
  const campus = query.campus?.trim();
  if (campus === 'all') return null;
  if (campus) return campus;

  const schoolId = query.schoolId?.trim();
  if (schoolId === 'all') return null;
  if (schoolId) return schoolId;

  const code = normalizeSchoolCode(query.school);
  if (code) {
    const live = catalog.filter(
      (school) => normalizeSchoolCode(school.code) === code || school.id.toUpperCase() === code,
    );
    if (live.length === 1) return live[0].id;
    if (live.length > 1) return `__ambiguous__:${code}`;

    const bundled = findSchoolsByCode(code);
    if (bundled.length === 1) return bundled[0].id;
    // Ambiguous or unknown explicit codes must not fall through to preference / Providence.
    return `__unresolved__:${code}`;
  }

  return defaultBrowseSchoolId(
    catalog.map((school) => school.id),
    null,
    stored,
    savedSchoolId,
  );
}

const SelectedSchoolContext = createContext<SelectionContext | null>(null);

export function schoolPreferenceKey(ownerKey: string | null) {
  return `campus.browse-school.v1:${ownerKey === null ? 'guest' : `account:${encodeURIComponent(ownerKey)}`}`;
}

function storedSelection(value: string | null): { present: boolean; schoolId: string | null } {
  if (!value) return { present: false, schoolId: null };
  try {
    const stored: unknown = JSON.parse(value);
    if (stored && typeof stored === 'object' && 'schoolId' in stored) {
      return { present: true, schoolId: typeof stored.schoolId === 'string' ? stored.schoolId : null };
    }
  } catch {
    // Invalid or old browser preferences do not establish a school selection.
  }
  return { present: false, schoolId: null };
}

export function SelectedSchoolProvider({
  ownerKey,
  identityReady = true,
  loading,
  schools,
  catalogStatus,
  catalogError,
  onRetryCatalog,
  children,
}: SelectedSchoolProviderProps) {
  const pathname = usePathname() || '/';
  const params = useSearchParams();
  const router = useRouter();
  const storageKey = schoolPreferenceKey(ownerKey);
  const scope = useMemo(() => ({ storageKey, loading }), [storageKey, loading]);
  const activeScope = useRef<typeof scope | null>(null);
  const [preference, setPreference] = useState<{
    scope: typeof scope;
    schoolId: string | null;
    stored: boolean;
    storageError: string | null;
  } | null>(null);
  // Hide previous identity state immediately without remounting page content or losing drafts.
  const currentPreference = preference?.scope === scope ? preference : null;
  const hydrated = currentPreference !== null;
  const savedSchoolId = currentPreference?.schoolId ?? null;
  const stored = currentPreference?.stored ?? false;
  const storageError = currentPreference?.storageError ?? null;

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);

  useEffect(() => {
    if (!loading) {
      let schoolId: string | null = null;
      let stored = false;
      let storageError: string | null = null;
      try {
        const parsed = storedSelection(localStorage.getItem(storageKey));
        schoolId = parsed.schoolId;
        stored = parsed.present;
      } catch {
        storageError = '此瀏覽器無法儲存校園偏好，仍可使用網址切換校園。';
      }
      // Read this browser-only preference after hydration so server markup stays account-neutral.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreference({ scope, schoolId, stored, storageError });
    }
    const changed = (event: StorageEvent) => {
      if (!loading && (event.key === storageKey || event.key === null)) {
        const parsed = storedSelection(event.newValue);
        setPreference((current) =>
          current?.scope === scope
            ? { ...current, schoolId: parsed.schoolId, stored: parsed.present }
            : current,
        );
      }
    };
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('storage', changed);
    };
  }, [loading, storageKey, scope]);

  const catalog = useMemo(() => {
    const seen = new Set<string>();
    return schools.filter((school) => {
      if (!school.id || !school.name || school.id === 'all' || seen.has(school.id)) return false;
      seen.add(school.id);
      return true;
    });
  }, [schools]);
  const requestedId = resolveBrowseQuerySchoolId(
    catalog,
    {
      campus: params?.get('campus'),
      schoolId: params?.get('schoolId'),
      school: params?.get('school'),
    },
    stored,
    savedSchoolId,
  );
  const ready = !loading && hydrated && catalogStatus === 'ready';
  const selectedSchool = ready
    ? (catalog.find((school) => school.id === requestedId) ?? null)
    : null;
  const unavailable = ready && requestedId !== null && selectedSchool === null;
  const [pendingSchoolId, setPendingSchoolId] = useState<string | null | undefined>(undefined);
  const confirmationScope = useMemo(() => ({ scope, identityReady }), [scope, identityReady]);
  const [pendingScope, setPendingScope] = useState(confirmationScope);
  if (pendingScope !== confirmationScope) {
    setPendingScope(confirmationScope);
    setPendingSchoolId(undefined);
  }
  const pendingSwitch = pendingScope === confirmationScope && pendingSchoolId !== undefined;

  function canCommitSchool(id: string | null) {
    return (
      activeScope.current === scope &&
      ready &&
      (id === null || catalog.some((school) => school.id === id))
    );
  }

  function commitSchool(id: string | null): boolean {
    if (!canCommitSchool(id)) return false;
    let nextStorageError: string | null = null;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ schoolId: id }));
    } catch {
      nextStorageError = '此瀏覽器無法儲存校園偏好，仍可使用網址切換校園。';
    }
    setPreference({ scope, schoolId: id, stored: true, storageError: nextStorageError });
    setPendingSchoolId(undefined);
    const next = new URLSearchParams(params?.toString());
    if (pathname === '/map' && selectedSchool?.id !== id) {
      next.delete('route');
      next.delete('focus');
    }
    if (id) {
      next.set('schoolId', id);
      next.set('campus', id);
      const code = catalog.find((school) => school.id === id)?.code || findSchoolById(id)?.code;
      if (code) next.set('school', code);
      else next.delete('school');
    } else {
      next.delete('schoolId');
      next.delete('school');
      next.set('campus', 'all');
    }
    router.replace(`${pathname}?${next.toString()}${window.location.hash}`, { scroll: false });
    return true;
  }

  function selectSchool(id: string | null) {
    // loading／目錄未就緒時不接受換校，避免略過草稿確認。
    if (!canCommitSchool(id)) return;
    if (hasCampusDraftActivity()) {
      if (id === (selectedSchool?.id ?? null)) return;
      setPendingSchoolId(id);
      return;
    }
    commitSchool(id);
  }

  return (
    <SelectedSchoolContext.Provider
      value={{
        schools: catalog,
        selectedSchool,
        selectedSchoolId: selectedSchool?.id ?? null,
        selectSchool,
        loading: loading || !hydrated,
        catalogStatus,
        catalogError,
        onRetryCatalog,
        selectionError: unavailable ? '先前選擇的校園不在目前目錄，請重新選擇。' : storageError,
        requestedUnavailable: unavailable,
      }}
    >
      {children}
      <ConfirmModal
        isOpen={pendingSwitch}
        onClose={() => setPendingSchoolId(undefined)}
        onConfirm={() => {
          if (pendingScope !== confirmationScope || pendingSchoolId === undefined) return;
          if (
            pendingSchoolId !== null &&
            !catalog.some((school) => school.id === pendingSchoolId)
          ) {
            setPendingSchoolId(undefined);
            return;
          }
          // 先確認可換校再捨棄草稿；無法 commit 時關閉確認、草稿保留。
          if (!canCommitSchool(pendingSchoolId)) {
            setPendingSchoolId(undefined);
            return;
          }
          discardActiveCampusDrafts();
          commitSchool(pendingSchoolId);
        }}
        title="切換校園？"
        message="目前校園還有未送出的草稿。保留在原校可繼續編輯；捨棄後才會切換到新校園，草稿不會帶到另一所學校。"
        confirmText="捨棄草稿並切換"
        cancelText="保留在原校"
        variant="warning"
      />
    </SelectedSchoolContext.Provider>
  );
}

export function useSelectedSchool() {
  const context = useContext(SelectedSchoolContext);
  if (!context) throw new Error('useSelectedSchool must be used within SelectedSchoolProvider');
  return context;
}

/** 沒有 SelectedSchoolProvider 時回傳 null（例如單獨測試頁面）。 */
export function useOptionalSelectedSchool() {
  return useContext(SelectedSchoolContext);
}
