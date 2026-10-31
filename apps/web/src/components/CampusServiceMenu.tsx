'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { CampusIcon } from './CampusIcon';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  visibleCampusServices,
  SERVICE_CATEGORIES,
  searchCampusServices,
  type ServiceCategory,
} from '@/lib/campusServices';
import { isWebOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from '@/lib/onlineOrdering';
import styles from './CampusServiceMenu.module.css';
import {
  campusServiceHref,
  campusServiceMatches,
  useCampusNavigationSearch,
} from '@/lib/campusNavigation';
import { primaryNavigationSection } from '@/lib/primaryNavigation';

const categoryLabels: Record<ServiceCategory, string> = {
  study: '課務',
  campus: '生活',
  connect: '交流',
  account: '帳號',
};

export function CampusServiceMenu() {
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const pathname = usePathname();
  const params = useSearchParams();
  const currentService = visibleCampusServices(schoolLmsEnabled).filter((service) =>
    campusServiceMatches(service.href, pathname, params),
  ).sort((first, second) => second.href.length - first.href.length)[0]?.href;
  const menu = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ServiceCategory | 'all'>('all');
  const id = useId();
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const element = menu.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    }
    function openSearch(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k' ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          )) ||
        document.querySelector('dialog[open]')
      )
        return;
      if (!menu.current || !search.current) return;
      event.preventDefault();
      menu.current.open = true;
      search.current.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', openSearch);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', openSearch);
    };
  }, []);
  const matches = searchCampusServices(query, category, schoolLmsEnabled);
  const filtering = !!query.trim() || category !== 'all';
  const context = useCampusNavigationSearch(params);
  const href = (path: string) => campusServiceHref(path, context);
  function closeMenu() {
    if (!menu.current?.open) return;
    menu.current.open = false;
    setQuery('');
    setCategory('all');
    menu.current.querySelector('summary')?.focus({ preventScroll: true });
  }
  function resetSearch() {
    setQuery('');
    setCategory('all');
    search.current?.focus({ preventScroll: true });
  }
  return (
    <details
      ref={menu}
      name="campus-navigation-popover"
      className={styles.menu}
      key={pathname}
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          setQuery('');
          setCategory('all');
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary
        aria-label="所有服務"
        aria-controls={`${id}-services`}
        aria-keyshortcuts="Control+k Meta+k"
        aria-current={primaryNavigationSection(pathname) === 'more' ? 'page' : undefined}
      >
        <CampusIcon name="services" size={17} />
        <span className={styles.desktopLabel} aria-hidden="true">
          所有服務
        </span>
        <span className={styles.mobileLabel} aria-hidden="true">
          更多
        </span>
      </summary>
      <div className={styles.menuPanel} id={`${id}-services`}>
        <div className={styles.menuHead}>
          <h2>校園服務</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="關閉所有服務"
            onClick={closeMenu}
          >
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.menuControls}>
          <label htmlFor={`${id}-query`} className={styles.searchLabel}>
            搜尋服務
          </label>
          <div className={styles.searchField}>
            <CampusIcon name="search" size={19} />
            <input
              ref={search}
              id={`${id}-query`}
              type="search"
              autoComplete="off"
              maxLength={100}
              value={query}
              placeholder="課表、借書、公車…"
              aria-controls={`${id}-results`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) {
                  const first =
                    results.current?.querySelector<HTMLAnchorElement>('[data-service-link]');
                  if (first) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className={styles.clearSearch}
                onClick={() => {
                  setQuery('');
                  search.current?.focus({ preventScroll: true });
                }}
              >
                清除
              </button>
            ) : (
              <kbd className={styles.shortcut}>⌘ / Ctrl K</kbd>
            )}
          </div>
          <div className={styles.filters} role="group" aria-label="快速篩選服務">
            <button
              type="button"
              aria-pressed={category === 'all'}
              onClick={() => setCategory('all')}
            >
              全部
            </button>
            {SERVICE_CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`篩選${item.label}`}
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {categoryLabels[item.id]}
              </button>
            ))}
          </div>
          {filtering && (
            <div className={styles.resultSummary}>
              <p role="status" aria-live="polite">
                找到 {matches.length} 項服務
              </p>
              <button type="button" onClick={resetSearch}>
                清除篩選
              </button>
            </div>
          )}
        </div>
        <div
          ref={results}
          className={`${styles.menuContents}${filtering ? ` ${styles.filteredContents}` : ''}`}
          id={`${id}-results`}
        >
          <Link
            href={href('/search')}
            className={styles.menuOverview}
            aria-current={pathname === '/search' ? 'page' : undefined}
            onClick={closeMenu}
          >
            尋找校園服務 <span aria-hidden="true">→</span>
          </Link>
          {SERVICE_CATEGORIES.map((group) => {
            const services = matches.filter((service) => service.category === group.id);
            if (!services.length) return null;
            return (
              <section key={group.id} className={styles.menuGroup} aria-label={group.label}>
                <h2>{group.label}</h2>
                {services.map((service) => (
                  <Link
                    data-service-link
                    href={href(service.href)}
                    key={service.href}
                    aria-label={service.name}
                    aria-describedby={
                      service.href === '/food' && !isWebOnlineOrderingEnabled()
                        ? `${id}-food-status`
                        : undefined
                    }
                    aria-current={currentService === service.href ? 'page' : undefined}
                    onClick={closeMenu}
                  >
                    <span className={styles.serviceName}>
                      {service.name}
                      {service.href === '/food' && !isWebOnlineOrderingEnabled() ? (
                        <small id={`${id}-food-status`}>{ONLINE_ORDERING_OFF_TEXT}</small>
                      ) : filtering ? (
                        <small>{service.text}</small>
                      ) : null}
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </section>
            );
          })}
          {!matches.length && (
            <section className={styles.noResults}>
              <h3>沒有符合的服務</h3>
              <p>試試「課表」或「公車」，也可以切回全部服務。</p>
              <button type="button" className="btn" onClick={resetSearch}>
                查看全部服務
              </button>
            </section>
          )}
        </div>
      </div>
    </details>
  );
}
