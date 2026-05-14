'use client';

/**
 * Teacher · Course · Question Bank
 * TronClass parity P1-2 題庫管理 + 抽題預覽。
 * 對應引擎：packages/shared/src/lms/questionBank
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
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

export default function QuestionBanksPage({ params }: { params: { courseId: string } }) {
  const [bank, setBank] = useState<QuestionBank>(SAMPLE);
  const [drawCount, setDrawCount] = useState(3);
  const [drawDist, setDrawDist] = useState({ 1: 0.34, 2: 0.33, 3: 0.33 });

  const health = useMemo(() => checkQuestionBankHealth(bank), [bank]);
  const preview = useMemo(
    () =>
      drawQuestionsForQuiz(bank, {
        count: drawCount,
        difficultyDistribution: drawDist,
        seed: 42,
      }),
    [bank, drawCount, drawDist],
  );

  const updateEntry = (id: string, patch: Partial<QuestionBankEntry>) =>
    setBank((b) => ({
      ...b,
      entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  const addEntry = () => {
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

  const removeEntry = (id: string) =>
    setBank((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }));

  return (
    <SiteShell>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>題庫</h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>
          題目 {bank.entries.length} 道｜topic 覆蓋 {Object.keys(health.topicCoverage).length} 個
        </p>

        {/* 警告 */}
        {health.warnings.length > 0 && (
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #fbbf24',
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
              <button onClick={addEntry} style={primaryBtn}>
                + 新增題目
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={th}>題目</th>
                  <th style={th}>類型</th>
                  <th style={th}>難度</th>
                  <th style={th}>Topic</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {bank.entries.map((e) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={td}>
                      <input
                        value={e.prompt}
                        onChange={(ev) => updateEntry(e.id, { prompt: ev.target.value })}
                        style={inputCss}
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
                      />
                    </td>
                    <td style={td}>
                      <button onClick={() => removeEntry(e.id)} style={dangerBtn}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 抽題預覽 ── */}
          <div style={{ width: 380 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>抽題預覽</h2>
            <div style={{ background: '#f9fafb', padding: 12, borderRadius: 8 }}>
              <label>
                題數：
                <input
                  type="number"
                  value={drawCount}
                  onChange={(e) => setDrawCount(Number(e.target.value))}
                  style={inputCss}
                />
              </label>
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                難度比例：易 {drawDist[1]} / 中 {drawDist[2]} / 難 {drawDist[3]}
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
