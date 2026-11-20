'use client';

import Link from 'next/link';
import { ADMIN_ANNOUNCEMENTS_HREF } from '@/lib/adminNav';
import styles from './Admin.module.css';

/**
 * 平台工作台的校園公告 section：導向校管發佈頁。
 * 實際建立／編輯使用 Firebase 學校身分與既有 upsertSchoolAnnouncement，
 * 不在此新增平台授權檢查。
 */
export function AdminAnnouncements({ schoolId }: { schoolId: string | null }) {
  const href = schoolId
    ? `${ADMIN_ANNOUNCEMENTS_HREF}?schoolId=${encodeURIComponent(schoolId)}&campus=${encodeURIComponent(schoolId)}`
    : ADMIN_ANNOUNCEMENTS_HREF;

  return (
    <section className={styles.panel} aria-labelledby="admin-announcements-heading">
      <div className={styles.stack}>
        <div className={styles.sectionIntro}>
          <h2 id="admin-announcements-heading">校園公告發佈</h2>
          <p className={styles.muted}>
            請使用這所學校已授權的管理員或內容編輯帳號，查看、建立與編輯公告。
            開啟後會確認校方身分與公告權限。
          </p>
        </div>
        <p className={styles.muted}>
          {schoolId
            ? '開啟後會帶入目前選取的學校，並重新確認你在該校的權限。'
            : '尚未在工作台選校時，請在公告頁先選擇學校。'}
        </p>
        <div className={styles.actions}>
          <Link className={styles.link} href={href}>
            開啟校園公告編輯
          </Link>
          <Link className={styles.link} href="/announcements">
            查看公開公告列表
          </Link>
        </div>
      </div>
    </section>
  );
}
