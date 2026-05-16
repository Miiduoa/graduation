'use client';

/**
 * Teacher · Course · Modules
 * TronClass parity 「教材單元」教師管理頁。
 *
 * 暫以 mock 串接，後續接 fetchCourseWorkspace().modules。
 */
import Link from 'next/link';
import { useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';

type ModuleRow = {
  id: string;
  title: string;
  week: number;
  materialCount: number;
  visible: boolean;
};

const MOCK: ModuleRow[] = [
  { id: 'm1', title: '第 1 週：課程簡介', week: 1, materialCount: 3, visible: true },
  { id: 'm2', title: '第 2 週：關聯模型', week: 2, materialCount: 5, visible: true },
  { id: 'm3', title: '第 3 週：SQL 基礎', week: 3, materialCount: 4, visible: false },
];

export default function TeacherModulesPage({ params }: { params: { courseId: string } }) {
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const [rows, setRows] = useState<ModuleRow[]>(MOCK);

  const toggleVisible = (id: string) => {
    if (!caps.canEditModules) return;
    setRows((r) => r.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)));
  };

  return (
    <SiteShell>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          教材單元管理{isTaView ? '（檢視）' : ''}
        </h1>
        <p style={{ color: '#6b7280', marginBottom: isTaView ? 12 : 24 }}>
          管理本課程的週次與教材；勾選後學生才看得到。
        </p>

        {/* TA 提示 */}
        {isTaView && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(124,58,237,0.10)',
              border: '1px solid #7C3AED',
              fontSize: 13,
              color: '#5B21B6',
              marginBottom: 20,
            }}
          >
            🧑‍💻 <strong>助教 TA 視角</strong>：可查看教材結構，但<strong>無法新增、編輯或調整可見性</strong>（授課教師專用）。
          </div>
        )}

        {/* 新增按鈕：TA 不可用 */}
        {caps.canEditModules ? (
          <button
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              background: '#1F4E78',
              color: '#fff',
              border: 'none',
              marginBottom: 16,
              cursor: 'pointer',
            }}
          >
            + 新增單元
          </button>
        ) : (
          <button
            disabled
            title="新增單元為授課教師專用"
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              background: '#e5e7eb',
              color: '#9ca3af',
              border: 'none',
              marginBottom: 16,
              cursor: 'not-allowed',
            }}
          >
            🔒 新增單元（教師專用）
          </button>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={th}>週次</th>
              <th style={th}>標題</th>
              <th style={th}>教材數</th>
              <th style={th}>可見</th>
              {caps.canEditModules && <th style={th}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>第 {m.week} 週</td>
                <td style={td}>{m.title}</td>
                <td style={td}>{m.materialCount} 個</td>
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={m.visible}
                    onChange={() => toggleVisible(m.id)}
                    disabled={!caps.canEditModules}
                    style={{ cursor: caps.canEditModules ? 'pointer' : 'not-allowed' }}
                  />
                </td>
                {caps.canEditModules && (
                  <td style={td}>
                    <button style={linkBtn}>編輯</button>
                    <button style={linkBtn}>新增教材</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </SiteShell>
  );
}

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14 } as const;
const td = { padding: '12px 8px', fontSize: 14 } as const;
const linkBtn = {
  background: 'transparent',
  color: '#1F4E78',
  border: 'none',
  cursor: 'pointer',
  marginRight: 8,
  textDecoration: 'underline',
} as const;
