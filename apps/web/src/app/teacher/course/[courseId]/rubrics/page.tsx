'use client';

/**
 * Teacher · Course · Rubric Editor
 * TronClass parity P1-6 教師端建立 / 編輯 Rubric。
 * 對應引擎：packages/shared/src/lms/rubricScoring
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { evaluateRubric, type Rubric, type RubricCriterion } from '@campus/shared';

const SAMPLE: Rubric = {
  id: 'r1',
  title: '期末報告 Rubric',
  criteria: [
    {
      id: 'c1',
      title: '內容深度',
      weight: 40,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l3', label: '良', points: 3 },
        { id: 'l2', label: '可', points: 2 },
        { id: 'l1', label: '差', points: 1 },
      ],
    },
    {
      id: 'c2',
      title: '結構清晰',
      weight: 30,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l3', label: '良', points: 3 },
        { id: 'l1', label: '差', points: 1 },
      ],
    },
    {
      id: 'c3',
      title: '參考資料',
      weight: 30,
      levels: [
        { id: 'l4', label: '完整', points: 4 },
        { id: 'l2', label: '可', points: 2 },
      ],
    },
  ],
};

export default function TeacherRubricsPage({ params }: { params: { courseId: string } }) {
  const [rubric, setRubric] = useState<Rubric>(SAMPLE);
  const [previewScores, setPreviewScores] = useState<Record<string, string>>({});

  const evaluation = useMemo(() => {
    const scores = Object.entries(previewScores)
      .filter(([, v]) => v)
      .map(([criterionId, levelId]) => ({ criterionId, levelId }));
    return evaluateRubric(rubric, scores);
  }, [rubric, previewScores]);

  const updateWeight = (cid: string, w: number) =>
    setRubric((r) => ({
      ...r,
      criteria: r.criteria.map((c) => (c.id === cid ? { ...c, weight: w } : c)),
    }));

  const removeCriterion = (cid: string) =>
    setRubric((r) => ({ ...r, criteria: r.criteria.filter((c) => c.id !== cid) }));

  const addCriterion = () => {
    const id = `c${Date.now()}`;
    const c: RubricCriterion = {
      id,
      title: '新評分項',
      weight: 10,
      levels: [
        { id: 'top', label: '優', points: 4 },
        { id: 'mid', label: '中', points: 2 },
      ],
    };
    setRubric((r) => ({ ...r, criteria: [...r.criteria, c] }));
  };

  const totalWeight = rubric.criteria.reduce((acc, c) => acc + c.weight, 0);

  return (
    <SiteShell>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Rubric 評分標準</h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>
          編輯評分項與等級；下方即時預覽教師打分後的加權結果。
        </p>

        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <input
            value={rubric.title}
            onChange={(e) => setRubric((r) => ({ ...r, title: e.target.value }))}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 16,
            }}
          />
          <button onClick={addCriterion} style={primaryBtn}>
            + 新增評分項
          </button>
        </div>

        <div style={{ marginBottom: 12, color: totalWeight === 100 ? '#16a34a' : '#dc2626' }}>
          目前權重總和：{totalWeight}（會自動正規化到 100）
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={th}>評分項</th>
              <th style={th}>權重</th>
              <th style={th}>等級</th>
              <th style={th}>預覽打分</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rubric.criteria.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>
                  <input
                    value={c.title}
                    onChange={(e) =>
                      setRubric((r) => ({
                        ...r,
                        criteria: r.criteria.map((x) =>
                          x.id === c.id ? { ...x, title: e.target.value } : x,
                        ),
                      }))
                    }
                    style={{ width: '100%', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    value={c.weight}
                    onChange={(e) => updateWeight(c.id, Number(e.target.value))}
                    style={{ width: 60, padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  />
                  %
                </td>
                <td style={td}>
                  {c.levels.map((l) => (
                    <span
                      key={l.id}
                      style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        background: '#eef2ff',
                        borderRadius: 6,
                        marginRight: 4,
                        fontSize: 12,
                      }}
                    >
                      {l.label} {l.points}
                    </span>
                  ))}
                </td>
                <td style={td}>
                  <select
                    value={previewScores[c.id] ?? ''}
                    onChange={(e) =>
                      setPreviewScores((s) => ({ ...s, [c.id]: e.target.value }))
                    }
                    style={{ padding: 6, border: '1px solid #e5e7eb', borderRadius: 6 }}
                  >
                    <option value="">— 未評 —</option>
                    {c.levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}（{l.points}）
                      </option>
                    ))}
                  </select>
                </td>
                <td style={td}>
                  <button onClick={() => removeCriterion(c.id)} style={dangerBtn}>
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 14, color: '#15803d', fontWeight: 600 }}>即時預覽</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#14532d', marginTop: 4 }}>
            總分：{evaluation.totalScore} / 100
          </div>
          <ul style={{ marginTop: 8, fontSize: 13, color: '#166534' }}>
            {evaluation.perCriterion.map((p) => (
              <li key={p.criterionId}>
                {p.title}：{p.levelLabel ?? '未評'}（權重 {p.normalizedWeight}%，得 {p.weightedScore} 分）
              </li>
            ))}
          </ul>
        </div>
      </main>
    </SiteShell>
  );
}

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14, textAlign: 'left' as const };
const td = { padding: '12px 8px', fontSize: 14 };
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
