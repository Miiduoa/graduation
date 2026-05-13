'use client';

/**
 * Teacher · Course · Gradebook
 * TronClass parity 「成績簿」教師頁。
 * 走 packages/shared/src/lms/gradebookCompute 計算加權。
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import {
  computeGradebook,
  type GradeItem,
  type StudentGradeInput,
} from '@campus/shared';

const ITEMS: GradeItem[] = [
  { id: 'hw', title: '作業（3 次平均）', weight: 30 },
  { id: 'mid', title: '期中考', weight: 30 },
  { id: 'final', title: '期末考', weight: 40 },
];

const STUDENTS: StudentGradeInput[] = [
  { uid: 'u1', displayName: '阿明', scores: [{ gradeItemId: 'hw', score: 90 }, { gradeItemId: 'mid', score: 80 }, { gradeItemId: 'final', score: 70 }] },
  { uid: 'u2', displayName: '小華', scores: [{ gradeItemId: 'hw', score: 50 }, { gradeItemId: 'mid', score: 55 }, { gradeItemId: 'final', score: 50 }] },
  { uid: 'u3', displayName: '小芳', scores: [{ gradeItemId: 'hw', score: 95 }, { gradeItemId: 'mid', score: 92 }, { gradeItemId: 'final', score: 88 }] },
];

export default function TeacherGradebookPage({ params }: { params: { courseId: string } }) {
  const [published, setPublished] = useState(false);
  const computed = useMemo(() => computeGradebook(ITEMS, STUDENTS, { published }), [published]);

  return (
    <SiteShell>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>成績簿</h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>
          班級平均 {computed.classAverage ?? '—'} 分・通過率 {computed.passRate ?? '—'}%
        </p>

        <button
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            background: published ? '#dc2626' : '#16a34a',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            marginBottom: 16,
          }}
          onClick={() => setPublished((p) => !p)}
        >
          {published ? '撤回發布' : '🚀 發布最終成績'}
        </button>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={th}>學生</th>
              {computed.items.map((it) => (
                <th key={it.id} style={th}>
                  {it.title}
                  <div style={{ fontWeight: 400, fontSize: 12, color: '#6b7280' }}>
                    權重 {it.normalizedWeight}%
                  </div>
                </th>
              ))}
              <th style={th}>加權總分</th>
              <th style={th}>結果</th>
            </tr>
          </thead>
          <tbody>
            {computed.rows.map((row) => (
              <tr key={row.uid} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{row.displayName}</td>
                {row.breakdown.map((b) => (
                  <td key={b.gradeItemId} style={td}>
                    {b.score ?? '—'} {b.isLate && '🟡'}
                  </td>
                ))}
                <td style={{ ...td, fontWeight: 700 }}>{row.finalScore ?? '—'}</td>
                <td style={td}>
                  {row.passed ? (
                    <span style={{ color: '#16a34a' }}>✅ 通過</span>
                  ) : (
                    <span style={{ color: '#dc2626' }}>⚠️ 未通過</span>
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
