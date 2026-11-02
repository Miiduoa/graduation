'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import { Suspense, useEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { CampusIntentControl, useCampusIntentCooldown } from '@/components/CampusIntentControl';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { useSignInOptions } from '@/lib/signInOptions';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { getQuickCampusActions } from '@/lib/quickCampusActions';
import styles from './search.module.css';
import {
  serviceAccessLabel,
  SERVICE_CATEGORIES,
  searchCampusServices,
  secondaryCampusServices,
  visibleCampusServices,
  type ServiceCategory,
} from '@/lib/campusServices';

function readFilters(params: URLSearchParams) {
  const category = params.get('category');
  return {
    query: (params.get('q') ?? '').slice(0, 100),
    category: SERVICE_CATEGORIES.some((item) => item.id === category)
      ? (category as ServiceCategory)
      : ('all' as const),
  };
}

function ServiceDirectory() {
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const params = useSearchParams();
  const { user } = useAuth();
  const uid = user?.uid || '';
  const searchInput = useRef<HTMLInputElement>(null);
  const schoolSearch = useCampusNavigationSearch(params);
  const selection = useOptionalSelectedSchool();
  const schoolId =
    selection && !selection.loading && selection.catalogStatus === 'ready'
      ? selection.selectedSchool?.id || ''
      : '';
  const selectionReady = Boolean(
    selection && !selection.loading && selection.catalogStatus === 'ready',
  );
  const draftSchoolId =
    selection?.selectedSchool?.id ||
    (selectionReady ? '' : params.get('campus') || params.get('schoolId') || '');
  const draftScope = JSON.stringify([uid, draftSchoolId]);
  const cooldown = useCampusIntentCooldown(draftScope);
  const semanticScope = JSON.stringify([
    draftScope,
    schoolSearch,
    schoolId,
    selection?.loading,
    selection?.catalogStatus,
  ]);
  const previousDraftScope = useRef(draftScope);
  const options = useSignInOptions();
  const queryString = params.toString();
  const [draft, setDraft] = useState(() => ({
    scope: draftScope,
    ...readFilters(new URLSearchParams(queryString)),
  }));
  const [draftRevision, setDraftRevision] = useState(0);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const [analysis, setAnalysis] = useState<{
    scope: string;
    term: string;
    revision: number;
    result: CampusSemanticResult;
  } | null>(null);
  useEffect(() => {
    const scopeChanged = previousDraftScope.current !== draftScope;
    previousDraftScope.current = draftScope;
    // A different account or campus starts a new draft, including on a return to an earlier scope.
    const filters = scopeChanged
      ? { query: '', category: 'all' as const }
      : readFilters(new URLSearchParams(queryString));
    if (scopeChanged) {
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      url.searchParams.delete('category');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setDraft({ scope: draftScope, ...filters });
    setAnalysis(null);
    setDraftRevision((value) => value + 1);
    setVoiceRevision((value) => value + 1);
  }, [queryString, draftScope, semanticScope]);
  const query = draft.scope === draftScope ? draft.query : '';
  const category = draft.scope === draftScope ? draft.category : 'all';
  const term = query.trim();
  const semantic =
    analysis?.scope === semanticScope &&
    analysis.term === term &&
    analysis.revision === draftRevision
      ? analysis.result
      : undefined;
  const matches = searchCampusServices(query, category, schoolLmsEnabled);
  const browsing = !term;
  const directoryCount = browsing
    ? matches.reduce(
        (total, service) =>
          total + 1 + secondaryCampusServices(service.href, schoolLmsEnabled).length,
        0,
      )
    : matches.length;
  const suggested =
    semantic?.status === 'understood'
      ? semantic.destinations.flatMap((href) => {
          const service = visibleCampusServices(schoolLmsEnabled).find((row) => row.href === href);
          return service ? [service] : [];
        })
      : getQuickCampusActions(query, schoolLmsEnabled).filter(
          (action) => !matches.some((match) => match.href === action.href),
        );

  function stopVoice() {
    setVoiceRevision((value) => value + 1);
  }
  function clearAnalysis() {
    setAnalysis(null);
    stopVoice();
  }
  function updateFilters(next: { query: string; category: ServiceCategory | 'all' }) {
    clearAnalysis();
    setDraftRevision((value) => value + 1);
    setDraft({ scope: draftScope, ...next });
    const url = new URL(window.location.href);
    if (next.query) url.searchParams.set('q', next.query);
    else url.searchParams.delete('q');
    if (next.category !== 'all') url.searchParams.set('category', next.category);
    else url.searchParams.delete('category');
    // Next.js observes native history changes without a server request per keystroke.
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  function resetFilters() {
    updateFilters({ query: '', category: 'all' });
    searchInput.current?.focus();
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
              key={`${semanticScope}:${voiceRevision}`}
              onTranscript={(text) => {
                const next = text.slice(0, 100);
                updateFilters({ query: next, category: 'all' });
              }}
            />
          </div>
          <p className={styles.voiceHelp}>
            語音只會填入文字，可先修改。需要雲端建議時，先核對傳送內容，再由你確認。語音辨識可能由瀏覽器供應商處理。
          </p>
          {term && (
            <CampusIntentControl
              key={`${semanticScope}:${draftRevision}`}
              uid={uid}
              schoolId={schoolId}
              utterance={term}
              cooldown={cooldown}
              onReview={stopVoice}
              onReset={clearAnalysis}
              onResult={(result) =>
                setAnalysis({
                  scope: semanticScope,
                  term,
                  revision: draftRevision,
                  result,
                })
              }
            />
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
        {term && suggested.length > 0 && (
          <section className={styles.smartResults} aria-label="根據需求推薦的服務">
            <h2>{semantic?.status === 'understood' ? 'AI 建議先開啟' : '你可能想做'}</h2>
            <div className={styles.smartGrid}>
              {suggested.map((action) => (
                <Link
                  key={action.href}
                  href={campusServiceHref(action.href, schoolSearch)}
                  className={styles.smartAction}
                >
                  <strong>{action.name}</strong>
                  <small>{action.text}</small>
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
