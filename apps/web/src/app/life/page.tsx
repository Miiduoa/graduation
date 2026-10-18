'use client';

import Link from 'next/link';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { SiteShell } from '@/components/SiteShell';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import styles from '@/components/academic/academic.module.css';

const ITEMS = [
  { href: '/map', title: '校園地圖', text: '找教室、行政單位和地點。', action: '找地點' },
  { href: '/bus', title: '公車', text: '查路線與站牌；到站預估依資料來源提供。', action: '查公車' },
  { href: '/cafeteria', title: '餐廳', text: '查看餐廳提供的菜單與營業資訊。', action: '看餐廳' },
  { href: '/library', title: '圖書館', text: '搜尋館藏，前往學校系統辦理借閱與續借。', action: '查館藏' },
  { href: '/announcements', title: '公開公告', text: '查看學校發布的公開消息。', action: '看公告' },
  { href: '/lost-found', title: '失物招領', text: '用 Google 帳號登入後，查看或刊登遺失與拾獲物品。', action: '找失物' },
  { href: '/orders', title: '我的訂單', text: '看訂單狀態和取餐號碼。', action: '查訂單' },
  { href: '/social', title: '跨校交流', text: '用 Google 帳號登入，在公開看板閱讀與分享近況。', action: '看公開看板' },
  { href: '/community', title: '校園交流', text: '使用學校帳號查看校內話題。', action: '看校內話題' },
  { href: '/friends', title: '找人', text: '使用學校帳號，以同學給你的代號加好友。', action: '找同學' },
  { href: '/timetable', title: '共同空堂', text: '好友開放課表分享後，找兩個人都有空的時段。需要學校帳號。', action: '找共同空堂' },
];

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
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.href + item.title}>
            <div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
            <Link className="btn" href={campusServiceHref(item.href, scope)}>
              {item.action} <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
        <li>
          <div>
            <h3>報修</h3>
            <p>報修還沒開，有問題先找系辦或總務處。</p>
          </div>
        </li>
      </ul>
    </SiteShell>
  );
}
