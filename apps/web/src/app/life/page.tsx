'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { SiteShell } from '@/components/SiteShell';
import { CampusIcon, type CampusIconName } from '@/components/CampusIcon';
import {
  visibleCampusServices,
  presentCampusService,
  SERVICE_ACCESS,
  type CampusService,
} from '@/lib/campusServices';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import {
  LIFE_QUERY_LIMIT,
  readLifeFilters,
  writeLifeFilters,
  type LifeServiceCategory,
} from './lifeFilters';
import styles from './life.module.css';

const GROUPS = [
  {
    id: 'travel',
    label: '交通與地點',
    title: '出門與交通',
    description: '找教室、查站牌，接著出發。',
  },
  { id: 'food', label: '餐飲', title: '吃飯與取餐', description: '先看菜單，決定這餐吃什麼。' },
  { id: 'daily', label: '日常', title: '住宿與日常', description: '宿舍、借書與需要處理的小事。' },
  {
    id: 'connect',
    label: '活動與交流',
    title: '安排課餘時間',
    description: '找活動、看消息，和同學保持聯繫。',
  },
] as const;

type LifeGroup = (typeof GROUPS)[number]['id'];
type LifeFilters = {
  query: string;
  category: LifeServiceCategory;
  group: LifeGroup | 'all';
  publicOnly: boolean;
  expanded: LifeGroup[];
};
const MAX_PENDING_FILTER_URLS = 32;

// 這裡只決定生活頁的排法；服務名稱、說明、權限及開關全部來自全站目錄。
const TRAVEL_PATHS = new Set(['/map', '/bus', '/school-info']);
const FOOD_PATHS = new Set(['/food', '/cafeteria', '/orders']);
const ICONS: Record<string, CampusIconName> = {
  '/map': 'map',
  '/bus': 'bus',
  '/food': 'cafeteria',
  '/cafeteria': 'cafeteria',
  '/orders': 'orders',
  '/library': 'library',
  '/dormitory': 'repair',
  '/lost-found': 'lost-found',
  '/student-card': 'profile',
  '/events': 'calendar',
  '/career': 'calendar',
  '/announcements': 'announcements',
  '/social': 'community',
  '/community': 'community',
  '/friends': 'friends',
};

function groupFor(service: CampusService): LifeGroup {
  if (TRAVEL_PATHS.has(service.href)) return 'travel';
  if (FOOD_PATHS.has(service.href)) return 'food';
  if (service.category === 'connect' || ['/events', '/clubs', '/career'].includes(service.href)) {
    return 'connect';
  }
  return 'daily';
}

function readFilters(params: URLSearchParams): LifeFilters {
  const requestedGroup = params.get('group');
  return {
    ...readLifeFilters(params),
    expanded: [...readExpanded(params)],
    group: GROUPS.some((item) => item.id === requestedGroup)
      ? (requestedGroup as LifeGroup)
      : 'all',
    publicOnly: params.get('access') === 'public',
  };
}

function readExpanded(params: URLSearchParams): Set<LifeGroup> {
  const requested = new Set((params.get('expanded') ?? '').split(','));
  return new Set(GROUPS.filter((group) => requested.has(group.id)).map((group) => group.id));
}

function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').trim();
}

function ServiceLink({ item, href }: { item: CampusService; href: string }) {
  return (
    <Link className={styles.service} href={href}>
      <span className={styles.icon} aria-hidden="true">
        <CampusIcon name={ICONS[item.href] ?? 'services'} size={22} />
      </span>
      <div className={styles.serviceBody}>
        <h3 className={styles.serviceTitle}>{item.name}</h3>
        <p className={styles.serviceDescription}>{item.text}</p>
        {item.href === '/food' && !isWebOnlineOrderingEnabled() && (
          <p className={styles.serviceDescription}>餐飲入口；線上點餐開放前可先看餐廳菜單。</p>
        )}
        <span className={styles.accessNote}>{SERVICE_ACCESS[item.access]}</span>
        {item.href === '/lost-found' && (
          <span className={styles.accessNote}>
            校內來源需使用學校帳號登入，查看或刊登遺失與拾獲物品。
          </span>
        )}
      </div>
      <span className={`${styles.arrow} ${styles.action}`} aria-hidden="true">
        <CampusIcon name="arrow" size={18} />
      </span>
    </Link>
  );
}

function LifeDirectory() {
  const searchInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const params = useSearchParams();
  const queryString = params.toString();
  const [filterState, setFilterState] = useState(() => ({
    source: queryString,
    filters: readFilters(new URLSearchParams(queryString)),
    pendingUrls: [] as string[],
  }));
  // A delayed acknowledgement of our own URL write must not replace a newer input draft.
  const acknowledgedIndex = filterState.pendingUrls.indexOf(queryString);
  const filters =
    filterState.source === queryString || acknowledgedIndex >= 0
      ? filterState.filters
      : readFilters(new URLSearchParams(queryString));
  if (filterState.source !== queryString) {
    setFilterState({
      source: queryString,
      filters,
      // Other history entries and campus switches remain authoritative.
      pendingUrls:
        acknowledgedIndex >= 0 ? filterState.pendingUrls.slice(acknowledgedIndex + 1) : [],
    });
  }
  useEffect(() => {
    function restoreHistoryFilters() {
      const restored = new URLSearchParams(window.location.search);
      const source = restored.toString();
      setFilterState((current) => ({
        source: current.source,
        filters: readFilters(restored),
        // A real history traversal wins even when its URL matches an unacknowledged write.
        pendingUrls: current.source === source ? [] : [source],
      }));
    }
    window.addEventListener('popstate', restoreHistoryFilters);
    return () => window.removeEventListener('popstate', restoreHistoryFilters);
  }, []);
  const scope = useCampusNavigationSearch(params);
  const { query, group, publicOnly, category } = filters;
  const expanded = new Set(filters.expanded);
  const items = visibleCampusServices()
    .filter(
      (item) =>
        item.category === 'campus' ||
        item.category === 'connect' ||
        ['/classroom', '/timetable'].includes(item.href),
    )
    .map(presentCampusService);
  const primaryPaths = new Set([
    '/map',
    '/bus',
    isWebOnlineOrderingEnabled() ? '/food' : '/cafeteria',
    '/dormitory',
    '/library',
    '/events',
    '/social',
  ]);
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const filtered = terms.length > 0 || group !== 'all' || publicOnly || category !== 'all';
  const matches = items.filter((item) => {
    const serviceCategory =
      item.access === 'public' || item.access === 'device' || item.href === '/food'
        ? 'public'
        : ['/social', '/community', '/friends', '/lost-found'].includes(item.href)
          ? 'community'
          : 'personal';
    if (category !== 'all' && category !== serviceCategory) return false;
    if (group !== 'all' && groupFor(item) !== group) return false;
    if (publicOnly && item.access !== 'public' && item.access !== 'device') return false;
    const content = normalizeSearch(
      `${item.name} ${item.text} ${item.keywords} ${SERVICE_ACCESS[item.access]} ${item.access === 'public' || item.access === 'device' ? '免登入 不需登入 訪客' : ''}`,
    );
    return terms.every((term) => content.includes(term));
  });

  function updateFilters(next: LifeFilters, persist = true) {
    const url = new URL(window.location.href);
    writeLifeFilters(url.searchParams, next);
    if (next.group !== 'all') url.searchParams.set('group', next.group);
    else url.searchParams.delete('group');
    if (next.publicOnly) url.searchParams.set('access', 'public');
    else url.searchParams.delete('access');
    if (next.expanded.length) url.searchParams.set('expanded', next.expanded.join(','));
    else url.searchParams.delete('expanded');
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const shouldPublish =
      persist &&
      destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const pendingUrl = url.searchParams.toString();
    setFilterState((current) => ({
      source: queryString,
      filters: next,
      pendingUrls: shouldPublish
        ? [...current.pendingUrls.filter((entry) => entry !== pendingUrl), pendingUrl].slice(
            -MAX_PENDING_FILTER_URLS,
          )
        : current.pendingUrls,
    }));
    if (!shouldPublish) return;
    try {
      // Next copies its routing state; passing that private state back would skip URL sync.
      window.history.replaceState(null, '', destination);
    } catch {
      // Filtering remains usable when the browser denies history changes.
      setFilterState((current) => ({
        ...current,
        pendingUrls: current.pendingUrls.filter((entry) => entry !== pendingUrl),
      }));
    }
  }
  function toggleGroup(groupId: LifeGroup) {
    const next = new Set(expanded);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    updateFilters({
      ...filters,
      expanded: GROUPS.filter((entry) => next.has(entry.id)).map((entry) => entry.id),
    });
  }

  function resetFilters() {
    updateFilters({ ...filters, query: '', category: 'all', group: 'all', publicOnly: false });
    searchInput.current?.focus();
  }

  function serviceList(services: CampusService[]) {
    return (
      <ul className={styles.serviceList}>
        {services.map((item) => (
          <li key={item.href}>
            <ServiceLink item={item} href={campusServiceHref(item.href, scope)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <SiteShell title="生活" subtitle="從現在想做的事開始。">
      <div className={styles.finder}>
        <form role="search" aria-label="校園服務搜尋" onSubmit={(event) => event.preventDefault()}>
          <label className={styles.searchLabel} htmlFor="life-service-search">
            快速找服務
          </label>
          <div className={styles.searchField}>
            <CampusIcon name="search" size={21} />
            <input
              ref={searchInput}
              id="life-service-search"
              type="search"
              value={query}
              onChange={(event) =>
                updateFilters({ ...filters, query: event.target.value }, !composing.current)
              }
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                updateFilters({ ...filters, query: event.currentTarget.value });
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Escape' &&
                  !event.nativeEvent.isComposing &&
                  !composing.current &&
                  query
                ) {
                  event.preventDefault();
                  updateFilters({ ...filters, query: '' });
                }
              }}
              placeholder="借書、教室、公車…"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={LIFE_QUERY_LIMIT}
              aria-describedby="life-search-hint"
              aria-controls="life-service-results"
            />
            {query && (
              <button
                type="button"
                className={styles.clearSearch}
                onClick={() => {
                  updateFilters({ ...filters, query: '' });
                  searchInput.current?.focus();
                }}
                aria-label="清除搜尋"
              >
                清除
              </button>
            )}
          </div>
          <p id="life-search-hint" className={styles.searchHint}>
            搜尋會包含各分類收合的服務。
          </p>
        </form>
        <div className={styles.filterBar}>
          <div className={styles.categories} role="group" aria-label="服務分類">
            {[{ id: 'all' as const, label: '全部' }, ...GROUPS].map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={group === entry.id}
                aria-controls="life-service-results"
                onClick={() => updateFilters({ ...filters, group: entry.id, category: 'all' })}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className={styles.categories} role="group" aria-label="服務使用方式">
            {(
              [
                { value: 'public', label: '免登入' },
                { value: 'community', label: '交流與互助' },
                { value: 'personal', label: '個人安排' },
              ] as const
            ).map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={category === entry.value}
                aria-controls="life-service-results"
                onClick={() =>
                  updateFilters({
                    ...filters,
                    category: category === entry.value ? 'all' : entry.value,
                  })
                }
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className={styles.publicFilter}>
            <input
              type="checkbox"
              checked={publicOnly}
              onChange={(event) => updateFilters({ ...filters, publicOnly: event.target.checked })}
              aria-controls="life-service-results"
            />
            只看免登入服務
          </label>
        </div>
        <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true">
          {filtered ? `找到 ${matches.length} 項服務` : '常用服務先顯示，其他服務可在各分類展開。'}
        </p>
      </div>
      <div id="life-service-results">
        {filtered ? (
          <section aria-labelledby="service-results-title" className={styles.results}>
            <div className={styles.sectionHeading}>
              <h2 id="service-results-title">
                {terms.length
                  ? '搜尋結果'
                  : group === 'all'
                    ? '免登入服務'
                    : GROUPS.find((entry) => entry.id === group)?.label}
              </h2>
              <button type="button" className={styles.resetFilters} onClick={resetFilters}>
                回到生活總覽
              </button>
            </div>
            {matches.length ? (
              serviceList(matches)
            ) : (
              <div className={styles.emptyResults}>
                <CampusIcon name="search" size={26} />
                <h3>沒有找到符合的服務</h3>
                <p>試試「借書」「公車」，或切換上方分類。</p>
              </div>
            )}
          </section>
        ) : (
          <div className={styles.directory}>
            {GROUPS.map((entry) => {
              const groupItems = items.filter((item) => groupFor(item) === entry.id);
              const primary = groupItems.filter((item) => primaryPaths.has(item.href));
              const more = groupItems.filter((item) => !primaryPaths.has(item.href));
              const open = expanded.has(entry.id);
              return (
                <section
                  key={entry.id}
                  className={styles.taskGroup}
                  aria-labelledby={`life-${entry.id}-title`}
                >
                  <div className={styles.groupHeading}>
                    <h2 id={`life-${entry.id}-title`}>{entry.title}</h2>
                    <p>{entry.description}</p>
                  </div>
                  {serviceList(primary)}
                  {more.length > 0 && (
                    <>
                      <button
                        type="button"
                        className={styles.expandGroup}
                        aria-expanded={open}
                        aria-controls={`life-${entry.id}-more`}
                        onClick={() => toggleGroup(entry.id)}
                      >
                        <span>
                          {open ? '收合' : '更多'}
                          {entry.label}服務
                        </span>
                        <span aria-hidden="true">{open ? '−' : `＋${more.length}`}</span>
                      </button>
                      <div
                        id={`life-${entry.id}-more`}
                        hidden={!open}
                        className={styles.moreServices}
                      >
                        {serviceList(more)}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </SiteShell>
  );
}

function LifeLoadingFallback() {
  return (
    <SiteShell title="生活" subtitle="從現在想做的事開始。">
      <p role="status">正在載入生活服務…</p>
    </SiteShell>
  );
}

export default function LifePage() {
  return (
    <Suspense fallback={<LifeLoadingFallback />}>
      <LifeDirectory />
    </Suspense>
  );
}
