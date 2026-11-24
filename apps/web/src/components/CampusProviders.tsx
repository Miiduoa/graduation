'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { getDb } from '@/lib/firebase';
import { nuniRecord } from '@campus/shared/src/nuni';
import { NuniSessionProvider, useNuniSession } from '@/features/nuni/Session';
import { useAuth } from './AuthGuard';
import { campusDraftIdentity, CampusDraftProvider } from './CampusDraftProvider';
import {
  SelectedSchoolProvider,
  useSelectedSchool,
  type BrowseSchool,
} from './SelectedSchoolProvider';
import { DirectoryVisitProvider } from './DirectoryVisit';
import { PersonalImportSyncBridge } from './imports/PersonalImportSync';

type Catalog = { schools: BrowseSchool[]; status: 'loading' | 'ready' | 'error' };
const CATALOG_RETRY_DELAY_MS = 4_000;
const ACCOUNT_SCHOOL_TIMEOUT_MS = 6_000;

function catalogRetryDelayMs(retryAfter: string | null) {
  if (!retryAfter) return CATALOG_RETRY_DELAY_MS;
  const header = retryAfter.trim();
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? CATALOG_RETRY_DELAY_MS : Math.max(0, at - Date.now());
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function directoryText(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function directoryTerms(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => directoryText(entry) || [])
    : undefined;
}

async function loadCatalog(): Promise<BrowseSchool[]> {
  const response = await fetch('/api/schools', {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw Object.assign(new Error('Directory unavailable'), {
      retryAfter: response.headers.get('Retry-After'),
    });
  }
  const value = nuniRecord(await response.json());
  if (!Array.isArray(value.schools) || value.schools.length > 500)
    throw new Error('Invalid directory');
  return value.schools.map((raw): BrowseSchool => {
    const school = nuniRecord(raw);
    if (
      typeof school.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(school.id) ||
      typeof school.name !== 'string' ||
      !school.name.trim() ||
      school.name.length > 160
    )
      throw new Error('Invalid school');
    return {
      id: school.id,
      name: school.name,
      shortName: directoryText(school.shortName),
      code: directoryText(school.code),
      aliases: directoryTerms(school.aliases),
      domains: directoryTerms(school.domains),
      ...(school.status === 'open' || school.status === 'not-open'
        ? { status: school.status }
        : {}),
    };
  });
}

function SchoolPreferences({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const nuni = useNuniSession();
  const uid = auth.user?.uid;
  const accountScope = useMemo(() => ({ uid, loading: auth.loading }), [uid, auth.loading]);
  const [accountSchool, setAccountSchool] = useState<{
    scope: typeof accountScope;
    schoolId: string | null;
  } | null>(null);
  useEffect(() => {
    if (auth.loading || !uid) return;
    let active = true;
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      setAccountSchool({ scope: accountScope, schoolId: null });
    }, ACCOUNT_SCHOOL_TIMEOUT_MS);
    // 只取既有所屬學校作為瀏覽預設，不作為入學或授權證明。
    void (async () => {
      let schoolId: string | null = null;
      try {
        const profile = await getDoc(doc(getDb(), 'users', uid));
        for (const field of ['schoolId', 'primarySchoolId']) {
          const value: unknown = profile.get(field);
          const publicId = typeof value === 'string' ? toPublicSchoolId(value) : null;
          if (publicId && /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(publicId)) {
            schoolId = publicId;
            break;
          }
        }
      } catch {
        // 讀取失敗仍可手動選擇瀏覽校園。
      }
      clearTimeout(timeout);
      if (active) setAccountSchool({ scope: accountScope, schoolId });
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [auth.loading, uid, accountScope]);
  const accountSchoolReady = !uid || accountSchool?.scope === accountScope;
  const [catalog, setCatalog] = useState<Catalog>({ schools: [], status: 'loading' });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    setCatalog((previous) => ({ ...previous, status: 'loading' }));
    try {
      const schools = await loadCatalog();
      if (run === generation.current) setCatalog({ schools, status: 'ready' });
    } catch (error) {
      if (run !== generation.current) return;
      setCatalog({ schools: [], status: 'error' });
      const retryAfter =
        error && typeof error === 'object' && 'retryAfter' in error
          ? ((error as { retryAfter?: unknown }).retryAfter ?? null)
          : null;
      await wait(catalogRetryDelayMs(typeof retryAfter === 'string' ? retryAfter : null));
      if (run !== generation.current) return;
      try {
        const schools = await loadCatalog();
        if (run === generation.current) setCatalog({ schools, status: 'ready' });
      } catch {
        if (run === generation.current) setCatalog({ schools: [], status: 'error' });
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      ++generation.current;
    };
  }, [refresh]);
  const owner =
    auth.user || nuni.session
      ? `${auth.user?.uid || ''}|${nuni.session?.platformAccountId || ''}`
      : null;
  return (
    <SelectedSchoolProvider
      ownerKey={owner}
      accountSchoolId={uid && accountSchool?.scope === accountScope ? accountSchool.schoolId : null}
      loading={auth.loading || nuni.loading}
      accountSchoolPending={!accountSchoolReady}
      identityReady={!auth.loading && !nuni.loading && !nuni.error && !nuni.pendingLogout}
      schools={catalog.schools}
      catalogStatus={catalog.status}
      catalogError="目前無法取得校園目錄，請重新讀取。"
      onRetryCatalog={() => void refresh()}
    >
      <CampusDraftMount>
        <PersonalImportSyncBridge />
        {children}
      </CampusDraftMount>
    </SelectedSchoolProvider>
  );
}

function CampusDraftMount({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const school = useSelectedSchool();
  const nuni = useNuniSession();
  const ready = !school.loading && school.catalogStatus === 'ready';
  const owner = campusDraftIdentity(auth.user?.uid, nuni.session?.platformAccountId);
  const identityReady = !auth.loading && !nuni.loading && !nuni.error && !nuni.pendingLogout;
  const visitBlocked = auth.error || nuni.error || nuni.pendingLogout || school.catalogStatus === 'error';
  const visitScope = visitBlocked ? null : ready && identityReady
    ? JSON.stringify([owner, school.selectedSchoolId]) : undefined;
  // 身分未確認時隱藏草稿；校園目錄重讀仍保留同帳號的編輯內容。
  return (
    <CampusDraftProvider
      uid={owner}
      identityReady={identityReady}
      schoolId={school.selectedSchoolId}
      ready={ready}
    >
      <DirectoryVisitProvider scope={visitScope}>
        {children}
      </DirectoryVisitProvider>
    </CampusDraftProvider>
  );
}

export function CampusProviders({ children }: { children: ReactNode }) {
  return (
    <NuniSessionProvider>
      <Suspense fallback={<p role="status">正在載入校園…</p>}>
        <SchoolPreferences>{children}</SchoolPreferences>
      </Suspense>
    </NuniSessionProvider>
  );
}
