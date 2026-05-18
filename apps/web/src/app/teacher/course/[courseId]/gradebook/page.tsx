'use client';

/**
 * Teacher · Course · Gradebook
 * TronClass parity 「成績簿」教師頁。
 * 使用 demoData.ts 的 DEMO_STUDENTS 確保學生名單與點名頁一致。
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { getStudentsForCourse, getDemoCourseById } from '@/lib/demoData';
import { publishGrades, getPendingSubmissions, useDemoStore } from '@/lib/demoStore';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  computeGradebook,
  type GradeItem,
  type StudentGradeInput,
} from '@campus/shared';

const ITEMS: GradeItem[] = [
  { id: 'hw',    title: '作業（3 次平均）', weight: 30 },
  { id: 'mid',   title: '期中考',           weight: 30 },
  { id: 'final', title: '期末考',           weight: 40 },
];

export default function TeacherGradebookPage({ params, searchParams }: { params: { courseId: string }; searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const [published, setPublished] = useState(false);
  const course = getDemoCourseById(params.courseId);
  // 依 courseId 取得該課程的學生名冊（c1: 12 位；其他課依 enrolledCourses 篩）
  const courseStudents = useMemo(() => getStudentsForCourse(params.courseId), [params.courseId]);
  const STUDENTS: StudentGradeInput[] = useMemo(
    () =>
      courseStudents.map((s) => ({
        uid: s.uid,
        displayName: `${s.displayName}（${s.studentId}）`,
        scores: [
          { gradeItemId: 'hw',    score: s.scores.hw    },
          { gradeItemId: 'mid',   score: s.scores.mid   },
          { gradeItemId: 'final', score: s.scores.final },
        ],
      })),
    [courseStudents],
  );
  const computed = useMemo(() => computeGradebook(ITEMS, STUDENTS, { published }), [STUDENTS, published]);
  const store = useDemoStore();
  const { success } = useToast();
  const pendingSubmissions = getPendingSubmissions(params.courseId, store);

  const classAvg = useMemo(() => {
    const finals = computed.rows.map((r) => r.finalScore ?? 0);
    return finals.length > 0
      ? (finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(1)
      : '—';
  }, [computed.rows]);

  const passRate = useMemo(() => {
    const passed = computed.rows.filter((r) => r.passed).length;
    return computed.rows.length > 0
      ? Math.round((passed / computed.rows.length) * 100)
      : 0;
  }, [computed.rows]);

  return (
    <SiteShell title="成績簿" schoolName={schoolName}>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {!caps.canViewTeacherDashboard ? (
          <div className="card" style={{ padding: '24px 20px', textAlign: 'center', background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>教師工作台專用</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
              請從右上角「身份膠囊」切換為 🧑‍🏫 教師 或 🧑‍💻 助教 角色後再進入。
            </div>
            <Link href={`/${q}`} className="btn">← 回首頁</Link>
          </div>
        ) : <>
        <nav style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}${q}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>
          成績簿{isTaView ? '（批改視角）' : ''}{' '}
          {course ? (
            <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--muted)' }}>
              — {course.name}
            </span>
          ) : null}
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
          班級平均 <strong>{classAvg}</strong> 分・通過率 <strong>{passRate}%</strong>・
          共 {courseStudents.length} 位學生（示範名單）
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
              color: '#007AFF',
              marginBottom: 16,
            }}
          >
            🧑‍💻 <strong>助教 TA 視角</strong>：可查看成績明細、協助批改，但
            <strong>無法發布或撤回成績</strong>（授課教師專用）。
          </div>
        )}

        {/* 快速統計卡 */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: '學生總數', value: courseStudents.length,                                            color: '#007AFF' },
            { label: '班級平均', value: classAvg,                                                          color: '#34C759' },
            { label: '通過率',   value: `${passRate}%`,                                                    color: '#FF9500' },
            { label: 'A 以上',   value: computed.rows.filter((r) => (r.finalScore ?? 0) >= 90).length,     color: '#007AFF' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                padding: '14px 20px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--panel)',
                textAlign: 'center', minWidth: 100,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* 待批改繳交提醒 */}
        {pendingSubmissions.length > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,149,0,0.10)', border: '1px solid #FF9500', fontSize: 13, marginBottom: 12 }}>
            📬 <strong>有 {pendingSubmissions.length} 份新繳交待批改：</strong>
            {pendingSubmissions.slice(0, 3).map((s) => s.studentName).join('、')}
            {pendingSubmissions.length > 3 ? ` 等 ${pendingSubmissions.length} 人` : ''}
          </div>
        )}

        {/* 發布按鈕：TA 不可用 */}
        {caps.canPublishGrades ? (
          <button
            style={{
              padding: '10px 16px', borderRadius: 8, marginBottom: 16,
              background: published ? '#FF3B30' : '#34C759',
              color: '#fff', border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
            onClick={() => {
              const next = !published;
              setPublished(next);
              if (next && course) {
                // 計算王小明（stu-001）的「展示用」成績（summary 帶到通知裡）
                const demoRow = computed.rows.find((r) => r.uid === 'stu-001');
                const summaryScore = demoRow?.finalScore ?? 96;
                const summaryGrade =
                  summaryScore >= 90 ? 'A+' : summaryScore >= 85 ? 'A' : summaryScore >= 80 ? 'A-' :
                  summaryScore >= 75 ? 'B+' : summaryScore >= 70 ? 'B' : summaryScore >= 65 ? 'B-' :
                  summaryScore >= 60 ? 'C' : 'F';
                // 全班發布：把 computed.rows 轉成 studentScores（demoStore 端會逐筆寫入 publishedGrades）
                // 過濾掉沒有 finalScore 的列（例如尚未繳交），並對 null 做 fallback
                const studentScores = computed.rows
                  .filter((r) => r.finalScore != null)
                  .map((r) => {
                    const s = r.finalScore as number;
                    return {
                      studentId: r.uid,
                      score: s,
                      grade:
                        s >= 90 ? 'A' :
                        s >= 80 ? 'B' :
                        s >= 70 ? 'C' :
                        s >= 60 ? 'D' : 'F',
                    };
                  });
                publishGrades({
                  courseId: params.courseId,
                  courseName: course.name,
                  studentScores,
                  summaryScore,
                  summaryGrade,
                });
                success(`✅ 已對全班 ${studentScores.length} 位學生發布成績（${course.name}）`);
              }
            }}
          >
            {published ? '📤 撤回發布' : '🚀 發布最終成績（全班可見）'}
          </button>
        ) : (
          <button
            disabled
            title="發布成績為授課教師專用"
            style={{
              padding: '10px 16px', borderRadius: 8, marginBottom: 16,
              background: 'var(--border)', color: 'var(--muted-light)',
              border: 'none', cursor: 'not-allowed', fontSize: 14,
            }}
          >
            🔒 發布最終成績（教師專用）
          </button>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--panel)', textAlign: 'left' }}>
                <th style={th}>學生姓名</th>
                {computed.items.map((it) => (
                  <th key={it.id} style={th}>
                    {it.title}
                    <div style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>
                      {it.normalizedWeight}%
                    </div>
                  </th>
                ))}
                <th style={th}>加權總分</th>
                <th style={th}>等第</th>
                <th style={th}>結果</th>
              </tr>
            </thead>
            <tbody>
              {computed.rows.map((row) => {
                const score = row.finalScore ?? 0;
                const grade =
                  score >= 90 ? 'A+' :
                  score >= 85 ? 'A'  :
                  score >= 80 ? 'A-' :
                  score >= 75 ? 'B+' :
                  score >= 70 ? 'B'  :
                  score >= 65 ? 'B-' :
                  score >= 60 ? 'C'  : 'F';
                const gradeColor =
                  grade.startsWith('A') ? '#34C759' :
                  grade.startsWith('B') ? '#007aff' :
                  grade === 'C'         ? '#d97706' : '#FF3B30';
                const isDemoUser = row.uid === 'stu-001';

                return (
                  <tr
                    key={row.uid}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: isDemoUser ? 'rgba(0,122,255,0.07)' : undefined,
                    }}
                  >
                    <td style={{ ...td, fontWeight: isDemoUser ? 700 : 400 }}>
                      {row.displayName}
                      {isDemoUser && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#007AFF', fontWeight: 600 }}>
                          ★ demo
                        </span>
                      )}
                    </td>
                    {row.breakdown.map((b) => (
                      <td key={b.gradeItemId} style={td}>
                        {b.score ?? '—'}
                        {b.isLate && ' 🟡'}
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700, fontSize: 16 }}>{score}</td>
                    <td style={{ ...td, fontWeight: 700, color: gradeColor }}>{grade}</td>
                    <td style={td}>
                      {row.passed ? (
                        <span style={{ color: '#34C759', fontWeight: 600 }}>✅ 通過</span>
                      ) : (
                        <span style={{ color: '#FF3B30', fontWeight: 600 }}>⚠️ 未通過</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--muted-light)' }}>
          ＊ 示範名單顯示前 {courseStudents.length} 位學生（來自 demoData getStudentsForCourse）；
          {course
            ? `實際班級共 ${course.members} 位，其餘 ${course.members - courseStudents.length} 位連接 Firebase 後可見。`
            : '連接 Firebase 後顯示完整名單。'}
        </p>

        {/* ── AI 成績分析入口 ── */}
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(15,139,141,0.08)',
            border: '1px solid #007AFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#007AFF', marginBottom: 3 }}>🤖 AI 成績分析</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              讓 AI 找出成績偏低的學生，分析作業與考試的相關性，並生成成績摘要報告。
            </div>
          </div>
          <a
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我分析「${course?.name ?? '資料結構'}」班級成績分布：哪些學生需要特別關注？作業成績和考試成績有什麼相關性？`)}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            問 AI →
          </a>
        </div>
        </>}
      </main>
    </SiteShell>
  );
}

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14 } as const;
const td = { padding: '12px 8px', fontSize: 14 } as const;
