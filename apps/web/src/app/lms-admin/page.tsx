'use client';

import Link from 'next/link';

import { RequireAdmin } from '@/components/RequireAdmin';

export default function AdminHomePage() {
  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>總覽</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
        此後台使用瀏覽器端的 Supabase anon key；資料列的可見性完全交由 RLS 控制（profiles.role = admin 可唯讀課程／成員／使用者）。
      </p>
      <ul style={{ lineHeight: 1.8 }}>
        <li>
          <Link href="/lms-admin/courses">課程列表</Link>
        </li>
        <li>
          <Link href="/lms-admin/reports">成績彙總圖／CSV（course_grade_rollups）</Link>
        </li>
        <li>
          <Link href="/lms-admin/role-matrix">組態 RBAC：`course_role_capabilities`</Link>
        </li>
        <li>
          <Link href="/lms-admin/members">課程成員快照（上限 300 筆）</Link>
        </li>
        <li>
          <Link href="/lms-admin/notify">對課程發送站內通知（notify_course_members）</Link>
        </li>
        <li>
          <Link href="/lms-admin/push-logs">推播發送紀錄與 DLQ（dispatch-notification-push）</Link>
        </li>
        <li>
          <Link href="/lms-admin/export-jobs">匯出任務（非同步 worker）</Link>
        </li>
        <li>
          <Link href="/lms-admin/ai-compliance">AI 合規組態（quota／保留期／PII／跨境）</Link>
        </li>
        <li>
          <Link href="/lms-admin/audit">audit_logs（forum / grades 異動）</Link>
        </li>
        <li>
          <Link href="/lms-admin/bulk-import">課程成員批次匯入</Link>
        </li>
        <li>
          <Link href="/lms-admin/wave5">Wave 5 核心模組（行事曆／問卷／小組／徽章）</Link>
        </li>
        <li>
          <Link href="/lms-admin/wave6">Wave 6 核心模組（LTI／Rubric／會議／直播／工作量）</Link>
        </li>
        <li>
          <Link href="/lms-admin/dashboard">教學儀表板（預警／搜尋／儀表板）</Link>
        </li>
      </ul>
    </RequireAdmin>
  );
}
