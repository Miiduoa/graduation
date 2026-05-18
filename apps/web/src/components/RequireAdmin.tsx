/**
 * RequireAdmin — Admin / Teacher gate
 * ──────────────────────────────────────────────────
 * 給 LMS v2 admin 頁用。
 * 規則:demoRole 為 'teacher' / 'admin' / 'department' 之一才放行。
 * 若無權限,顯示提示,不轉跳 (避免 SSR 失誤)。
 */
'use client';

import { type ReactNode } from 'react';
import { useDemoRole } from '@/lib/demoRole';

const ADMIN_LIKE = new Set(['teacher', 'admin', 'department_head', 'ta']);

export function RequireAdmin({ children }: { children: ReactNode }) {
  const [role] = useDemoRole();
  if (!ADMIN_LIKE.has(String(role))) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          color: 'var(--muted)',
          maxWidth: 480,
          margin: '120px auto',
        }}
      >
        <h2 style={{ fontSize: 20, marginBottom: 12, color: 'var(--text)' }}>
          需要管理員身分
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          此頁只有教師、助教、系所主管或管理員身分可使用。請從右上角切換身分，
          或聯絡你的系所窗口。
        </p>
        <p style={{ fontSize: 12, marginTop: 16, color: 'var(--muted-light)' }}>
          目前身分: {String(role)}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export default RequireAdmin;
