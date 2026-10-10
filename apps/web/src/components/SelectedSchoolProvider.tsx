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

export type BrowseSchool = {
  id: string;
  name: string;
  shortName?: string;
  code?: string;
  status?: 'open' | 'not-open';
};

export type SelectedSchoolProviderProps = {
  ownerKey: string | null;
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
};

const SelectedSchoolContext = createContext<SelectionContext | null>(null);

export function schoolPreferenceKey(ownerKey: string | null) {
  return `campus.browse-school.v1:${ownerKey === null ? 'guest' : `account:${encodeURIComponent(ownerKey)}`}`;
}

function storedSelection(value: string | null): string | null {
  if (!value) return null;
  try {
    const stored: unknown = JSON.parse(value);
    if (stored && typeof stored === 'object' && 'schoolId' in stored) {
      return typeof stored.schoolId === 'string' ? stored.schoolId : null;
    }
  } catch {
    // Invalid or old browser preferences do not establish a school selection.
  }
  return null;
}

export function SelectedSchoolProvider({
  ownerKey,
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
    storageError: string | null;
  } | null>(null);
  // Hide previous identity state immediately without remounting page content or losing drafts.
  const currentPreference = preference?.scope === scope ? preference : null;
  const hydrated = currentPreference !== null;
  const savedSchoolId = currentPreference?.schoolId ?? null;
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
      let storageError: string | null = null;
      try {
        schoolId = storedSelection(localStorage.getItem(storageKey));
      } catch {
        storageError = '此瀏覽器無法儲存校園偏好，仍可使用網址切換校園。';
      }
      // Read this browser-only preference after hydration so server markup stays account-neutral.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreference({ scope, schoolId, storageError });
    }
    const changed = (event: StorageEvent) => {
      if (!loading && (event.key === storageKey || event.key === null)) {
        setPreference((current) =>
          current?.scope === scope
            ? { ...current, schoolId: storedSelection(event.newValue) }
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
  const queryId = params?.get('campus');
  const requestedId = queryId === 'all' ? null : queryId || savedSchoolId;
  const ready = !loading && hydrated && catalogStatus === 'ready';
  const selectedSchool = ready
    ? (catalog.find((school) => school.id === requestedId) ?? null)
    : null;
  const unavailable = ready && requestedId !== null && selectedSchool === null;

  function selectSchool(id: string | null) {
    if (
      activeScope.current !== scope ||
      !ready ||
      (id !== null && !catalog.some((school) => school.id === id))
    )
      return;
    let storageError: string | null = null;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ schoolId: id }));
    } catch {
      storageError = '此瀏覽器無法儲存校園偏好，仍可使用網址切換校園。';
    }
    setPreference({ scope, schoolId: id, storageError });
    const next = new URLSearchParams(params?.toString());
    next.set('campus', id ?? 'all');
    // Browsing preference never writes school/schoolId, account claims or a school login.
    router.replace(`${pathname}?${next.toString()}${window.location.hash}`, { scroll: false });
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
      }}
    >
      {children}
    </SelectedSchoolContext.Provider>
  );
}

export function useSelectedSchool() {
  const context = useContext(SelectedSchoolContext);
  if (!context) throw new Error('useSelectedSchool must be used within SelectedSchoolProvider');
  return context;
}
