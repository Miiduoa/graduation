'use client';

/**
 * Teacher · Course · Question Bank
 * TronClass parity P1-2 題庫管理 + 抽題預覽。
 * 對應引擎：packages/shared/src/lms/questionBank
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  drawQuestionsForQuiz,
  checkQuestionBankHealth,
  type QuestionBank,
  type QuestionBankEntry,
} from '@campus/shared';

const SAMPLE: QuestionBank = {
  id: 'b1',
  schoolId: 'PU',
  title: '資料庫題庫',
  description: '中三：基本 SQL、JOIN、Normalization',
  entries: [
    { id: 'q1', type: 'single_choice', prompt: 'SELECT 哪個用來篩選 row？', difficulty: 1, topic: 'SQL', options: [
      { id: 'a', label: 'WHERE', value: 'WHERE', isCorrect: true },
      { id: 'b', label: 'GROUP BY', value: 'GROUP BY' },
    ] },
    { id: 'q2', type: 'multiple_choice', prompt: '哪些是 JOIN 類型？', difficulty: 2, topic: 'JOIN', options: [
      { id: 'a', label: 'INNER', value: 'INNER', isCorrect: true },
      { id: 'b', label: 'LEFT', value: 'LEFT', isCorrect: true },
      { id: 'c', label: 'SELECT', value: 'SELECT' },
    ] },
    { id: 'q3', type: 'short_answer', prompt: '第三正規化簡稱？', difficulty: 3, topic: 'NORMALIZATION', acceptableAnswers: ['3NF'] },
    { id: 'q4', type: 'true_false', prompt: 'NoSQL 一定比 SQL 快', difficulty: 1, topic: 'GENERAL', options: [
      { id: 't', label: '是', value: 'true' },
      { id: 'f', label: '否', value: 'false', isCorrect: true },
    ] },
  ],
};

// 固定難度分佈，不需要動態修改（移除 setDrawDist 避免 ESLint unused-vars 警告）
const DEFAULT_DRAW_DIST = { 1: 0.34, 2: 0.33, 3: 0.33 };

export default function QuestionBanksPage({ params, searchParams }: { params: { courseId: string }; searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const isReadOnlyView = isTaView || demoRole === 'department_head';
  const [bank, setBank] = useState<QuestionBank>(SAMPLE);
  const [drawCount, setDrawCount] = useState(3);

  const health = useMemo(() => checkQuestionBankHealth(bank), [bank]);
  const preview = useMemo(
    () =>
      drawQuestionsForQuiz(bank, {
        count: drawCount,
        difficultyDistribution: DEFAULT_DRAW_DIST,
        seed: 42,
      }),
    [bank, drawCount],
  );

  const updateEntry = (id: string, patch: Partial<QuestionBankEntry>) => {
    if (!caps.canEditQuestionBank) return;
    setBank((b) => ({
      ...b,
      entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  };

  const addEntry = () => {
    if (!caps.canEditQuestionBank) return;
    const id = `q${Date.now()}`;
    setBank((b) => ({
      ...b,
      entries: [
        ...b.entries,
        {
          id,
          type: 'single_choice',
          prompt: '新題目',
          difficulty: 2,
          topic: 'GENERAL',
          options: [
            { id: 'a', label: 'A', value: 'a', isCorrect: true },
            { id: 'b', label: 'B', value: 'b' },
          ],
        },
      ],
    }));
  };

  const removeEntry = (id: string) => {
    if (!caps.canEditQuestionBank) return;
    setBank((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }));
  };

  return (
    <SiteShell title="題庫管理" schoolName={schoolName}>
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
          題庫{isReadOnlyView ? '（檢視）' : ''}
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
          題目 {bank.entries.length} 道｜topic 覆蓋 {Object.keys(health.topicCoverage).length} 個
        </p>

        {/* TA / 系主任 唯讀提示 */}
        {isReadOnlyView && (
          <div
            style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
              background: isTaView ? 'rgba(124,58,237,0.10)' : 'rgba(255,149,0,0.10)',
              border: `1px solid ${isTaView ? '#7C3AED' : '#FF9500'}`,
              color: isTaView ? '#5B21B6' : '#92400E',
            }}
          >
            {isTaView
              ? <><span>🧑‍💻 </span><strong>助教 TA 視角</strong>：可瀏覽題庫內容，但<strong>無法新增、編輯或刪除題目</strong>（授課教師專用）。</>
              : <><span>🏛️ </span><strong>系主任視角</strong>：可唯讀瀏覽題庫，但<strong>無法新增、編輯或刪除題目</strong>（授課教師專用）。</>
            }
          </div>
        )}

        {/* 警告 */}
        {health.warnings.length > 0 && (
          <div
            style={{
              background: 'var(--warning-soft)',
              border: '1px solid var(--warning)',
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            {health.warnings.map((w, i) => (
              <div key={i} style={{ color: '#92400e', fontSize: 14 }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 24 }}>
          {/* ── 題目列 ── */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>題目列表</h2>
              {caps.canEditQuestionBank ? (
                <button onClick={addEntry} style={primaryBtn}>
                  + 新增題目
                </button>
              ) : (
                <button
                  disabled
                  title="新增題目為授課教師專用"
                  style={{ ...primaryBtn, background: 'var(--border)', color: 'var(--muted-light)', cursor: 'not-allowed' }}
                >
                  🔒 新增題目（教師專用）
                </button>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--panel)' }}>
                  <th style={th}>題目</th>
                  <th style={th}>類型</th>
                  <th style={th}>難度</th>
                  <th style={th}>Topic</th>
                  {caps.canEditQuestionBank && <th style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {bank.entries.map((e) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>
                      <input
                        value={e.prompt}
                        onChange={(ev) => updateEntry(e.id, { prompt: ev.target.value })}
                        style={inputCss}
                        disabled={!caps.canEditQuestionBank}
                      />
                    </td>
                    <td style={td}>{e.type}</td>
                    <td style={td}>
                      <select
                        value={e.difficulty}
                        onChange={(ev) =>
                          updateEntry(e.id, { difficulty: Number(ev.target.value) as 1 | 2 | 3 })
                        }
                        style={inputCss}
                        disabled={!caps.canEditQuestionBank}
                      >
                        <option value={1}>易</option>
                        <option value={2}>中</option>
                        <option value={3}>難</option>
                      </select>
                    </td>
                    <td style={td}>
                      <input
                        value={e.topic ?? ''}
                        onChange={(ev) => updateEntry(e.id, { topic: ev.target.value })}
                        style={{ ...inputCss, width: 100 }}
                        disabled={!caps.canEditQuestionBank}
                      />
                    </td>
                    {caps.canEditQuestionBank && (
                      <td style={td}>
                        <button onClick={() => removeEntry(e.id)} style={dangerBtn}>
                          刪除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 抽題預覽 ── */}
          <div style={{ width: 380 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>抽題預覽</h2>
            <div style={{ background: 'var(--panel)', padding: 12, borderRadius: 8 }}>
              <label>
                題數：
                <input
                  type="number"
                  value={drawCount}
                  onChange={(e) => setDrawCount(Number(e.target.value))}
                  style={inputCss}
                />
              </label>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                難度比例：易 {DEFAULT_DRAW_DIST[1]} / 中 {DEFAULT_DRAW_DIST[2]} / 難 {DEFAULT_DRAW_DIST[3]}
              </div>
              <ol style={{ marginTop: 12 }}>
                {preview.map((q) => (
                  <li key={q.id} style={{ fontSize: 13, marginBottom: 6 }}>
                    [{q.difficulty}] {q.prompt}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* ── AI 題庫助理 ── */}
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(94,106,210,0.08)',
            border: '1px solid #5E6AD2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5E6AD2', marginBottom: 3 }}>🤖 AI 題庫助理</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              讓 AI 根據課程主題批量生成題目，或分析現有題庫的難度分布是否平衡。
            </div>
          </div>
          <a
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我為資料結構課程批量生成 10 道程式題（難度：易 3、中 5、難 2），涵蓋鏈結串列、堆疊、佇列，每題附上參考解答')}`}
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

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14, textAlign: 'left' as const };
const td = { padding: '8px', fontSize: 14 };
const inputCss = { padding: 6, border: '1px solid #e5e7eb', borderRadius: 6, width: '100%' };
const primaryBtn = {
  padding: '8px 16px',
  borderRadius: 8,
  background: '#1F4E78',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
};
const dangerBtn = {
  padding: '6px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: '#dc2626',
  border: '1px solid #dc2626',
  cursor: 'pointer',
  fontSize: 12,
};
