'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import { Suspense, useEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { useSignInOptions } from '@/lib/signInOptions';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { getQuickCampusActions } from '@/lib/quickCampusActions';
import styles from './search.module.css';
import {
  serviceAccessLabel,
  SERVICE_CATEGORIES,
  searchCampusServices,
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
  const requestSequence = useRef(0);
  useEffect(() => () => { requestSequence.current += 1; }, []);
  const schoolSearch = useCampusNavigationSearch(params);
  const options = useSignInOptions();
  const queryString = params.toString();
  const [{ query, category }, setFilters] = useState(() =>
    readFilters(new URLSearchParams(queryString)),
  );
  useEffect(() => {
    // Restore the URL state on history navigation or an external link to this directory.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(readFilters(new URLSearchParams(queryString)));
  }, [queryString]);
  const term = query.trim();
  const semanticScope = JSON.stringify([uid, schoolSearch]);
  const [analysis, setAnalysis] = useState<{
    scope: string;
    term: string;
    status: 'pending' | 'ready' | 'error';
    result?: CampusSemanticResult;
  } | null>(null);
  const active = analysis?.scope === semanticScope && analysis.term === term ? analysis : null;
  const semantic = active?.status === 'ready' ? active.result : undefined;
  const matches = searchCampusServices(query, category, schoolLmsEnabled);
  const suggested = semantic?.status === 'understood'
    ? semantic.destinations.flatMap((href) => {
        const service = visibleCampusServices(schoolLmsEnabled).find((row) => row.href === href);
        return service ? [service] : [];
      })
    : getQuickCampusActions(query, schoolLmsEnabled).filter(
        (action) => !matches.some((match) => match.href === action.href),
      );

  async function analyze(text: string) {
    const utterance = text.trim().slice(0, 100);
    if (!uid || !utterance) return;
    const request = ++requestSequence.current;
    const scope = semanticScope;
    setAnalysis({ scope, term: utterance, status: 'pending' });
    try {
      const result = await interpretCampusRequest({
        uid, schoolId: new URLSearchParams(schoolSearch).get('schoolId') || '',
        utterance,
      });
      if (request === requestSequence.current) {
        setAnalysis({ scope, term: utterance, status: 'ready', result });
      }
    } catch {
      if (request === requestSequence.current) {
        setAnalysis({ scope, term: utterance, status: 'error' });
      }
    }
  }
  function updateFilters(next: { query: string; category: ServiceCategory | 'all' }) {
    requestSequence.current += 1;
    setAnalysis(null);
    setFilters(next);
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
              onTranscript={(text) => {
                const next = text.slice(0, 100);
                updateFilters({ query: next, category: 'all' });
                if (uid) void analyze(next);
              }}
            />
          </div>
          <p className={styles.voiceHelp}>
            語音轉寫完成後，登入者會自動使用 AI 理解。文字可先修改再送出，任何服務操作都要自行確認。
          </p>
          {term && uid && (
            <button
              type="button"
              className={styles.aiButton}
              disabled={active?.status === 'pending'}
              onClick={() => void analyze(term)}
            >
              {active?.status === 'pending' ? 'AI 正在理解…' : '用 AI 理解需求'}
            </button>
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
                >
                  <strong>{action.name}</strong>
                  <small>{action.text}</small>
                  {semantic?.previews?.filter((preview) => preview.destination === action.href).map((preview) => (
                    <span className={styles.preview} key={preview.destination}>
                      <span>{preview.source === 'campus-platform' ? 'Campus One 資料' : '接通狀態'}：{preview.message}</span>
                      {preview.items.map((item, index) => (
                        <span key={index} className={styles.previewItem}>
                          {item.title}{item.detail ? ' · ' + item.detail : ''}
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
            找到 {matches.length} 項服務
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
                  {services.map((service) => (
                    <Link
                      key={service.href}
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
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <section className={styles.empty}>
            <h2>{suggested.length ? '沒有完全相符的服務' : '沒有符合的服務'}</h2>
            <p>{suggested.length
              ? '你可以先使用上方推薦的入口，或調整關鍵字繼續找。'
              : '試試「課表」或「公車」等關鍵字，也可以清除篩選，查看所有服務。'}</p>
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
