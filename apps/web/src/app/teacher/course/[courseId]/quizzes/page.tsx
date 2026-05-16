'use client';

/**
 * Teacher · Course · Quizzes
 * TronClass parity 「測驗管理」頁。
 */
import Link from 'next/link';
import { useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';

type QuizRow = {
  id: string;
  title: string;
  type: 'quiz' | 'exam';
  dueAt: string | null;
  submitted: number;
  total: number;
  gradesPublished: boolean;
};

const MOCK: QuizRow[] = [
  { id: 'q1', title: '第三週小考', type: 'quiz', dueAt: '2026-05-20', submitted: 30, total: 42, gradesPublished: false },
  { id: 'q2', title: '期中考', type: 'exam', dueAt: '2026-06-10', submitted: 0, total: 42, gradesPublished: false },
];

export default function TeacherQuizzesPage({ params }: { params: { courseId: string } }) {
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const [rows, setRows] = useState<QuizRow[]>(MOCK);
  const publish = (id: string) => {
    if (!caps.canPublishGrades) return;
    setRows((r) => r.map((q) => (q.id === id ? { ...q, gradesPublished: true } : q)));
  };

  return (
    <SiteShell>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>
          測驗 / 考試管理{isTaView ? '（檢視）' : ''}
        </h1>
        <p style={{ color: '#6b7280', marginBottom: isTaView ? 12 : 24 }}>
          設計題目、設定截止、發布成績。送出後 mobile 端 QuizTakingScreen 即可作答。
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
            🧑‍💻 <strong>助教 TA 視角</strong>：可查看作答情況，但<strong>無法新增測驗或發布成績</strong>（授課教師專用）。
          </div>
        )}

        {/* 新增按鈕：TA 不可用 */}
        {caps.canEditModules ? (
          <button style={primaryBtn}>+ 新增測驗</button>
        ) : (
          <button
            disabled
            title="新增測驗為授課教師專用"
            style={{ ...primaryBtn, background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' }}
          >
            🔒 新增測驗（教師專用）
          </button>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={th}>標題</th>
              <th style={th}>類型</th>
              <th style={th}>截止</th>
              <th style={th}>繳交</th>
              <th style={th}>狀態</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{q.title}</td>
                <td style={td}>{q.type === 'quiz' ? '小考' : '考試'}</td>
                <td style={td}>{q.dueAt ?? '—'}</td>
                <td style={td}>
                  {q.submitted} / {q.total}
                </td>
                <td style={td}>{q.gradesPublished ? '🟢 已發布' : '⚪ 待發布'}</td>
                <td style={td}>
                  {/* 編輯題目：TA 不可用 */}
                  {caps.canEditModules ? (
                    <button style={linkBtn}>編輯題目</button>
                  ) : null}
                  <button style={linkBtn}>看答案</button>
                  {/* 發布成績：TA 不可用 */}
                  {!q.gradesPublished && caps.canPublishGrades && (
                    <button style={linkBtn} onClick={() => publish(q.id)}>
                      發布成績
                    </button>
                  )}
                  {!q.gradesPublished && !caps.canPublishGrades && (
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>🔒 教師發布</span>
                  )}
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
const primaryBtn = {
  padding: '10px 16px',
  borderRadius: 8,
  background: '#1F4E78',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
} as const;
const linkBtn = {
  background: 'transparent',
  color: '#1F4E78',
  border: 'none',
  cursor: 'pointer',
  marginRight: 8,
  textDecoration: 'underline',
} as const;
