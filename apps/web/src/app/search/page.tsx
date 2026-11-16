'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useCampusFinderAccount } from '@/lib/useCampusFinderAccount';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import {
  forgetDirectorySearch,
  rememberDirectorySearch,
  restoreDirectorySearch,
} from '@/lib/campusDirectorySearch';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { useSignInOptions } from '@/lib/signInOptions';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { resolveCampusActions, getQuickCampusActions } from '@/lib/quickCampusActions';
import styles from './search.module.css';
import {
  serviceAccessLabel,
  SERVICE_CATEGORIES,
  searchCampusServices,
  secondaryCampusServices,
  countCampusSearchResults,
  writeCampusServiceFilters,
  readCampusServiceFilters,
  type ServiceCategory,
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
  const { uid, platformAudience, canInterpret } = account;
  const searchInput = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );
  const schoolSearch = useCampusNavigationSearch(params);
  const options = useSignInOptions();
  const queryString = params.toString();
  const draftScope = JSON.stringify([account.ownerScope, schoolSearch]);
  const [confirmedScope, setConfirmedScope] = useState<string | null>(
    account.canRemember ? draftScope : null,
  );
  const restoredFilters = useRef<{ scope: string; queryString: string } | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmedScope(draftScope);
    if (changedOwner) {
      forgetDirectorySearch('search');
      const url = new URL(window.location.href);
      writeCampusServiceFilters(url.searchParams, '', 'all');
      try {
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      } catch {
        // The current input is still cleared when History access is unavailable.
      }
      restoredFilters.current = { scope: draftScope, queryString };
      setFilters({ scope: draftScope, query: '', category: 'all' });
      return;
    }
    if (
      restoredFilters.current?.scope === draftScope &&
      restoredFilters.current.queryString === queryString
    )
      return;
    restoredFilters.current = { scope: draftScope, queryString };
    // First arrival keeps an explicitly shared URL; later returns require the same account/campus.
    const next = filtersFromUrlOrSession(
      new URLSearchParams(queryString),
      window.location.pathname || '/search',
      draftScope,
    );
    setFilters({ scope: draftScope, ...next });
  }, [account.canRemember, confirmedScope, draftScope, queryString]);
  const term = query.trim();
  const semanticScope = JSON.stringify([account.responseScope, schoolSearch]);
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
  function updateFilters(next: { query: string; category: ServiceCategory | 'all' }) {
    requestSequence.current += 1;
    setAnalysis(null);
    setFilters({ scope: draftScope, ...next });
    const url = new URL(window.location.href);
    writeCampusServiceFilters(url.searchParams, next.query, next.category);
    try {
      // Next.js observes native history changes without a server request per keystroke.
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // The visible filters still work when the browser denies History access.
    }
    if (account.canRemember && (next.query || next.category !== 'all')) {
      rememberDirectorySearch('search', {
        path: '/search',
        destination: '/search',
        query: next.query,
        category: next.category,
        open: false,
        scope: draftScope,
      });
    } else {
      forgetDirectorySearch('search');
    }
  }
  function resetFilters() {
    updateFilters({ query: '', category: 'all' });
    searchInput.current?.focus();
  }
  function rememberLeaving(href: string) {
    if (!account.canRemember) return;
    rememberDirectorySearch('search', {
      path: '/search',
      destination: href,
      query,
      category,
      open: false,
      scope: draftScope,
    });
  }
  return (
    <SiteShell
      title="所有服務"
      subtitle="搜尋要做的事，或依分類查找。學校帳號與 Google 帳號可使用的服務不同。"
    >
      <div className={styles.directory}>
        <form
          className={styles.searchPanel}
          role="search"
          aria-label="尋找服務"
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="service-search">想找什麼？</label>
          <div className={styles.queryRow}>
            <input
              ref={searchInput}
              id="service-search"
              className={styles.searchInput}
              type="search"
              value={query}
              maxLength={100}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="說出需求，例如：圖書館怎麼走？"
              onChange={(event) => updateFilters({ query: event.target.value, category })}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                  event.preventDefault();
                  updateFilters({ query: '', category });
                }
              }}
            />
            <VoiceDictationButton
              onTranscript={(text) => {
                const next = text.slice(0, 100);
                updateFilters({ query: next, category: 'all' });
                if (canInterpret) void analyze(next);
              }}
            />
          </div>
          <p className={styles.voiceHelp}>
            {canInterpret
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
          {term && canInterpret && (
            <button
              type="button"
              className={styles.aiButton}
              disabled={active?.status === 'pending'}
              onClick={() => void analyze(term)}
            >
              {active?.status === 'pending' ? 'AI 正在理解…' : '用 AI 理解需求'}
            </button>
          )}
          {term && account.canUseAssistant && (
            <Link
              className={!canInterpret ? styles.aiButton : undefined}
              href={assistantHref}
              onClick={() => rememberLeaving(assistantHref)}
            >
              交給校園助理
            </Link>
          )}
          <div className={styles.filters} role="group" aria-label="服務分類">
            {[{ id: 'all', label: '全部' }, ...SERVICE_CATEGORIES].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={category === item.id}
                onClick={() =>
                  updateFilters({ query, category: item.id as ServiceCategory | 'all' })
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </form>
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
        <div className={styles.resultSummary}>
          <p role="status" aria-live="polite" aria-atomic="true">
            找到 {directoryCount} 項服務
          </p>
          {(term || category !== 'all') && (
            <button type="button" onClick={resetFilters}>
              清除篩選
            </button>
          )}
        </div>
        {matches.length ? (
          SERVICE_CATEGORIES.map((group) => {
            const services = matches.filter((service) => service.category === group.id);
            if (!services.length) return null;
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
                <div className={styles.services}>
                  {services.map((service) => {
                    const children = browsing
                      ? secondaryCampusServices(service.href, schoolLmsEnabled)
                      : [];
                    return (
                      <div key={service.href} className={styles.serviceEntry}>
                        <Link
                          className={styles.service}
                          href={campusServiceHref(service.href, schoolSearch)}
                          onClick={() =>
                            rememberLeaving(campusServiceHref(service.href, schoolSearch))
                          }
                        >
                          <div>
                            <h3>{service.name}</h3>
                            <p>{service.text}</p>
                            <small className={styles.access}>
                              {serviceAccessLabel(service.access, options)}
                            </small>
                          </div>
                          <span aria-hidden="true">→</span>
                        </Link>
                        {children.map((child) => (
                          <Link
                            key={child.href}
                            className={`${styles.service} ${styles.secondaryService}`}
                            href={campusServiceHref(child.href, schoolSearch)}
                            onClick={() =>
                              rememberLeaving(campusServiceHref(child.href, schoolSearch))
                            }
                          >
                            <div>
                              <h3>{child.name}</h3>
                              <p>{child.text}</p>
                              <small className={styles.access}>
                                {serviceAccessLabel(child.access, options)}
                              </small>
                            </div>
                            <span aria-hidden="true">→</span>
                          </Link>
                        ))}
                      </div>
                    );
                  })}
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
