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
import { useDemoRole, getCapabilities } from '@/lib/demoRole';

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
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const canEdit = caps.canEditModules; // rubric 編輯權限對齊教材編輯
  const isTaView = demoRole === 'ta';
  const [rubric, setRubric] = useState<Rubric>(SAMPLE);
  const [previewScores, setPreviewScores] = useState<Record<string, string>>({});

  const evaluation = useMemo(() => {
    const scores = Object.entries(previewScores)
      .filter(([, v]) => v)
      .map(([criterionId, levelId]) => ({ criterionId, levelId }));
    return evaluateRubric(rubric, scores);
  }, [rubric, previewScores]);

  const updateWeight = (cid: string, w: number) => {
    if (!canEdit) return;
    setRubric((r) => ({
      ...r,
      criteria: r.criteria.map((c) => (c.id === cid ? { ...c, weight: w } : c)),
    }));
  };

  const removeCriterion = (cid: string) => {
    if (!canEdit) return;
    setRubric((r) => ({ ...r, criteria: r.criteria.filter((c) => c.id !== cid) }));
  };

  const addCriterion = () => {
    if (!canEdit) return;
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
        {!caps.canViewTeacherDashboard ? (
          <div className="card" style={{ padding: '24px 20px', textAlign: 'center', background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>教師工作台專用</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
              請從右上角「身份膠囊」切換為 🧑‍🏫 教師 或 🧑‍💻 助教 角色後再進入。
            </div>
            <Link href="/" className="btn">← 回首頁</Link>
          </div>
        ) : <>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>
          Rubric 評分標準{!canEdit ? '（檢視）' : ''}
        </h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>
          {canEdit
            ? '編輯評分項與等級；下方即時預覽教師打分後的加權結果。'
            : isTaView
              ? '助教 TA 可使用 Rubric 為作業打分，但不能修改 Rubric 結構（僅授課教師可編輯）。'
              : '此頁僅授課教師可編輯。'}
        </p>

        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <input
            value={rubric.title}
            disabled={!canEdit}
            onChange={(e) => canEdit && setRubric((r) => ({ ...r, title: e.target.value }))}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 16,
              background: canEdit ? '#fff' : '#f3f4f6',
              color: canEdit ? '#111' : '#6b7280',
            }}
          />
          <button
            onClick={addCriterion}
            disabled={!canEdit}
            title={!canEdit ? '僅授課教師可新增評分項' : undefined}
            style={{
              ...primaryBtn,
              opacity: canEdit ? 1 : 0.5,
              cursor: canEdit ? 'pointer' : 'not-allowed',
            }}
          >
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

        {/* ── AI Rubric 助理 ── */}
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
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5E6AD2', marginBottom: 3 }}>🤖 AI Rubric 助理</div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              {canEdit
                ? '讓 AI 幫你設計符合課程目標的評分標準，或建議各評分項的等級描述與權重分配。'
                : '讓 AI 解釋這份 Rubric 的評分邏輯，或建議如何在打分時保持一致性。'}
            </div>
          </div>
          <a
            href={`/ai-assistant?q=${encodeURIComponent(
              canEdit
                ? '幫我為「期末報告」設計一份 Rubric，評分項包含：內容深度（40%）、結構清晰（30%）、參考資料（20%）、創新性（10%），每項設計 4 個等級（優/良/可/差）並附說明'
                : '請解釋 Rubric 評分法如何在批改作業時保持評分一致性？有哪些常見誤判需要特別注意？'
            )}`}
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
