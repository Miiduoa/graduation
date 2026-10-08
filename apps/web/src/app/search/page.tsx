'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import styles from './search.module.css';

const CATEGORIES = [
  { id: 'study', label: '學習與課務', description: '查課表、整理學分，接續課堂上的事。' },
  { id: 'campus', label: '校園生活', description: '找教室、看公車，安排課堂以外的時間。' },
  { id: 'connect', label: '消息與交流', description: '看看校園近況，接收通知與朋友的訊息。' },
  { id: 'account', label: '帳號與協助', description: '管理個人資料，找到需要的協助。' },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

const SERVICES = [
  {
    name: '課表',
    text: '查看本人的課程時間與教室',
    href: '/timetable',
    keywords: '上課 行事曆 schedule',
    category: 'study',
  },
  {
    name: '成績',
    text: '查詢學校提供的學期成績',
    href: '/grades',
    keywords: '分數 學期 grade',
    category: 'study',
  },
  {
    name: '學分規劃',
    text: '依修課紀錄與自訂目標整理學分',
    href: '/credit-planner',
    keywords: '畢業 學分 credit',
    category: 'study',
  },
  {
    name: '課程與群組',
    text: '開啟已加入的課程，或使用邀請碼加入',
    href: '/groups',
    keywords: '作業 教材 教師 點名 course',
    category: 'study',
  },
  {
    name: '公告',
    text: '查詢校園公開公告',
    href: '/announcements',
    keywords: '消息 news',
    category: 'connect',
  },
  {
    name: '社團活動',
    text: '查看已加入的社團',
    href: '/clubs',
    keywords: '社團 club',
    category: 'campus',
  },
  {
    name: '通知',
    text: '查看本人收到的服務通知',
    href: '/messages',
    keywords: '提醒 notification',
    category: 'connect',
  },
  {
    name: '私訊',
    text: '接續已建立的對話',
    href: '/dms',
    keywords: '聊天 message',
    category: 'connect',
  },
  {
    name: '校園交流',
    text: '閱讀與分享校園話題',
    href: '/community',
    keywords: '貼文 社群 community',
    category: 'connect',
  },
  {
    name: '校園地圖',
    text: '查詢校內地點',
    href: '/map',
    keywords: '大樓 教室 位置 map',
    category: 'campus',
  },
  { name: '公車', text: '查詢路線與站牌', href: '/bus', keywords: '交通 bus', category: 'campus' },
  {
    name: '餐廳',
    text: '查看餐廳與菜單資料',
    href: '/cafeteria',
    keywords: '午餐 晚餐 餐點 food',
    category: 'campus',
  },
  {
    name: '圖書館',
    text: '搜尋館藏，前往本人借閱帳號',
    href: '/library',
    keywords: '書籍 借書 續借 library',
    category: 'campus',
  },
  {
    name: '校園助理',
    text: '詢問校園服務與課務問題',
    href: '/ai-assistant',
    keywords: '問答 assistant',
    category: 'account',
  },
  {
    name: '個人資料',
    text: '查看與更新你的校園個人資料',
    href: '/profile',
    keywords: '姓名 學號 科系 profile',
    category: 'account',
  },
  {
    name: '設定',
    text: '調整外觀、通知與個人資料',
    href: '/settings',
    keywords: '主題 帳號 個人資料 setting',
    category: 'account',
  },
];

export default function SearchPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const term = query.trim().toLocaleLowerCase();
  const matches = SERVICES.filter(
    (service) =>
      (category === 'all' || service.category === category) &&
      `${service.name} ${service.text} ${service.keywords}`.toLocaleLowerCase().includes(term),
  );
  function resetFilters() {
    setQuery('');
    setCategory('all');
  }
  return (
    <SiteShell
      title="所有服務"
      subtitle="從今天要做的事，找到需要的校園服務。"
      schoolName={schoolName}
    >
      <div className={styles.directory}>
        <section className={styles.searchPanel} aria-label="尋找服務">
          <label htmlFor="service-search">想找什麼？</label>
          <input
            id="service-search"
            className={styles.searchInput}
            type="search"
            value={query}
            maxLength={100}
            placeholder="課表、借書、公車…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.filters} role="group" aria-label="服務分類">
            {[{ id: 'all', label: '全部' }, ...CATEGORIES].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id as Category | 'all')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
        <div className={styles.resultSummary}>
          <p role="status" aria-live="polite">
            找到 {matches.length} 項服務
          </p>
          {(term || category !== 'all') && (
            <button type="button" onClick={resetFilters}>
              清除篩選
            </button>
          )}
        </div>
        {matches.length ? (
          CATEGORIES.map((group) => {
            const services = matches.filter((service) => service.category === group.id);
            if (!services.length) return null;
            return (
              <section
                className={styles.category}
                key={group.id}
                aria-labelledby={`category-${group.id}`}
              >
                <div className={styles.categoryHeading}>
                  <h2 id={`category-${group.id}`}>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
                <div className={styles.services}>
                  {services.map((service) => (
                    <Link
                      key={service.href}
                      className={styles.service}
                      href={`${service.href}${schoolSearch}`}
                    >
                      <div>
                        <h3>{service.name}</h3>
                        <p>{service.text}</p>
                      </div>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <section className={styles.empty}>
            <h2>沒有符合的服務</h2>
            <p>試試「課表」或「公車」等關鍵字，也可以清除篩選，查看所有服務。</p>
            <button type="button" className="btn primary" onClick={resetFilters}>
              查看所有服務
            </button>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
