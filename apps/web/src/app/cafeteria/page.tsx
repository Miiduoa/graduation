'use client';

import { use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { CampusIcon } from '@/components/CampusIcon';
import {
  SHOWCASE_ORDER_BUTTON_TEXT,
  isMenuStale,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import {
  CAFETERIA_EMPTY_SCHOOL_TEXT,
  CAFETERIA_PAYMENT_DISCLAIMER,
  cafeteriaReviewBadge,
  cafeteriaShowsMenuAvailability,
} from '@campus/shared/src/cafeteriaCatalog';
import { ONLINE_ORDERING_OFF_TEXT } from '@/lib/onlineOrdering';
import { fetchCafeteriaCatalog, type CatalogCafeteria } from '@/lib/cafeteriaCatalog';
import { loadServiceFailureCopy, shouldOfferLoadRetry } from '@campus/shared/src/loadFailureCopy';
import type { MenuItem } from '@/lib/firebase';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import {
  DEFAULT_DINING_FILTERS,
  buildDiningSections,
  diningPrice,
  filterDiningSections,
  menuPrice,
  readDiningFilters,
  saveDiningFilters,
  type DiningFilters,
  type DiningSection,
} from './cafeteriaBrowse';
import styles from './cafeteria.module.css';

const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function menuAvailability(item: MenuItem) {
  if (item.soldOut === true) return { label: '已售完', tone: 'unavailable' };
  if (item.available === false) return { label: '暫停供應', tone: 'unavailable' };
  if (item.available === true) return { label: '供應中', tone: 'available' };
  return { label: '供應狀態未確認', tone: 'unknown' };
}

export default function CafeteriaPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(searchParams);
  if (context.status !== 'ready' || !context.schoolId) {
    return (
      <SiteShell title="餐廳" compactHeading>
        <section className={styles.empty} role="status">
          <CampusIcon name="cafeteria" size={28} />
          <h2>
            {context.status === 'loading'
              ? '正在讀取校園目錄…'
              : context.status === 'error'
                ? '無法確認所選校園'
                : '先選擇一所學校'}
          </h2>
          <p>從上方選擇校園，就能查看該校的餐廳與菜單。</p>
        </section>
      </SiteShell>
    );
  }
  return (
    <CafeteriaContent
      key={context.schoolId}
      schoolId={context.schoolId}
      schoolName={context.schoolName}
    />
  );
}

function CafeteriaContent({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [restored, setRestored] = useState(false);
  const [filters, setFilters] = useState<DiningFilters>({ ...DEFAULT_DINING_FILTERS });
  const [catalog, setCatalog] = useState<{
    cafeterias: CatalogCafeteria[];
    menus: MenuItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  if (hydrated && !restored) {
    setRestored(true);
    setFilters(readDiningFilters(schoolId));
  }
  useEffect(() => {
    let active = true;
    void fetchCafeteriaCatalog(schoolId).then(
      (next) => {
        if (active) {
          setCatalog(next);
          setLoading(false);
        }
      },
      (reason) => {
        if (active) {
          setFailed(reason);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, schoolId]);

  const allSections = useMemo(
    () => buildDiningSections(catalog?.cafeterias ?? [], catalog?.menus ?? []),
    [catalog],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          (catalog?.menus ?? []).flatMap((item) =>
            item.category?.trim() ? [item.category.trim()] : [],
          ),
        ),
      ).sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [catalog],
  );
  const sections = useMemo(
    () => filterDiningSections(allSections, filters),
    [allSections, filters],
  );
  const filtered = Boolean(filters.search.trim() || filters.category || filters.budget !== 'all');
  const matches = sections.reduce((total, section) => total + section.items.length, 0);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  function changeFilters(patch: Partial<DiningFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    saveDiningFilters(schoolId, next);
  }
  function clearFilters() {
    setFilters({ ...DEFAULT_DINING_FILTERS });
    saveDiningFilters(schoolId, DEFAULT_DINING_FILTERS);
  }

  return (
    <SiteShell
      title="餐廳"
      subtitle="找一家店，看看今天想吃什麼。"
      schoolName={schoolName}
      compactHeading
    >
      <div className={styles.page}>
        <div className={styles.topline}>
          <p>
            {catalog ? (
              <>
                <strong>{allSections.length}</strong> 間餐廳{' '}
                <span>· {catalog.menus.length} 道餐點</span>
              </>
            ) : (
              '校園餐廳與菜單'
            )}
          </p>
          <Link
            href={`/orders?schoolId=${encodeURIComponent(schoolId)}`}
            className={styles.ordersLink}
          >
            <CampusIcon name="orders" size={17} /> 我的訂單
          </Link>
        </div>

        <section className={styles.toolbar} aria-label="尋找餐點">
          <label className={styles.search}>
            <span className={styles.srOnly}>搜尋餐點或餐廳</span>
            <CampusIcon name="search" size={21} />
            <input
              type="search"
              aria-label="搜尋餐點或餐廳"
              placeholder="想吃什麼？搜尋店名、餐點或位置"
              value={filters.search}
              maxLength={120}
              onChange={(event) => changeFilters({ search: event.target.value })}
            />
            {filters.search ? (
              <button
                type="button"
                className={styles.clearSearch}
                aria-label="清除搜尋"
                onClick={() => changeFilters({ search: '' })}
              >
                清除
              </button>
            ) : null}
          </label>
          {categories.length > 0 ? (
            <div className={styles.categories} role="group" aria-label="餐點分類">
              <button
                type="button"
                onClick={() => changeFilters({ category: '' })}
                aria-pressed={!filters.category}
              >
                全部分類
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={filters.category === category}
                  onClick={() => changeFilters({ category })}
                >
                  {category}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.filterRow}>
            <label className={styles.selectField}>
              餐點預算
              <select
                value={filters.budget}
                onChange={(event) =>
                  changeFilters({ budget: event.target.value as DiningFilters['budget'] })
                }
              >
                <option value="all">不限金額</option>
                <option value="100">NT$100 以內</option>
                <option value="150">NT$150 以內</option>
              </select>
            </label>
            <label className={styles.selectField}>
              排序
              <select
                value={filters.sort}
                onChange={(event) =>
                  changeFilters({ sort: event.target.value as DiningFilters['sort'] })
                }
              >
                <option value="name">店名順序</option>
                <option value="price">餐點價格由低到高</option>
              </select>
            </label>
            {filtered ? (
              <button className={styles.reset} type="button" onClick={clearFilters}>
                清除篩選
              </button>
            ) : null}
          </div>
        </section>

        {loading && !catalog ? (
          <section className={styles.loading} role="status" aria-live="polite">
            <p>正在讀取餐廳與菜單…</p>
            <div className={styles.grid} aria-hidden="true">
              {[0, 1, 2, 3].map((key) => (
                <div key={key} className={styles.skeleton}>
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          </section>
        ) : failed ? (
          <section className={styles.empty} role="alert">
            <CampusIcon name="support" size={28} />
            <h2>餐廳資料暫時無法載入</h2>
            <p>{loadServiceFailureCopy(failed, { online })}</p>
            {shouldOfferLoadRetry(failed, { online }) ? (
              <button
                className="btn primary"
                onClick={() => {
                  setLoading(true);
                  setFailed(null);
                  setAttempt((value) => value + 1);
                }}
              >
                重新整理
              </button>
            ) : null}
          </section>
        ) : (
          <>
            <div className={styles.results} aria-live="polite" aria-atomic="true">
              <h2>{filtered ? '符合條件的餐廳' : '校園餐廳'}</h2>
              <span>
                {sections.length} 間{filtered ? ` · ${matches} 道符合餐點` : ''}
              </span>
            </div>
            {sections.length === 0 ? (
              <section className={styles.empty} role="status">
                <CampusIcon name={filtered ? 'search' : 'cafeteria'} size={28} />
                <h2>{filtered ? '找不到符合的餐廳或菜單' : CAFETERIA_EMPTY_SCHOOL_TEXT}</h2>
                <p>
                  {filtered
                    ? '換個關鍵字、放寬預算，或清除篩選看看其他選擇。'
                    : '店家資料上架後會顯示在這裡。你也可以從上方切換校園。'}
                </p>
              </section>
            ) : (
              <div className={styles.grid}>
                {sections.map((section) => (
                  <RestaurantCard
                    key={section.cafeteria.id}
                    section={section}
                    schoolId={schoolId}
                    filtered={filtered}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <details className={styles.disclosure}>
          <summary>餐廳資料與訂餐說明</summary>
          <div>
            <p>{ONLINE_ORDERING_OFF_TEXT}。有提供訂餐網站的店家，可以從店面前往。</p>
            <p>
              營業時間與餐點供應依店家資料顯示，出發前請確認。標示「未核對」或「示範」的菜單僅供參考。
            </p>
            <p>{CAFETERIA_PAYMENT_DISCLAIMER}</p>
          </div>
        </details>
      </div>
    </SiteShell>
  );
}

function RestaurantCard({
  section,
  schoolId,
  filtered,
}: {
  section: DiningSection;
  schoolId: string;
  filtered: boolean;
}) {
  const { cafeteria, items, allItems } = section;
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, 3);
  const review = cafeteriaReviewBadge(cafeteria.reviewStatus);
  const showAvailability = cafeteriaShowsMenuAvailability(cafeteria.reviewStatus);
  const availableCount = allItems.filter(
    (item) => item.available === true && item.soldOut !== true,
  ).length;
  const href = `/cafeteria/${encodeURIComponent(cafeteria.id)}?schoolId=${encodeURIComponent(schoolId)}`;
  const action = studentCafeteriaAction({
    merchantMode: cafeteria.merchantMode,
    orderingEnabled: cafeteria.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: cafeteria.orderingUrl,
  });
  const menuId = `menu-${encodeURIComponent(cafeteria.id)}`;
  const categories = Array.from(
    new Set(allItems.flatMap((item) => (item.category?.trim() ? [item.category.trim()] : []))),
  ).slice(0, 3);
  return (
    <section className={styles.restaurant} aria-label={cafeteria.name}>
      <header className={styles.restaurantHeader}>
        <div className={styles.identity}>
          <span className={styles.restaurantIcon}>
            <CampusIcon name="cafeteria" size={22} />
          </span>
          <div>
            <h2>
              <Link href={href}>{cafeteria.name}</Link>
            </h2>
            {categories.length > 0 ? (
              <p className={styles.categoryLabel}>{categories.join(' · ')}</p>
            ) : null}
          </div>
        </div>
        {review ? <span className={styles.reviewBadge}>{review}</span> : null}
      </header>
      <div className={styles.restaurantBody}>
        {cafeteria.intro ? <p className={styles.intro}>{cafeteria.intro}</p> : null}
        <div className={styles.details}>
          <p>
            <CampusIcon name="map" size={16} />
            <span>{cafeteria.location ? `位置：${cafeteria.location}` : '店家尚未提供位置'}</span>
          </p>
          {cafeteria.openingHours ? (
            <p>
              <CampusIcon name="calendar" size={16} />
              <span>營業時間：{cafeteria.openingHours}</span>
            </p>
          ) : null}
        </div>
        <div className={styles.menuMeta}>
          <span>
            {filtered
              ? `${items.length} 道符合餐點`
              : showAvailability
                ? `${allItems.length} 道餐點 · ${availableCount} 道標記供應中`
                : `${allItems.length} 道餐點`}
          </span>
        </div>
        {items.length ? (
          <ul className={styles.menu} id={menuId}>
            {visibleItems.map((item) => {
              const availability = showAvailability ? menuAvailability(item) : null;
              return (
                <li key={item.id} className={styles.menuItem}>
                  <div className={styles.menuContent}>
                    <h3>{item.name}</h3>
                    {availability && availability.tone !== 'unknown' ? (
                      <span className={styles.status} data-tone={availability.tone}>
                        {availability.label}
                      </span>
                    ) : availability ? (
                      <span className={styles.srOnly}>{availability.label}</span>
                    ) : null}
                  </div>
                  <span className={styles.price}>{diningPrice(menuPrice(item))}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.menuEmpty}>店家尚未提供菜單，可以先查看店面資訊。</p>
        )}
        {items.length > 3 ? (
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            aria-controls={menuId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起餐點' : `再看 ${items.length - 3} 道餐點`}
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        ) : null}
        {isMenuStale(cafeteria.menuSyncedAt) && items.length > 0 ? (
          <p className={styles.stale}>菜單較久未更新，價格請以店家為準。</p>
        ) : null}
      </div>
      <footer className={styles.cardFooter}>
        <Link href={href} className={styles.storeLink}>
          進入店面
          <CampusIcon name="arrow" size={18} />
        </Link>
        {action.kind === 'showcase' ? (
          <Link
            href={`/cafeteria/${encodeURIComponent(cafeteria.id)}/order?schoolId=${encodeURIComponent(schoolId)}`}
            className={styles.externalLink}
          >
            {SHOWCASE_ORDER_BUTTON_TEXT}
            <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <span className={styles.footerNote}>查看完整菜單與店家資訊</span>
        )}
      </footer>
    </section>
  );
}
