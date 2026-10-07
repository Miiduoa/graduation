'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import styles from '../home.module.css';

const SERVICES = [
  {
    name: '課表',
    text: '查看本人的課程時間與教室',
    href: '/timetable',
    keywords: '上課 行事曆 schedule',
  },
  { name: '成績', text: '查詢學校提供的學期成績', href: '/grades', keywords: '分數 學期 grade' },
  {
    name: '學分規劃',
    text: '依修課紀錄與自訂目標整理學分',
    href: '/credit-planner',
    keywords: '畢業 學分 credit',
  },
  {
    name: '課程與群組',
    text: '開啟已加入的課程，或使用邀請碼加入',
    href: '/groups',
    keywords: '作業 教材 教師 點名 course',
  },
  { name: '公告', text: '查詢校園公開公告', href: '/announcements', keywords: '消息 news' },
  { name: '社團活動', text: '查看已加入的社團', href: '/clubs', keywords: '社團 club' },
  {
    name: '通知',
    text: '查看本人收到的服務通知',
    href: '/messages',
    keywords: '提醒 notification',
  },
  { name: '私訊', text: '接續已建立的對話', href: '/dms', keywords: '聊天 message' },
  {
    name: '校園交流',
    text: '閱讀與分享校園話題',
    href: '/community',
    keywords: '貼文 社群 community',
  },
  { name: '校園地圖', text: '查詢校內地點', href: '/map', keywords: '大樓 教室 位置 map' },
  { name: '公車', text: '查詢路線與站牌', href: '/bus', keywords: '交通 bus' },
  { name: '餐廳', text: '查看餐廳與菜單資料', href: '/cafeteria', keywords: '午餐 晚餐 餐點 food' },
  {
    name: '圖書館',
    text: '搜尋館藏，前往本人借閱帳號',
    href: '/library',
    keywords: '書籍 借書 續借 library',
  },
  {
    name: '校園助理',
    text: '詢問校園服務與課務問題',
    href: '/ai-assistant',
    keywords: '問答 assistant',
  },
  {
    name: '設定',
    text: '調整外觀、通知與個人資料',
    href: '/settings',
    keywords: '主題 帳號 個人資料 setting',
  },
];

export default function SearchPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const matches = SERVICES.filter((service) =>
    `${service.name} ${service.text} ${service.keywords}`.toLocaleLowerCase().includes(term),
  );
  return (
    <SiteShell
      title="尋找校園服務"
      subtitle="先找到服務入口，再查詢你的資料。"
      schoolName={schoolName}
    >
      <section className={styles.section}>
        <label htmlFor="service-search">想找什麼？</label>
        <input
          id="service-search"
          className="input"
          type="search"
          value={query}
          maxLength={100}
          placeholder="課表、借書、公車…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="sectionText" role="status">
          {matches.length ? `${matches.length} 項服務` : '沒有符合的服務。試試不同的關鍵字。'}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
            gap: 12,
          }}
        >
          {matches.map((service) => (
            <Link
              key={service.href}
              className="card"
              href={`${service.href}${schoolSearch}`}
              style={{ padding: 20, textDecoration: 'none' }}
            >
              <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>{service.name}</h2>
              <p className="sectionText" style={{ margin: 0 }}>
                {service.text}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
