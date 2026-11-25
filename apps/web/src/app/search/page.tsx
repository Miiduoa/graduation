'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useCampusFinderAccount, useCampusFinderDraftScope } from '@/lib/useCampusFinderAccount';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { findSchoolsByCode } from '@campus/shared/src/schools';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import {
  forgetDirectorySearch,
  rememberDirectorySearch,
  restoreDirectorySearch,
  expandedDirectorySections,
} from '@/lib/campusDirectorySearch';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { useSignInOptions } from '@/lib/signInOptions';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { CampusIcon } from '@/components/CampusIcon';
import { resolveCampusActions, getQuickCampusActions } from '@/lib/quickCampusActions';
import styles from './search.module.css';
import {
  serviceAccessLabel,
  SERVICE_CATEGORIES,
  searchCampusServices,
  secondaryCampusServices,
  countCampusSearchResults,
  groupCampusServiceEntries,
  writeCampusServiceFilters,
  readCampusServiceFilters,
  type ServiceCategory,
  type CampusService,
} from '@/lib/campusServices';

function filtersFromUrlOrSession(params: URLSearchParams, pathname: string, scope: string) {
  const fromUrl = readCampusServiceFilters(params);
  if (fromUrl.query || fromUrl.category !== 'all') return fromUrl;
  const snapshot = restoreDirectorySearch('search', pathname, scope);
  if (!snapshot) return fromUrl;
  return { query: snapshot.query.slice(0, 100), category: snapshot.category };
}

function ServiceDirectory() {
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const params = useSearchParams();
  const account = useCampusFinderAccount();
  const selection = useOptionalSelectedSchool();
  const { uid, platformAudience } = account;
  const campusReady = !selection || (!selection.loading && selection.catalogStatus === 'ready');
  const canInterpret = account.canInterpret && campusReady;
  const canRemember = account.canRemember && campusReady;
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const compositionScope = useRef<string | null>(null);
  const directory = useRef<HTMLDivElement>(null);
  const [restoredExpanded, setRestoredExpanded] = useState<string[]>([]);
  const requestSequence = useRef(0);
  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );
  const schoolSearch = useCampusNavigationSearch(params);
  const options = useSignInOptions(undefined, true, 'school');
  const queryString = params.toString();
  const schoolParams = new URLSearchParams(schoolSearch);
  const requestedCampus = schoolParams.get('campus') || schoolParams.get('schoolId');
  const legacySchool = schoolParams.get('school') || '';
  const legacyMatches = findSchoolsByCode(legacySchool);
  const campusId = selection
    ? selection.selectedSchool?.id || ''
    : requestedCampus
      ? ['all', 'personal'].includes(requestedCampus)
        ? ''
        : requestedCampus
      : legacyMatches.length === 1
        ? legacyMatches[0].id
        : legacySchool;
  const storageScope = JSON.stringify([account.ownerScope, schoolSearch]);
  const draftScope = useCampusFinderDraftScope(account.ownerScope, campusReady ? campusId : null);
  const [confirmedScope, setConfirmedScope] = useState<string | null>(
    account.canRemember ? draftScope : null,
  );
  const restoredFilters = useRef<{ scope: string; queryString: string } | null>(null);
  const editedFilters = useRef<{
    scope: string;
    queryString: string;
  } | null>(null);
  const historyRestoration = useRef<{ scope: string; queryString: string } | null>(null);
  const [filters, setFilters] = useState(() => ({
    scope: draftScope,
    ...readCampusServiceFilters(new URLSearchParams(queryString)),
  }));
  const { query, category } =
    filters.scope === draftScope || confirmedScope === null
      ? filters
      : { query: '', category: 'all' as const };
  useLayoutEffect(() => {
    if (!account.canRemember) return;
    const changedOwner = confirmedScope !== null && confirmedScope !== draftScope;
    if (confirmedScope === null) {
      // Bind edits made during initial account resolution without treating them as an account switch.
      if (editedFilters.current) editedFilters.current.scope = draftScope;
      if (compositionScope.current !== null) compositionScope.current = draftScope;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters((current) =>
        current.scope === draftScope ? current : { ...current, scope: draftScope },
      );
    }
    setConfirmedScope(draftScope);
    if (changedOwner) {
      editedFilters.current = null;
      historyRestoration.current = null;
      compositionScope.current = null;
      forgetDirectorySearch('search');
      const url = new URL(window.location.href);
      writeCampusServiceFilters(url.searchParams, '', 'all');
      try {
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        // The current input is still cleared when History access is unavailable.
      }
      restoredFilters.current = { scope: draftScope, queryString };
      setFilters({ scope: draftScope, query: '', category: 'all' });
      setRestoredExpanded([]);
      return;
    }
    if (!campusReady) return;
    const restoring = historyRestoration.current;
    if (restoring?.scope === draftScope) {
      // A real Back/Forward traversal wins over queued acknowledgements of earlier typing.
      if (
        new URLSearchParams(window.location.search).toString() === restoring.queryString &&
        queryString !== restoring.queryString
      )
        return;
      historyRestoration.current = null;
    }
    if (
      restoredFilters.current?.scope === draftScope &&
      restoredFilters.current.queryString === queryString
    )
      return;
    restoredFilters.current = { scope: draftScope, queryString };
    const edited = editedFilters.current;
    // Router rendering can lag any number of keystrokes. While the browser is still at
    // our latest published URL, an older acknowledgement cannot replace the current draft.
    // External navigation changes that URL; Back/Forward is handled separately above.
    if (
      edited?.scope === draftScope &&
      new URLSearchParams(window.location.search).toString() === edited.queryString
    )
      return;
    editedFilters.current = null;
    // First arrival keeps an explicitly shared URL; later returns require the same account/campus.
    const next = filtersFromUrlOrSession(
      new URLSearchParams(queryString),
      window.location.pathname || '/search',
      storageScope,
    );
    setFilters({ scope: draftScope, ...next });
    setRestoredExpanded(
      restoreDirectorySearch('search', window.location.pathname || '/search', storageScope)
        ?.expanded ?? [],
    );
  }, [account.canRemember, campusReady, confirmedScope, draftScope, queryString, storageScope]);
  const term = query.trim();
  const semanticScope = JSON.stringify([
    account.responseScope,
    schoolSearch,
    Boolean(selection?.loading),
    selection?.catalogStatus,
  ]);
  const currentScope = useRef(semanticScope);
  const [analysis, setAnalysis] = useState<{
    scope: string;
    term: string;
    status: 'pending' | 'ready' | 'error';
    result?: CampusSemanticResult;
  } | null>(null);
  useLayoutEffect(() => {
    currentScope.current = semanticScope;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnalysis(null);
    return () => {
      requestSequence.current += 1;
    };
  }, [semanticScope]);
  useEffect(() => {
    function restoreHistoryFilters() {
      if (window.location.pathname !== '/search') return;
      const restored = new URLSearchParams(window.location.search);
      const source = restored.toString();
      const next = readCampusServiceFilters(restored);
      const expanded = canRemember
        ? (restoreDirectorySearch('search', '/search', storageScope)?.expanded ?? [])
        : [];
      requestSequence.current += 1;
      compositionScope.current = null;
      setAnalysis(null);
      // An empty history entry is intentionally empty, even if a session draft exists.
      historyRestoration.current = { scope: draftScope, queryString: source };
      editedFilters.current = { scope: draftScope, queryString: source };
      setFilters({ scope: draftScope, ...next });
      setRestoredExpanded(expanded);
      if (canRemember) {
        rememberDirectorySearch('search', {
          path: '/search',
          destination: '/search',
          ...next,
          open: false,
          scope: storageScope,
          expanded,
        });
      } else {
        forgetDirectorySearch('search');
      }
    }
    window.addEventListener('popstate', restoreHistoryFilters);
    return () => window.removeEventListener('popstate', restoreHistoryFilters);
  }, [canRemember, draftScope, storageScope]);
  const active = analysis?.scope === semanticScope && analysis.term === term ? analysis : null;
  const semantic = active?.status === 'ready' ? active.result : undefined;
  const matches = searchCampusServices(query, category, schoolLmsEnabled);
  const browsing = !term;
  const assistantHref = campusServiceHref(
    '/ai-assistant?q=' + encodeURIComponent(term),
    schoolSearch,
  );
  const directoryCount = countCampusSearchResults(matches, browsing, schoolLmsEnabled);
  const suggested =
    semantic?.status === 'understood'
      ? resolveCampusActions(semantic.destinations, schoolLmsEnabled)
      : getQuickCampusActions(
          query,
          schoolLmsEnabled,
          platformAudience ? 'platform' : 'school',
        ).filter((action) => !matches.some((match) => match.href === action.href));

  async function analyze(text: string) {
    const utterance = text.trim().slice(0, 100);
    if (!canInterpret || !utterance) return;
    const request = ++requestSequence.current;
    const scope = semanticScope;
    setAnalysis({ scope, term: utterance, status: 'pending' });
    try {
      const result = await interpretCampusRequest({
        uid,
        schoolId: new URLSearchParams(schoolSearch).get('schoolId') || '',
        utterance,
      });
      if (request === requestSequence.current && currentScope.current === scope) {
        setAnalysis({ scope, term: utterance, status: 'ready', result });
      }
    } catch {
      if (request === requestSequence.current && currentScope.current === scope) {
        setAnalysis({ scope, term: utterance, status: 'error' });
      }
    }
  }
  function updateFilters(
    next: { query: string; category: ServiceCategory | 'all' },
    persist = true,
  ) {
    requestSequence.current += 1;
    setAnalysis(null);
    setFilters({ scope: draftScope, ...next });
    const url = new URL(window.location.href);
    const currentQuery = url.searchParams.toString();
    writeCampusServiceFilters(url.searchParams, next.query, next.category);
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const shouldPublish =
      persist &&
      destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`;
    editedFilters.current = {
      scope: draftScope,
      queryString: shouldPublish ? url.searchParams.toString() : currentQuery,
    };
    historyRestoration.current = null;
    if (shouldPublish) {
      try {
        // Next copies its own routing state; passing that private state back skips URL sync.
        window.history.replaceState(null, '', destination);
      } catch {
        // Keep the draft through account/campus resolution even when History access is denied.
        editedFilters.current.queryString = currentQuery;
      }
    }
    if (!persist) return;
    if (canRemember && (next.query || next.category !== 'all')) {
      rememberDirectorySearch('search', {
        path: '/search',
        destination: '/search',
        query: next.query,
        category: next.category,
        open: false,
        scope: storageScope,
      });
    } else {
      forgetDirectorySearch('search');
    }
  }
  function resetFilters() {
    setRestoredExpanded([]);
    updateFilters({ query: '', category: 'all' });
    searchInput.current?.focus();
  }
  function rememberLeaving(href: string) {
    if (!canRemember) return;
    rememberDirectorySearch('search', {
      path: '/search',
      destination: href,
      query,
      category,
      open: false,
      scope: storageScope,
      expanded: expandedDirectorySections(directory.current),
    });
  }
  function renderServiceLink(service: CampusService, secondary = false) {
    return (
      <Link
        key={service.href}
        className={`${styles.service}${secondary ? ` ${styles.secondaryService}` : ''}`}
        href={campusServiceHref(service.href, schoolSearch)}
        onClick={() => rememberLeaving(campusServiceHref(service.href, schoolSearch))}
      >
        <div>
          <h3>{service.name}</h3>
          <p>{service.text}</p>
          <small className={styles.access}>{serviceAccessLabel(service.access, options)}</small>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
    );
  }
  function renderService(service: CampusService) {
    const children = browsing ? secondaryCampusServices(service.href, schoolLmsEnabled) : [];
    return (
      <div key={service.href} className={styles.serviceEntry}>
        {renderServiceLink(service)}
        {children.length > 0 && (
          <details
            className={styles.related}
            data-directory-section={`service:${service.href}`}
            open={restoredExpanded.includes(`service:${service.href}`) || undefined}
          >
            <summary aria-label={`${service.name}的相關服務`}>
              相關服務 <span>{children.length}</span>
            </summary>
            {children.map((child) => renderServiceLink(child, true))}
          </details>
        )}
      </div>
    );
  }
  return (
    <SiteShell title="所有服務" subtitle="先選常用服務，或直接搜尋你要做的事。">
      <div ref={directory} className={styles.directory}>
        <form
          className={styles.searchPanel}
          role="search"
          aria-label="尋找服務"
          onSubmit={(event) => {
            event.preventDefault();
            if (compositionScope.current !== null) return;
            resultsHeading.current?.focus();
          }}
        >
          <label htmlFor="service-search">想找什麼？</label>
          <div className={styles.queryRow}>
            <div className={styles.queryField}>
              <CampusIcon name="search" size={21} />
              <input
                ref={searchInput}
                id="service-search"
                className={styles.searchInput}
                type="search"
                value={query}
                maxLength={100}
                autoComplete="off"
                enterKeyHint="search"
                placeholder="借書、教室、公車…"
                aria-describedby="service-search-help"
                aria-controls="service-search-results"
                onChange={(event) =>
                  updateFilters(
                    { query: event.target.value, category },
                    compositionScope.current === null,
                  )
                }
                onCompositionStart={() => {
                  compositionScope.current = draftScope;
                }}
                onCompositionEnd={(event) => {
                  const scope = compositionScope.current;
                  compositionScope.current = null;
                  if (scope === draftScope)
                    updateFilters({ query: event.currentTarget.value, category });
                }}
                onKeyDown={(event) => {
                  const composing =
                    event.nativeEvent.isComposing || compositionScope.current !== null;
                  if (event.key === 'Enter' && (composing || event.keyCode === 229)) {
                    event.preventDefault();
                  }
                  if (event.key === 'Escape' && !composing && query) {
                    event.preventDefault();
                    updateFilters({ query: '', category });
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  className={styles.clearSearch}
                  aria-label="清除搜尋"
                  onClick={() => {
                    updateFilters({ query: '', category });
                    searchInput.current?.focus();
                  }}
                >
                  清除
                </button>
              )}
            </div>
            <div className={styles.queryActions}>
              <VoiceDictationButton
                onTranscript={(text) => {
                  const next = text.slice(0, 100);
                  updateFilters({ query: next, category: 'all' });
                  if (canInterpret) void analyze(next);
                }}
              />
              <button type="submit" className={styles.searchSubmit}>
                查看結果
              </button>
            </div>
          </div>
          <p id="service-search-help" className={styles.searchHint}>
            輸入服務名稱或想做的事，按 Enter 查看結果。
          </p>
          <div className={styles.filters} role="group" aria-label="服務分類">
            {[{ id: 'all', label: '全部' }, ...SERVICE_CATEGORIES].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={category === item.id}
                aria-controls="service-search-results"
                onClick={() =>
                  updateFilters({ query, category: item.id as ServiceCategory | 'all' })
                }
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className={styles.voiceHelp}>
            {!campusReady
              ? selection?.catalogStatus === 'error'
                ? '暫時無法確認校園；關鍵字與分類搜尋仍可使用，重新確認校園後再分析需求。'
                : '正在確認校園；關鍵字與分類搜尋仍可使用，輸入的文字會保留。'
              : canInterpret
                ? '語音完成後會分析服務需求；打字可修改後再按「用 AI 理解需求」。若要接著處理任務，可交給校園助理。'
                : account.status === 'checking'
                  ? '正在確認帳號；關鍵字與分類搜尋仍可使用。'
                  : account.status === 'signing-out'
                    ? '正在確認登出狀態；公開服務仍可搜尋。'
                    : account.status === 'error'
                      ? '暫時無法確認帳號；公開服務仍可搜尋，請重新確認登入狀態後使用助理。'
                      : platformAudience
                        ? '輸入或語音轉寫後會搜尋服務；也可以把這段需求帶入校園助理，檢查後再送出。'
                        : '輸入或語音轉寫後會搜尋服務；登入 Google 或學校帳號後，可使用校園助理。'}
          </p>
          {term && (canInterpret || (campusReady && account.canUseAssistant)) && (
            <div className={styles.assistantActions}>
              {canInterpret && (
                <button
                  type="button"
                  className={styles.aiButton}
                  disabled={active?.status === 'pending'}
                  onClick={() => void analyze(term)}
                >
                  {active?.status === 'pending' ? 'AI 正在理解…' : '用 AI 理解需求'}
                </button>
              )}
              {campusReady && account.canUseAssistant && (
                <Link
                  className={styles.assistantLink}
                  href={assistantHref}
                  onClick={() => rememberLeaving(assistantHref)}
                >
                  交給校園助理
                </Link>
              )}
            </div>
          )}
        </form>
        <div id="service-search-results" className={styles.results}>
          <div className={styles.resultSummary}>
            <div>
              <h2 ref={resultsHeading} tabIndex={-1} className={styles.resultTitle}>
                {term || category !== 'all' ? '搜尋結果' : '服務目錄'}
              </h2>
              <p role="status" aria-live="polite" aria-atomic="true">
                找到 {directoryCount} 項服務
              </p>
              {browsing && category === 'all' && (
                <p className={styles.browseHelp}>先顯示常用入口，其餘服務可在各分類展開。</p>
              )}
            </div>
            {(term || category !== 'all') && (
              <button type="button" onClick={resetFilters}>
                清除篩選
              </button>
            )}
          </div>
          {semantic?.source === 'model' && (
            <section className={styles.smartResults} aria-label="AI 對搜尋需求的理解">
              <h2>{semantic.status === 'clarify' ? '需要再確認' : 'AI 理解的需求'}</h2>
              <p>{semantic.summary}</p>
              {semantic.clarifyingQuestion && <p>{semantic.clarifyingQuestion}</p>}
            </section>
          )}
          {(active?.status === 'error' || semantic?.status === 'unavailable') && (
            <p role="status" className={styles.voiceHelp}>
              AI 暫時無法理解，目前只顯示基本關鍵字搜尋結果。
            </p>
          )}
          {term && suggested.length > 0 && (
            <section className={styles.smartResults} aria-label="根據需求推薦的服務">
              <h2>{semantic?.status === 'understood' ? 'AI 建議先開啟' : '你可能想做'}</h2>
              <div className={styles.smartGrid}>
                {suggested.map((action) => (
                  <Link
                    key={action.href}
                    href={campusServiceHref(action.href, schoolSearch)}
                    className={styles.smartAction}
                    onClick={() => rememberLeaving(campusServiceHref(action.href, schoolSearch))}
                  >
                    <strong>{action.name}</strong>
                    <small>{action.text}</small>
                    {semantic?.previews
                      ?.filter((preview) => preview.destination === action.destination)
                      .map((preview) => (
                        <span className={styles.preview} key={preview.destination}>
                          <span>
                            {preview.source === 'campus-platform' ? 'nuni 資料' : '接通狀態'}：
                            {preview.message}
                          </span>
                          {preview.items.map((item, index) => (
                            <span key={index} className={styles.previewItem}>
                              {item.title}
                              {item.detail ? ' · ' + item.detail : ''}
                            </span>
                          ))}
                        </span>
                      ))}
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
              <p>這些連結只會開啟對應功能，不會自動提交資料。AI 也不代表已查到即時校務狀態。</p>
            </section>
          )}
          {options.error && (
            <div role="alert">
              <p>暫時無法確認學校登入方式，公開資訊仍可瀏覽。</p>
              <button type="button" className="btn" onClick={options.retry}>
                重新確認登入方式
              </button>
            </div>
          )}
          {matches.length ? (
            SERVICE_CATEGORIES.map((group) => {
              const services = matches.filter((service) => service.category === group.id);
              if (!services.length) return null;
              const entries = groupCampusServiceEntries(
                services,
                group.id,
                browsing && category === 'all',
              );
              return (
                <section
                  className={styles.category}
                  key={group.id}
                  aria-labelledby={`category-${group.id}`}
                >
                  <div className={styles.categoryHeading}>
                    <h2 id={`category-${group.id}`}>{group.label}</h2>
                    <p>{group.description}</p>
                  </div>
                  <div className={styles.categoryContent}>
                    <div className={styles.services}>{entries.primary.map(renderService)}</div>
                    {entries.more.length > 0 && (
                      <details
                        className={styles.moreServices}
                        data-directory-section={`group:${group.id}`}
                        open={restoredExpanded.includes(`group:${group.id}`) || undefined}
                      >
                        <summary>
                          更多{group.label}服務 <span>{entries.more.length}</span>
                        </summary>
                        <div className={styles.services}>{entries.more.map(renderService)}</div>
                      </details>
                    )}
                  </div>
                </section>
              );
            })
          ) : (
            <section className={styles.empty}>
              <h2>{suggested.length ? '沒有完全相符的服務' : '沒有符合的服務'}</h2>
              <p>
                {suggested.length
                  ? '你可以先使用上方推薦的入口，或調整關鍵字繼續找。'
                  : '試試「課表」或「公車」等關鍵字，也可以清除篩選，查看所有服務。'}
              </p>
              <button type="button" className="btn primary" onClick={resetFilters}>
                查看所有服務
              </button>
            </section>
          )}
        </div>
      </div>
    </SiteShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p role="status">正在讀取服務…</p>}>
      <ServiceDirectory />
    </Suspense>
  );
}
