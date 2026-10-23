'use client';

import Link from 'next/link';
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
};

const ITEMS: LifeService[] = [
  {
    href: '/map',
    title: '校園地圖',
    text: '找教室、行政單位和地點。',
    action: '找地點',
    icon: 'map',
    group: 'public',
  },
  {
    href: '/bus',
    title: '公車',
    text: '查路線與站牌；到站預估依資料來源提供。',
    action: '查公車',
    icon: 'bus',
    group: 'public',
  },
  {
    href: '/cafeteria',
    title: '餐廳',
    text: '查看餐廳提供的菜單與營業資訊。',
    action: '看餐廳',
    icon: 'cafeteria',
    group: 'public',
  },
  {
    href: '/library',
    title: '圖書館',
    text: '搜尋館藏，前往學校系統辦理借閱與續借。',
    action: '查館藏',
    icon: 'library',
    group: 'public',
  },
  {
    href: '/announcements',
    title: '公開公告',
    text: '查看學校發布的公開消息。',
    action: '看公告',
    icon: 'announcements',
    group: 'public',
  },
  {
    href: '/lost-found',
    title: '失物招領',
    text: '用 Google 帳號登入後，查看或刊登遺失與拾獲物品。',
    action: '找失物',
    icon: 'lost-found',
    group: 'community',
  },
  {
    href: '/orders',
    title: '我的訂單',
    text: '看訂單狀態和取餐號碼。',
    action: '查訂單',
    icon: 'orders',
    group: 'personal',
  },
  {
    href: '/social',
    title: '跨校交流',
    text: '用 Google 帳號登入，在公開看板閱讀與分享近況。',
    action: '看公開看板',
    icon: 'social',
    group: 'community',
  },
  {
    href: '/community',
    title: '校園交流',
    text: '使用學校帳號查看校內話題。',
    action: '看校內話題',
    icon: 'community',
    group: 'community',
  },
  {
    href: '/friends',
    title: '找人',
    text: '使用學校帳號，以同學給你的代號加好友。',
    action: '找同學',
    icon: 'friends',
    group: 'community',
  },
  {
    href: '/timetable',
    title: '共同空堂',
    text: '好友開放課表分享後，找兩個人都有空的時段。需要學校帳號。',
    action: '找共同空堂',
    icon: 'timetable',
    group: 'personal',
  },
];

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
        {item.action}
        <CampusIcon name="arrow" size={18} />
      </span>
    </Link>
  );
}

export default function LifePage() {
  const selection = useOptionalSelectedSchool();
  const scope = buildCampusNavigationSearch(
    null,
    selection?.selectedSchool,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  const items = ITEMS.filter((item) => item.href !== '/orders' || isWebOnlineOrderingEnabled());
  return (
    <SiteShell title="生活" subtitle="找教室、搭公車、查館藏，先選你要做的事。">
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
            <aside className={styles.repair} aria-labelledby="repair-title">
              <CampusIcon name="repair" size={22} />
              <div>
                <h3 id="repair-title">
                  報修 <span>尚未開放</span>
                </h3>
                <p>報修還沒開，有問題先找系辦或總務處。</p>
              </div>
            </aside>
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
