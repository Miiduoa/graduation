'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import {
  fetchCafeterias,
  fetchMenus,
  subscribeCafeterias,
  subscribeMenus,
  type Cafeteria,
  type MenuItem,
} from '@/lib/firebase';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useSchoolCollectionData } from '@/lib/useSchoolCollectionData';
import styles from './cafeteria.module.css';

const ALL_CAFETERIAS_KEY = 'all';

function getCafeteriaKey(input: {
  id?: string | null;
  cafeteriaId?: string | null;
  cafeteria?: string | null;
  name?: string | null;
}) {
  return input.id || input.cafeteriaId || input.name || input.cafeteria || '';
}

function getMenuCafeteriaKey(menu: MenuItem, cafeterias: Cafeteria[]) {
  if (menu.cafeteriaId) return menu.cafeteriaId;
  const matching = cafeterias.filter((row) => row.name === menu.cafeteria);
  return matching.length === 1 ? matching[0].id : menu.cafeteria || '';
}

function toSearchText(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function formatLastUpdated(value?: string) {
  if (!value) {
    return '尚未提供更新時間';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '尚未提供更新時間';
  }

  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMenuAvailability(item: MenuItem) {
  if (item.soldOut === true) return { label: '已售完', tone: 'unavailable' };
  if (item.available === false) return { label: '暫停供應', tone: 'unavailable' };
  if (item.available === true) return { label: '供應中', tone: 'available' };
  return { label: '供應狀態未確認', tone: 'unknown' };
}

export default function CafeteriaPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const context = resolveSchoolPageContext(searchParams);
  const { user, loading: authLoading } = useAuth();
  const scopeKey = JSON.stringify([user?.uid ?? null, authLoading]);
  return (
    <CafeteriaContent
      key={JSON.stringify([context.schoolId, scopeKey])}
      {...context}
      scopeKey={scopeKey}
      authLoading={authLoading}
    />
  );
}

function CafeteriaContent({
  schoolId,
  schoolName,
  schoolSearch: q,
  scopeKey,
  authLoading,
}: {
  schoolId: string;
  schoolName: string;
  schoolSearch: string;
  scopeKey: string;
  authLoading: boolean;
}) {
  const [selectedCafeteria, setSelectedCafeteria] = useState(ALL_CAFETERIAS_KEY);
  const [search, setSearch] = useState('');

  const {
    data: cafeteriaRows,
    loading: cafeteriaLoading,
    error: cafeteriaError,
    retry: retryCafeterias,
  } = useSchoolCollectionData<Cafeteria>(schoolId, fetchCafeterias, {
    subscribeLive: subscribeCafeterias,
    scopeKey,
  });

  const {
    data: menuRows,
    loading: menuLoading,
    error: menuError,
    retry: retryMenus,
  } = useSchoolCollectionData<MenuItem>(schoolId, fetchMenus, {
    subscribeLive: subscribeMenus,
    scopeKey,
  });

  const loading = cafeteriaLoading || menuLoading;

  const cafeterias = useMemo(() => {
    const merged = new Map<string, Cafeteria>();

    cafeteriaRows.forEach((cafeteria) => {
      const key = getCafeteriaKey(cafeteria);
      if (!key) return;
      merged.set(key, {
        ...cafeteria,
        id: cafeteria.id || key,
        name: cafeteria.name || '未命名餐廳',
      });
    });

    menuRows.forEach((menu) => {
      const key = getMenuCafeteriaKey(menu, cafeteriaRows);
      if (!key || merged.has(key)) return;

      merged.set(key, {
        id: menu.cafeteriaId || key,
        name: menu.cafeteria || '未命名餐廳',
      });
    });

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  }, [cafeteriaRows, menuRows]);

  const menusByCafeteria = useMemo(() => {
    const grouped = new Map<string, MenuItem[]>();

    menuRows.forEach((menu) => {
      const key = getMenuCafeteriaKey(menu, cafeteriaRows);
      if (!key) return;

      const bucket = grouped.get(key) ?? [];
      bucket.push(menu);
      grouped.set(key, bucket);
    });

    grouped.forEach((items, key) => {
      grouped.set(
        key,
        [...items].sort((a, b) => {
          const aTime = new Date(a.updatedAt ?? a.availableOn ?? a.createdAt ?? '').getTime() || 0;
          const bTime = new Date(b.updatedAt ?? b.availableOn ?? b.createdAt ?? '').getTime() || 0;
          if (bTime !== aTime) {
            return bTime - aTime;
          }
          return a.name.localeCompare(b.name, 'zh-TW');
        }),
      );
    });

    return grouped;
  }, [menuRows, cafeteriaRows]);

  const sections = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return cafeterias
      .map((cafeteria) => {
        const key = getCafeteriaKey(cafeteria);
        const allItems = menusByCafeteria.get(key) ?? [];
        const cafeteriaMatches =
          needle.length === 0 ||
          toSearchText([cafeteria.name, cafeteria.location, cafeteria.openingHours]).includes(
            needle,
          );
        const items =
          needle.length === 0 || cafeteriaMatches
            ? allItems
            : allItems.filter((item) =>
                toSearchText([item.name, item.category, item.description, item.cafeteria]).includes(
                  needle,
                ),
              );

        if (selectedCafeteria !== ALL_CAFETERIAS_KEY && key !== selectedCafeteria) {
          return null;
        }

        if (needle.length > 0 && !cafeteriaMatches && items.length === 0) {
          return null;
        }

        return {
          key,
          cafeteria,
          items,
          totalCount: allItems.length,
          availableCount: allItems.filter(
            (item) => item.available === true && item.soldOut !== true,
          ).length,
        };
      })
      .filter((section): section is NonNullable<typeof section> => section !== null);
  }, [cafeterias, menusByCafeteria, search, selectedCafeteria]);

  const stats = useMemo(() => {
    const soldOutMenus = menuRows.filter((menu) => menu.soldOut === true).length;

    return {
      cafeterias: cafeterias.length,
      menuItems: menuRows.length,
      soldOutMenus,
    };
  }, [cafeterias, menuRows]);

  const lastUpdatedAt = useMemo(() => {
    const timestamps = [
      ...cafeterias.map((cafeteria) => cafeteria.updatedAt ?? cafeteria.createdAt),
      ...menuRows.map((menu) => menu.updatedAt ?? menu.availableOn ?? menu.createdAt),
    ]
      .map((value) => (value ? new Date(value).getTime() : 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (timestamps.length === 0) {
      return undefined;
    }

    return new Date(Math.max(...timestamps)).toISOString();
  }, [cafeterias, menuRows]);

  const sourceLabel = '餐廳資料';
  if (authLoading || loading || cafeteriaError || menuError) {
    const failed = !authLoading && (cafeteriaError || menuError);
    return (
      <SiteShell title="餐廳" subtitle="查看校內餐廳與菜單" schoolName={schoolName}>
        <section className="card" role={failed ? 'alert' : 'status'}>
          <h2>{failed ? '暫時無法讀取餐廳資料' : '正在讀取餐廳與菜單…'}</h2>
          {failed && (
            <>
              <p>這次沒有取得完整資料，請稍後重試。餐點供應仍以店家現場資訊為準。</p>
              <button
                className="btn primary"
                onClick={() => {
                  retryCafeterias();
                  retryMenus();
                }}
              >
                重新讀取
              </button>
            </>
          )}
        </section>
      </SiteShell>
    );
  }

  return (
    <SiteShell title="餐廳" subtitle="查看校內餐廳與菜單" schoolName={schoolName}>
      <div className={styles.page}>
        <div className={styles.source}>
          <div>
            <p>
              <span>{sourceLabel}</span> · {stats.cafeterias} 間餐廳 · {stats.menuItems} 道餐點
            </p>
            <span>資料更新：{formatLastUpdated(lastUpdatedAt)}</span>
          </div>
          <Link
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('請幫我整理校內餐廳與菜單選擇')}`}
            className={styles.assistantLink}
          >
            請助理整理用餐選擇 <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <p className={styles.notice}>
          依店家提供的資料顯示；實際營業與餐點供應請向店家確認。本頁提供菜單查詢，尚未開放線上點餐。
        </p>

        <section className={styles.toolbar} aria-label="尋找餐點">
          <label className={styles.search}>
            搜尋餐點或餐廳
            <input
              type="search"
              placeholder="菜名、類別或餐廳名稱"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className={styles.filters} role="group" aria-label="篩選餐廳">
            <button
              type="button"
              onClick={() => setSelectedCafeteria(ALL_CAFETERIAS_KEY)}
              aria-pressed={selectedCafeteria === ALL_CAFETERIAS_KEY}
            >
              全部餐廳
            </button>
            {cafeterias.map((cafeteria) => {
              const key = getCafeteriaKey(cafeteria);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedCafeteria(key)}
                  aria-pressed={selectedCafeteria === key}
                >
                  {cafeteria.name}
                </button>
              );
            })}
          </div>
        </section>

        {sections.length === 0 ? (
          <section className={styles.empty} role="status">
            <h2>
              {search.trim() || selectedCafeteria !== ALL_CAFETERIAS_KEY
                ? '找不到符合的餐廳或菜單'
                : '目前沒有餐廳資料'}
            </h2>
            <p>
              {search.trim() || selectedCafeteria !== ALL_CAFETERIAS_KEY
                ? '試試其他菜名，或清除篩選查看全部餐廳。'
                : '店家提供餐廳與菜單資料後，會顯示在這裡。'}
            </p>
            {(search.trim() || selectedCafeteria !== ALL_CAFETERIAS_KEY) && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSearch('');
                  setSelectedCafeteria(ALL_CAFETERIAS_KEY);
                }}
              >
                清除篩選
              </button>
            )}
          </section>
        ) : (
          sections.map(({ key, cafeteria, items, availableCount, totalCount }) => (
            <section key={key} className={styles.restaurant} aria-label={cafeteria.name}>
              <header className={styles.restaurantHeader}>
                <div>
                  <h2>{cafeteria.name}</h2>
                  <div className={styles.details}>
                    {cafeteria.location && <span>位置：{cafeteria.location}</span>}
                    {cafeteria.openingHours && <span>營業時間：{cafeteria.openingHours}</span>}
                    {typeof cafeteria.currentOccupancy === 'number' && (
                      <span>店家回報人數：約 {cafeteria.currentOccupancy} 人</span>
                    )}
                    {typeof cafeteria.rating === 'number' && (
                      <span>
                        評分 {cafeteria.rating.toFixed(1)}
                        {typeof cafeteria.reviewCount === 'number'
                          ? ` · ${cafeteria.reviewCount} 則評價`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>
                <p className={styles.count}>
                  {totalCount} 道餐點 · {availableCount} 道標記供應中
                </p>
              </header>

              {items.length === 0 ? (
                <p className={styles.menuEmpty}>店家尚未提供菜單，請至現場確認餐點。</p>
              ) : (
                <ul className={styles.menu}>
                  {items.map((item) => {
                    const availability = getMenuAvailability(item);
                    return (
                      <li key={item.id} className={styles.menuItem}>
                        <div className={styles.menuContent}>
                          <div className={styles.menuHeading}>
                            <h3>{item.name}</h3>
                            <span className={styles.status} data-tone={availability.tone}>
                              {availability.label}
                            </span>
                          </div>
                          {item.description && (
                            <p className={styles.description}>{item.description}</p>
                          )}
                          <div className={styles.details}>
                            {item.category && <span>{item.category}</span>}
                            {item.tags?.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                            {typeof item.rating === 'number' && (
                              <span>評分 {item.rating.toFixed(1)}</span>
                            )}
                            {typeof item.calories === 'number' && <span>{item.calories} kcal</span>}
                            <span>
                              {item.updatedAt || item.availableOn
                                ? `更新於 ${formatLastUpdated(item.updatedAt ?? item.availableOn)}`
                                : '尚未提供更新時間'}
                            </span>
                          </div>
                        </div>
                        <p className={styles.price}>
                          {typeof item.price === 'number' ? `NT$${item.price}` : '未標價'}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))
        )}

        {stats.soldOutMenus > 0 && (
          <p className={styles.notice}>
            店家目前將 {stats.soldOutMenus} 道餐點標記為售完，供應狀態有更新時會顯示在這裡。
          </p>
        )}
      </div>
    </SiteShell>
  );
}
