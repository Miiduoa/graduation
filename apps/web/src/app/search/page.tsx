'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { useSignInOptions } from '@/lib/signInOptions';
import styles from './search.module.css';
import {
  serviceAccessLabel,
  SERVICE_CATEGORIES,
  searchCampusServices,
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
  const params = useSearchParams();
  const searchInput = useRef<HTMLInputElement>(null);
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
  const matches = searchCampusServices(query, category);
  function updateFilters(next: { query: string; category: ServiceCategory | 'all' }) {
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
          <input
            ref={searchInput}
            id="service-search"
            className={styles.searchInput}
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="課表、借書、公車…"
            onChange={(event) => updateFilters({ query: event.target.value, category })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                event.preventDefault();
                updateFilters({ query: '', category });
              }
            }}
          />
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
            <h2>沒有符合的服務</h2>
            <p>試試「課表」或「公車」等關鍵字，也可以清除篩選，查看所有服務。</p>
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
