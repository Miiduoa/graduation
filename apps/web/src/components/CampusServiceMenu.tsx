'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import styles from '@/app/home.module.css';

const services = [
  ['/announcements', '公告'],
  ['/timetable', '課表'],
  ['/grades', '成績'],
  ['/credit-planner', '學分規劃'],
  ['/groups', '課程與群組'],
  ['/classroom', '課程空間'],
  ['/clubs', '社團活動'],
  ['/community', '校園交流'],
  ['/messages', '通知'],
  ['/dms', '私訊'],
  ['/map', '校園地圖'],
  ['/bus', '公車'],
  ['/cafeteria', '餐廳'],
  ['/library', '圖書館'],
  ['/ai-assistant', '校園助理'],
  ['/profile', '個人資料'],
  ['/settings', '設定'],
] as const;

export function CampusServiceMenu() {
  const pathname = usePathname();
  const params = useSearchParams();
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId']) {
    const value = params?.get(key);
    if (value) context.set(key, value);
  }
  const href = (path: string) => `${path}${context.size ? `?${context}` : ''}`;
  return (
    <details className={styles.menu} key={pathname}>
      <summary>所有服務</summary>
      <div className={styles.menuPanel}>
        <Link
          href={href('/search')}
          className={styles.menuOverview}
          aria-current={pathname === '/search' ? 'page' : undefined}
        >
          尋找校園服務 <span aria-hidden="true">→</span>
        </Link>
        {services.map(([path, label]) => (
          <Link
            href={href(path)}
            key={path}
            aria-current={
              pathname === path || (path === '/classroom' && pathname?.startsWith('/classroom/'))
                ? 'page'
                : undefined
            }
          >
            {label}
          </Link>
        ))}
      </div>
    </details>
  );
}
