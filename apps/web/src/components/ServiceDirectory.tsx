'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { CampusIcon } from './CampusIcon';
import { useSchoolLmsReadonlyEnabled } from './SchoolLmsReadonlyProvider';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { SERVICE_ACCESS, secondaryCampusServices, type CampusService } from '@/lib/campusServices';
import {
  SERVICE_JOURNEY_GROUPS,
  journeyServices,
  readJourneyFilters,
  serviceJourneyGroup,
  serviceJourneyIcon,
  writeJourneyFilters,
  type JourneyFilters,
  type ServiceJourney,
} from '@/lib/serviceJourneys';
import styles from './ServiceDirectory.module.css';

const DIRECTORY_RETURN_STATE = '__campusServiceDirectoryReturn';
type DirectoryReturn = {
  token: string;
  journey: ServiceJourney;
  url: string;
  scope: string;
  serviceHref: string;
};

let observedWindow: Window | undefined;
let pendingReturn: DirectoryReturn | null = null;
let returnSequence = 0;
const returnListeners = new Set<() => void>();

function directoryReturnState(state: unknown): DirectoryReturn | null {
  if (!state || typeof state !== 'object') return null;
  const saved = (state as Record<string, unknown>)[DIRECTORY_RETURN_STATE];
  if (!saved || typeof saved !== 'object') return null;
  const value = saved as Partial<DirectoryReturn>;
  return typeof value.token === 'string' &&
    (value.journey === 'life' || value.journey === 'connect') &&
    typeof value.url === 'string' &&
    typeof value.scope === 'string' &&
    typeof value.serviceHref === 'string'
    ? (value as DirectoryReturn)
    : null;
}

function currentDirectoryUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function publishDirectoryReturn(value: DirectoryReturn | null) {
  pendingReturn = value;
  returnListeners.forEach((listener) => listener());
}

function captureDirectoryReturn(event: PopStateEvent) {
  const saved = directoryReturnState(event.state);
  publishDirectoryReturn(saved?.url === currentDirectoryUrl() ? saved : null);
}

function subscribeDirectoryReturn(listener: () => void) {
  if (observedWindow !== window) {
    observedWindow?.removeEventListener('popstate', captureDirectoryReturn);
    observedWindow = window;
    pendingReturn = null;
    // The directory is unmounted while its service is open. Keep one observer
    // for the browser session; it records history returns but never moves focus.
    window.addEventListener('popstate', captureDirectoryReturn);
  }
  returnListeners.add(listener);
  return () => returnListeners.delete(listener);
}

const getPendingDirectoryReturn = () => pendingReturn;
const getServerDirectoryReturn = () => null;

function ServiceRow({
  service,
  scope,
  schoolLmsEnabled,
  showChildren,
  recommended,
  onVisit,
}: {
  service: CampusService;
  scope: string;
  schoolLmsEnabled: boolean;
  showChildren: boolean;
  recommended: boolean;
  onVisit: (event: MouseEvent<HTMLAnchorElement>, serviceHref: string) => void;
}) {
  const id = useId();
  const children = showChildren ? secondaryCampusServices(service.href, schoolLmsEnabled) : [];
  return (
    <li className={styles.serviceRow} data-recommended={recommended || undefined}>
      <Link
        className={styles.service}
        href={campusServiceHref(service.href, scope)}
        data-service-href={service.href}
        onClick={(event) => onVisit(event, service.href)}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-description ${id}-access`}
      >
        <span className={styles.icon} aria-hidden="true">
          <CampusIcon name={serviceJourneyIcon(service.href)} size={22} />
        </span>
        <div className={styles.serviceBody}>
          <div className={styles.serviceTitle}>
            <h3 id={`${id}-name`}>{service.name}</h3>
            {recommended && <span className={styles.recommended}>從這裡開始</span>}
          </div>
          <p id={`${id}-description`}>{service.text}</p>
          <span id={`${id}-access`} className={styles.access}>
            {SERVICE_ACCESS[service.access]}
          </span>
        </div>
        <CampusIcon name="arrow" size={18} />
      </Link>
      {children.length > 0 && (
        <details className={styles.related}>
          <summary aria-label={`${service.name}的其他入口`}>
            {children.map((child) => child.name).join('、')}
          </summary>
          <ul>
            {children.map((child, index) => (
              <li key={child.href}>
                <Link
                  href={campusServiceHref(child.href, scope)}
                  data-service-href={child.href}
                  onClick={(event) => onVisit(event, child.href)}
                  aria-label={child.name}
                  aria-describedby={`${id}-child-${index}`}
                >
                  <span>{child.name}</span>
                  <small id={`${id}-child-${index}`}>{SERVICE_ACCESS[child.access]}</small>
                  <CampusIcon name="arrow" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function ServiceDirectory({
  journey,
  introduction,
  recommendedHref,
}: {
  journey: ServiceJourney;
  introduction?: string;
  recommendedHref?: string;
}) {
  const params = useSearchParams();
  const queryString = params?.toString() || '';
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const scope = useCampusNavigationSearch(params);
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const directory = useRef<HTMLDivElement>(null);
  const historyReturn = useSyncExternalStore(
    subscribeDirectoryReturn,
    getPendingDirectoryReturn,
    getServerDirectoryReturn,
  );
  const [selection, setSelection] = useState(() => ({
    queryString,
    journey,
    filters: readJourneyFilters(new URLSearchParams(queryString), journey),
  }));
  const filters =
    selection.queryString === queryString && selection.journey === journey
      ? selection.filters
      : readJourneyFilters(new URLSearchParams(queryString), journey);
  if (selection.queryString !== queryString || selection.journey !== journey) {
    setSelection({ queryString, journey, filters });
  }
  const groups = SERVICE_JOURNEY_GROUPS[journey];
  const matches = journeyServices(journey, filters, schoolLmsEnabled);
  const filtering = Boolean(filters.query.trim() || filters.group !== 'all');
  const searching = Boolean(filters.query.trim());
  const resultsId = `${journey}-service-results`;

  useEffect(() => {
    if (
      !historyReturn ||
      getPendingDirectoryReturn() !== historyReturn ||
      historyReturn.journey !== journey
    )
      return;
    const current = directoryReturnState(window.history.state);
    if (
      current?.token !== historyReturn.token ||
      current.url !== currentDirectoryUrl() ||
      current.url !== historyReturn.url ||
      current.scope !== scope
    ) {
      publishDirectoryReturn(null);
      return;
    }
    // Wait for Next's search params and the rendered results to catch up with
    // popstate. A new entry, changed campus or edited filters cannot opt in.
    if (new URL(current.url, window.location.origin).searchParams.toString() !== queryString)
      return;
    const target = Array.from(
      directory.current?.querySelectorAll<HTMLAnchorElement>('a[data-service-href]') ?? [],
    ).find((link) => link.dataset.serviceHref === current.serviceHref);
    publishDirectoryReturn(null);
    if (!target) return;
    const parent = target.closest('details');
    if (parent) parent.open = true;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  }, [historyReturn, journey, queryString, schoolLmsEnabled, scope]);

  function rememberReturn(event: MouseEvent<HTMLAnchorElement>, serviceHref: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== '_self')
    )
      return;
    publishDirectoryReturn(null);
    try {
      window.history.replaceState(
        {
          ...window.history.state,
          [DIRECTORY_RETURN_STATE]: {
            token: `${Date.now()}-${++returnSequence}`,
            journey,
            url: currentDirectoryUrl(),
            scope,
            serviceHref,
          } satisfies DirectoryReturn,
        },
        '',
      );
    } catch {
      // Opening a service must still work if History access is unavailable.
    }
  }

  function updateFilters(next: JourneyFilters) {
    setSelection({ queryString, journey, filters: next });
    publishDirectoryReturn(null);
    try {
      const url = new URL(window.location.href);
      writeJourneyFilters(url.searchParams, next);
      const state = { ...window.history.state };
      delete state[DIRECTORY_RETURN_STATE];
      // Returning from a service restores the directory filters through browser history.
      window.history.replaceState(state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Search remains usable when the browser disallows history updates.
    }
  }

  function resetFilters() {
    updateFilters({ query: '', group: 'all' });
    search.current?.focus();
  }

  const renderServices = (services: readonly CampusService[]) => (
    <ul className={styles.serviceList}>
      {services.map((service) => (
        <ServiceRow
          key={service.href}
          service={service}
          scope={scope}
          schoolLmsEnabled={schoolLmsEnabled}
          showChildren={!searching}
          recommended={!filtering && recommendedHref === service.href}
          onVisit={rememberReturn}
        />
      ))}
    </ul>
  );

  return (
    <div ref={directory} className={styles.directory}>
      {introduction && <p className={styles.introduction}>{introduction}</p>}
      <div className={styles.finder}>
        <form
          role="search"
          aria-label={journey === 'life' ? '生活服務搜尋' : '交流服務搜尋'}
          onSubmit={(event) => event.preventDefault()}
        >
          <label className={styles.searchLabel} htmlFor={`${id}-search`}>
            快速找服務
          </label>
          <div className={styles.searchField}>
            <CampusIcon name="search" size={21} />
            <input
              ref={search}
              id={`${id}-search`}
              type="search"
              value={filters.query}
              onChange={(event) => updateFilters({ ...filters, query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && filters.query) {
                  event.preventDefault();
                  updateFilters({ ...filters, query: '' });
                }
              }}
              placeholder={journey === 'life' ? '借書、公車、取餐…' : '話題、訊息、好友…'}
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
              aria-controls={resultsId}
            />
            {filters.query && (
              <button
                type="button"
                className={styles.clearSearch}
                aria-label="清除搜尋"
                onClick={() => {
                  updateFilters({ ...filters, query: '' });
                  search.current?.focus();
                }}
              >
                清除
              </button>
            )}
          </div>
        </form>
        <div className={styles.filterBar}>
          <div className={styles.categories} role="group" aria-label="服務分類">
            {[{ id: 'all', label: '全部' }, ...groups].map((group) => (
              <button
                key={group.id}
                type="button"
                aria-pressed={filters.group === group.id}
                aria-controls={resultsId}
                onClick={() => updateFilters({ ...filters, group: group.id })}
              >
                {group.label}
              </button>
            ))}
          </div>
          <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true">
            {filtering ? '找到' : '共'} {matches.length} 項服務
          </p>
        </div>
      </div>

      <div id={resultsId}>
        {filtering ? (
          <section aria-labelledby={`${id}-results-title`}>
            <div className={styles.sectionHeading}>
              <h2 id={`${id}-results-title`}>
                {searching ? '搜尋結果' : groups.find((group) => group.id === filters.group)?.label}
              </h2>
              <button type="button" className={styles.resetFilters} onClick={resetFilters}>
                顯示全部服務
              </button>
            </div>
            {matches.length > 0 ? (
              renderServices(matches)
            ) : (
              <div className={styles.emptyResults}>
                <CampusIcon name="search" size={26} />
                <h3>沒有找到符合的服務</h3>
                <p>換個關鍵字，或顯示全部服務再找一次。</p>
              </div>
            )}
          </section>
        ) : (
          <div className={styles.groups}>
            {groups.map((group) => {
              const services = matches.filter(
                (service) => serviceJourneyGroup(journey, service) === group.id,
              );
              if (services.length === 0) return null;
              return (
                <section key={group.id} aria-labelledby={`${id}-${group.id}`}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <h2 id={`${id}-${group.id}`}>{group.label}</h2>
                      <p>{group.description}</p>
                    </div>
                  </div>
                  {renderServices(services)}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
