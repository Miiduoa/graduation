'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { nuniRecord } from '@campus/shared/src/nuni';
import { NuniSessionProvider, useNuniSession } from '@/features/nuni/Session';
import { useAuth } from './AuthGuard';
import { SelectedSchoolProvider, type BrowseSchool } from './SelectedSchoolProvider';
import { PersonalImportSyncBridge } from './imports/PersonalImportSync';

type Catalog = { schools: BrowseSchool[]; status: 'loading' | 'ready' | 'error' };
const CATALOG_RETRY_DELAY_MS = 4_000;

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
      ...(school.status === 'open' || school.status === 'not-open'
        ? { status: school.status }
        : {}),
    };
  });
}

function SchoolPreferences({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const nuni = useNuniSession();
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
      loading={auth.loading || nuni.loading}
      schools={catalog.schools}
      catalogStatus={catalog.status}
      catalogError="目前無法取得校園目錄，請重新讀取。"
      onRetryCatalog={() => void refresh()}
    >
      <PersonalImportSyncBridge />
      {children}
    </SelectedSchoolProvider>
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
