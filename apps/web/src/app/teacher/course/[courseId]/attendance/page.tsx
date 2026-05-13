'use client';

/**
 * Teacher · Course · Attendance
 * TronClass parity 「點名」教師頁。
 */
import Link from 'next/link';
import { useState } from 'react';

import { SiteShell } from '@/components/SiteShell';

type SessionRow = {
  id: string;
  startedAt: string;
  active: boolean;
  presentCount: number;
  totalCount: number;
  mode: 'qr' | 'tap' | 'manual';
};

const MOCK: SessionRow[] = [
  { id: 'a1', startedAt: '2026-05-13 09:10', active: false, presentCount: 38, totalCount: 42, mode: 'qr' },
  { id: 'a2', startedAt: '2026-05-06 09:10', active: false, presentCount: 40, totalCount: 42, mode: 'qr' },
];

export default function TeacherAttendancePage({ params }: { params: { courseId: string } }) {
  const [running, setRunning] = useState(false);

  return (
    <SiteShell>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>點名管理</h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          開啟 QR 點名後，學生用 mobile App 的 AttendanceLiveScreen 掃描即可簽到。
        </p>

        <div
          style={{
            padding: 24,
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>目前點名狀態</div>
            <div style={{ color: '#6b7280', fontSize: 14 }}>
              {running ? '🟢 點名進行中（QR）' : '⚪ 尚未開啟'}
            </div>
          </div>
          <button
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              background: running ? '#dc2626' : '#16a34a',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
            }}
            onClick={() => setRunning((s) => !s)}
          >
            {running ? '結束點名' : '開啟 QR 點名'}
          </button>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>歷史 sessions</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={th}>開始時間</th>
              <th style={th}>出席率</th>
              <th style={th}>模式</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {MOCK.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{s.startedAt}</td>
                <td style={td}>
                  {s.presentCount} / {s.totalCount}（{Math.round((s.presentCount / s.totalCount) * 100)}%）
                </td>
                <td style={td}>{s.mode.toUpperCase()}</td>
                <td style={td}>
                  <button style={linkBtn}>查看名單</button>
                  <button style={linkBtn}>匯出 CSV</button>
                </td>
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
