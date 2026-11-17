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
type LifeFilters = { query: string; group: LifeGroup | 'all'; publicOnly: boolean };

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
    query: (params.get('q') ?? '').slice(0, 100),
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
      <span className={styles.serviceBody}>
        <span className={styles.serviceTitle}>{item.name}</span>
        <span className={styles.serviceDescription}>{item.text}</span>
        <span className={styles.accessNote}>{SERVICE_ACCESS[item.access]}</span>
      </span>
      <span className={styles.arrow} aria-hidden="true">
        <CampusIcon name="arrow" size={18} />
      </span>
    </Link>
  );
}

function LifeDirectory() {
  const params = useSearchParams();
  const queryString = params.toString();
  const [filters, setFilters] = useState(() => readFilters(new URLSearchParams(queryString)));
  const [expanded, setExpanded] = useState(() => readExpanded(new URLSearchParams(queryString)));
  const searchInput = useRef<HTMLInputElement>(null);
  const scope = useCampusNavigationSearch(params);
  const { query, group, publicOnly } = filters;

  useEffect(() => {
    // 書籤與上一頁恢復相同搜尋；輸入時以 replaceState 保留目前 history entry。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(readFilters(new URLSearchParams(queryString)));
    setExpanded(readExpanded(new URLSearchParams(queryString)));
  }, [queryString]);

  const items = visibleCampusServices()
    .filter((item) => item.category === 'campus' || item.category === 'connect')
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
  const filtered = terms.length > 0 || group !== 'all' || publicOnly;
  const matches = items.filter((item) => {
    if (group !== 'all' && groupFor(item) !== group) return false;
    if (publicOnly && item.access !== 'public' && item.access !== 'device') return false;
    const content = normalizeSearch(
      `${item.name} ${item.text} ${item.keywords} ${SERVICE_ACCESS[item.access]} ${item.access === 'public' || item.access === 'device' ? '免登入 不需登入 訪客' : ''}`,
    );
    return terms.every((term) => content.includes(term));
  });

  function updateFilters(next: LifeFilters) {
    setFilters(next);
    const url = new URL(window.location.href);
    if (next.query) url.searchParams.set('q', next.query);
    else url.searchParams.delete('q');
    if (next.group !== 'all') url.searchParams.set('group', next.group);
    else url.searchParams.delete('group');
    if (next.publicOnly) url.searchParams.set('access', 'public');
    else url.searchParams.delete('access');
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // History 不可用時仍可搜尋；服務連結不依賴這次儲存。
    }
  }

  function toggleGroup(groupId: LifeGroup) {
    const next = new Set(expanded);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setExpanded(next);
    const url = new URL(window.location.href);
    if (next.size)
      url.searchParams.set(
        'expanded',
        GROUPS.filter((item) => next.has(item.id))
          .map((item) => item.id)
          .join(','),
      );
    else url.searchParams.delete('expanded');
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // 儲存失敗不影響目前展開操作。
    }
  }

  function resetFilters() {
    updateFilters({ query: '', group: 'all', publicOnly: false });
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
              onChange={(event) => updateFilters({ ...filters, query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                  event.preventDefault();
                  updateFilters({ ...filters, query: '' });
                }
              }}
              placeholder="借書、教室、公車…"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
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
                onClick={() => updateFilters({ ...filters, group: entry.id })}
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
