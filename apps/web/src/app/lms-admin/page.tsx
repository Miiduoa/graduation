'use client';

import Link from 'next/link';
import styles from './workbench.module.css';

import { RequireAdmin } from '@/components/RequireAdmin';

export default function AdminHomePage() {
  return (
    <RequireAdmin>
      <h2>總覽</h2>
      <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
        依管理權限查看課程、成員與教學紀錄。
      </p>
      <ul className={styles.directory}>
        <li>
          <Link href="/lms-admin/courses">課程列表</Link>
        </li>
        <li>
          <Link href="/lms-admin/reports">成績統計與 CSV 匯出</Link>
        </li>
        <li>
          <Link href="/lms-admin/role-matrix">課程角色與權限</Link>
        </li>
        <li>
          <Link href="/lms-admin/members">課程成員（最多 300 筆）</Link>
        </li>
        <li>
          <Link href="/lms-admin/notify">發送課程通知</Link>
        </li>
        <li>
          <Link href="/lms-admin/push-logs">推播紀錄與失敗佇列</Link>
        </li>
        <li>
          <Link href="/lms-admin/export-jobs">匯出作業</Link>
        </li>
        <li>
          <Link href="/lms-admin/ai-compliance">資料處理與保留設定</Link>
        </li>
        <li>
          <Link href="/lms-admin/audit">討論區與成績異動紀錄</Link>
        </li>
        <li>
          <Link href="/lms-admin/bulk-import">課程成員批次匯入</Link>
        </li>
        <li>
          <Link href="/lms-admin/wave5">行事曆、問卷、小組與徽章</Link>
        </li>
        <li>
          <Link href="/lms-admin/wave6">教學工具、直播與工作量</Link>
        </li>
        <li>
          <Link href="/lms-admin/dashboard">學習活動與預警</Link>
        </li>
      </ul>
    </RequireAdmin>
  );
}
