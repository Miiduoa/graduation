'use client';

import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { SiteShell } from '@/components/SiteShell';
import { CampusIcon, type CampusIconName } from '@/components/CampusIcon';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import styles from './life.module.css';

type LifeService = {
  href: string;
  title: string;
  text: string;
  action: string;
  icon: CampusIconName;
  group: 'public' | 'community' | 'personal';
  keywords: string;
};

const ITEMS: LifeService[] = [
  {
    href: '/map',
    title: '校園地圖',
    text: '找教室、行政單位和地點。',
    action: '找地點',
    icon: 'map',
    group: 'public',
    keywords: '地點 教室 大樓 建築 行政 地圖 map classroom',
  },
  {
    href: '/bus',
    title: '公車',
    text: '查路線與站牌；到站預估依資料來源提供。',
    action: '查公車',
    icon: 'bus',
    group: 'public',
    keywords: '搭車 交通 車站 車班 時刻表 巴士 bus transit',
  },
  {
    href: '/cafeteria',
    title: '餐廳',
    text: '查看餐廳提供的菜單與營業資訊。',
    action: '看餐廳',
    icon: 'cafeteria',
    group: 'public',
    keywords: '吃飯 午餐 晚餐 食堂 飲食 美食 menu food restaurant',
  },
  {
    href: '/library',
    title: '圖書館',
    text: '搜尋館藏，前往學校系統辦理借閱與續借。',
    action: '查館藏',
    icon: 'library',
    group: 'public',
    keywords: '借書 還書 續借 找書 書籍 閱讀 library book',
  },
  {
    href: '/school-info',
    title: '學校資訊',
    text: '查看官方總機、網站與名錄地址。',
    action: '看學校資訊',
    icon: 'services',
    group: 'public',
    keywords: '總機 官網 地址 名錄 聯絡 school info contact',
  },
  {
    href: '/announcements',
    title: '公開公告',
    text: '查看學校發布的公開消息。',
    action: '看公告',
    icon: 'announcements',
    group: 'public',
    keywords: '消息 通知 最新 校方 news announcement',
  },
  {
    href: '/lost-found',
    title: '失物招領',
    text: '使用學校帳號登入後，查看或刊登遺失與拾獲物品。',
    action: '找失物',
    icon: 'lost-found',
    group: 'community',
    keywords: '遺失 拾獲 掉東西 撿到 尋物 lost found',
  },
  {
    href: '/orders',
    title: '我的訂單',
    text: '看訂單狀態和取餐號碼。',
    action: '查訂單',
    icon: 'orders',
    group: 'personal',
    keywords: '取餐 餐點 進度 點餐 order pickup',
  },
  {
    href: '/social',
    title: '跨校交流',
    text: '用 Google 帳號登入，在公開看板閱讀與分享近況。',
    action: '看公開看板',
    icon: 'social',
    group: 'community',
    keywords: '社群 看板 文章 分享 social board',
  },
  {
    href: '/community',
    title: '校園交流',
    text: '使用學校帳號查看校內話題。',
    action: '看校內話題',
    icon: 'community',
    group: 'community',
    keywords: '社群 校內 同校 討論 community',
  },
  {
    href: '/friends',
    title: '找人',
    text: '使用學校帳號，以同學給你的代號加好友。',
    action: '找同學',
    icon: 'friends',
    group: 'community',
    keywords: '同學 好友 朋友 代號 friends people',
  },
  {
    href: '/timetable',
    title: '共同空堂',
    text: '好友開放課表分享後，找兩個人都有空的時段。需要學校帳號。',
    action: '找共同空堂',
    icon: 'timetable',
    group: 'personal',
    keywords: '課表 課程 時間 安排 約時間 timetable schedule',
  },
];

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'public', label: '免登入' },
  { value: 'community', label: '交流與互助' },
  { value: 'personal', label: '個人安排' },
] as const;

type ServiceCategory = (typeof CATEGORIES)[number]['value'];

function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLowerCase().trim();
}

function RepairNotice() {
  return (
    <aside className={styles.repair} aria-labelledby="repair-title">
      <CampusIcon name="repair" size={22} />
      <div>
        <h3 id="repair-title">
          報修 <span>尚未開放</span>
        </h3>
        <p>報修還沒開，有問題先找系辦或總務處。</p>
      </div>
    </aside>
  );
}

function ServiceLink({ item, href }: { item: LifeService; href: string }) {
  return (
    <Link className={styles.service} href={href}>
      <span className={styles.icon}>
        <CampusIcon name={item.icon} size={25} />
      </span>
      <div className={styles.serviceBody}>
        <h3>{item.title}</h3>
        <p>{item.text}</p>
      </div>
      <span className={styles.action}>
        <span className={styles.actionText}>{item.action}</span>
        <CampusIcon name="arrow" size={18} />
      </span>
    </Link>
  );
}

function LifeDirectory() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ServiceCategory>('all');
  const searchInput = useRef<HTMLInputElement>(null);
  const params = useSearchParams();
  const selection = useOptionalSelectedSchool();
  const scope = buildCampusNavigationSearch(
    params,
    selection?.selectedSchool,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  const items = ITEMS.filter((item) => item.href !== '/orders' || isWebOnlineOrderingEnabled());
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const filtered = terms.length > 0 || category !== 'all';
  const matches = items.filter((item) => {
    if (category !== 'all' && item.group !== category) return false;
    const content = normalizeSearch(
      `${item.title} ${item.text} ${item.action} ${item.keywords} ${item.group === 'public' ? '免登入 不需登入 訪客' : ''}`,
    );
    return terms.every((term) => content.includes(term));
  });
  const showRepair =
    (category === 'all' || category === 'personal') &&
    terms.every((term) => normalizeSearch('報修 維修 設備 壞了 系辦 總務處 repair').includes(term));
  const resetFilters = () => {
    setQuery('');
    setCategory('all');
    searchInput.current?.focus();
  };

  return (
    <SiteShell title="生活" subtitle="找教室、搭公車、查館藏，先選你要做的事。">
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
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                  event.preventDefault();
                  setQuery('');
                }
              }}
              placeholder="借書、教室、公車…"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={80}
              aria-describedby="life-search-hint"
              aria-controls="life-service-results"
            />
            {query && (
              <button
                type="button"
                className={styles.clearSearch}
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
                aria-label="清除搜尋"
              >
                清除
              </button>
            )}
          </div>
          <p id="life-search-hint" className={styles.searchHint}>
            搜尋服務名稱或想做的事。
          </p>
        </form>
        <div className={styles.filterBar}>
          <div className={styles.categories} role="group" aria-label="服務分類">
            {CATEGORIES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={category === entry.value}
                aria-controls="life-service-results"
                onClick={() => setCategory(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true">
            {filtered ? '找到' : '共'} {matches.length} 項服務
            {filtered && showRepair ? '，報修尚未開放' : ''}
          </p>
        </div>
      </div>
      <div id="life-service-results">
        {filtered ? (
          <section aria-labelledby="service-results-title" className={styles.results}>
            <div className={styles.sectionHeading}>
              <h2 id="service-results-title">
                {terms.length
                  ? '搜尋結果'
                  : CATEGORIES.find((entry) => entry.value === category)?.label}
              </h2>
              <button type="button" className={styles.resetFilters} onClick={resetFilters}>
                顯示全部服務
              </button>
            </div>
            {matches.length ? (
              <ul className={styles.serviceList}>
                {matches.map((item) => (
                  <li key={item.href}>
                    <ServiceLink item={item} href={campusServiceHref(item.href, scope)} />
                  </li>
                ))}
              </ul>
            ) : !showRepair ? (
              <div className={styles.emptyResults}>
                <CampusIcon name="search" size={26} />
                <h3>沒有找到符合的服務</h3>
                <p>試試「借書」「搭車」，或切換上方分類。</p>
              </div>
            ) : null}
            {showRepair && <RepairNotice />}
          </section>
        ) : (
          <div className={styles.directory}>
            <section aria-labelledby="public-service-title">
              <div className={styles.sectionHeading}>
                <h2 id="public-service-title">常用查詢</h2>
                <span className={styles.accessNote}>不需登入</span>
              </div>
              <ul className={styles.publicGrid}>
                {items
                  .filter((item) => item.group === 'public')
                  .map((item) => (
                    <li key={item.href}>
                      <ServiceLink item={item} href={campusServiceHref(item.href, scope)} />
                    </li>
                  ))}
              </ul>
            </section>

            <div className={styles.secondarySections}>
              <section aria-labelledby="community-service-title">
                <div className={styles.sectionHeading}>
                  <h2 id="community-service-title">交流與互助</h2>
                  <span className={styles.sectionDetail}>與同學保持聯繫</span>
                </div>
                <ul className={styles.serviceList}>
                  {items
                    .filter((item) => item.group === 'community')
                    .map((item) => (
                      <li key={item.href}>
                        <ServiceLink item={item} href={campusServiceHref(item.href, scope)} />
                      </li>
                    ))}
                </ul>
              </section>

              <section aria-labelledby="personal-service-title">
                <div className={styles.sectionHeading}>
                  <h2 id="personal-service-title">個人安排</h2>
                </div>
                <ul className={styles.serviceList}>
                  {items
                    .filter((item) => item.group === 'personal')
                    .map((item) => (
                      <li key={item.href}>
                        <ServiceLink item={item} href={campusServiceHref(item.href, scope)} />
                      </li>
                    ))}
                </ul>
                <RepairNotice />
              </section>
            </div>
          </div>
        )}
      </div>
    </SiteShell>
  );
}

function LifeLoadingFallback() {
  return (
    <SiteShell title="生活" subtitle="找教室、搭公車、查館藏，先選你要做的事。">
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
