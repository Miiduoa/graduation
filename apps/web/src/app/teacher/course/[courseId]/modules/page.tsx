'use client';

/**
 * Teacher · Course · Modules
 * TronClass parity 「教材單元」教師管理頁。
 *
 * 2026-05-17：補齊「新增單元 / 編輯 / 新增教材」三個原本沒 onClick 的死按鈕。
 * 全部走本地 state 即可，demo 不需 backend。
 */
import Link from 'next/link';
import { useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { Modal, useToast } from '@/components/ui';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { resolveSchoolPageContext } from '@/lib/pageContext';

type ModuleRow = {
  id: string;
  title: string;
  week: number;
  materialCount: number;
  visible: boolean;
  materials?: { id: string; name: string; kind: 'pdf' | 'video' | 'link' | 'slides' }[];
};

const MOCK: ModuleRow[] = [
  {
    id: 'm1',
    title: '第 1 週：課程簡介',
    week: 1,
    materialCount: 3,
    visible: true,
    materials: [
      { id: 'mat-1-1', name: '課程大綱.pdf', kind: 'pdf' },
      { id: 'mat-1-2', name: '評分標準說明.pdf', kind: 'pdf' },
      { id: 'mat-1-3', name: 'TronClass 操作影片', kind: 'video' },
    ],
  },
  {
    id: 'm2',
    title: '第 2 週：關聯模型',
    week: 2,
    materialCount: 5,
    visible: true,
    materials: [
      { id: 'mat-2-1', name: 'Lecture 02 slides.pdf', kind: 'slides' },
      { id: 'mat-2-2', name: 'Ch2 補充教材.pdf', kind: 'pdf' },
    ],
  },
  {
    id: 'm3',
    title: '第 3 週：SQL 基礎',
    week: 3,
    materialCount: 4,
    visible: false,
    materials: [
      { id: 'mat-3-1', name: 'SQL 練習題.pdf', kind: 'pdf' },
    ],
  },
];

export default function TeacherModulesPage({ params, searchParams }: { params: { courseId: string }; searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const isReadOnlyView = isTaView || demoRole === 'department_head';
  const { success, info } = useToast();
  const [rows, setRows] = useState<ModuleRow[]>(MOCK);

  // ── Modal 狀態 ─────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState({ title: '', week: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', week: '' });
  const [addMaterialFor, setAddMaterialFor] = useState<string | null>(null);
  const [materialDraft, setMaterialDraft] = useState({ name: '', kind: 'pdf' as const });

  const toggleVisible = (id: string) => {
    if (!caps.canEditModules) return;
    setRows((r) => r.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)));
  };

  // ── 新增單元 ───────────────────────────────────────
  const onAddModule = () => {
    const week = Number(newDraft.week);
    if (!newDraft.title.trim() || !Number.isFinite(week) || week < 1) {
      info('請輸入單元標題與週次（1~18）');
      return;
    }
    const newRow: ModuleRow = {
      id: `m-${Date.now()}`,
      title: newDraft.title.trim(),
      week,
      materialCount: 0,
      visible: false,
      materials: [],
    };
    setRows((r) => [...r, newRow].sort((a, b) => a.week - b.week));
    setNewDraft({ title: '', week: '' });
    setNewOpen(false);
    success(`已新增「${newRow.title}」（預設不可見，記得勾選可見）`);
  };

  // ── 編輯單元 ───────────────────────────────────────
  const onEditClick = (m: ModuleRow) => {
    setEditingId(m.id);
    setEditDraft({ title: m.title, week: String(m.week) });
  };
  const onSaveEdit = () => {
    if (!editingId) return;
    const week = Number(editDraft.week);
    if (!editDraft.title.trim() || !Number.isFinite(week)) {
      info('標題與週次不可為空');
      return;
    }
    setRows((r) =>
      r
        .map((m) => (m.id === editingId ? { ...m, title: editDraft.title.trim(), week } : m))
        .sort((a, b) => a.week - b.week),
    );
    success(`已更新「${editDraft.title}」`);
    setEditingId(null);
  };
  const editingRow = rows.find((m) => m.id === editingId);

  // ── 新增教材 ───────────────────────────────────────
  const onAddMaterial = () => {
    if (!addMaterialFor || !materialDraft.name.trim()) {
      info('請輸入教材名稱');
      return;
    }
    setRows((r) =>
      r.map((m) =>
        m.id === addMaterialFor
          ? {
              ...m,
              materialCount: m.materialCount + 1,
              materials: [
                ...(m.materials ?? []),
                {
                  id: `mat-${Date.now()}`,
                  name: materialDraft.name.trim(),
                  kind: materialDraft.kind,
                },
              ],
            }
          : m,
      ),
    );
    success(`已新增教材「${materialDraft.name}」`);
    setMaterialDraft({ name: '', kind: 'pdf' });
    setAddMaterialFor(null);
  };
  const addMaterialRow = rows.find((m) => m.id === addMaterialFor);

  return (
    <SiteShell title="教材單元" schoolName={schoolName}>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
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
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          教材單元管理{isReadOnlyView ? '（檢視）' : ''}
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: isReadOnlyView ? 12 : 24 }}>
          管理本課程的週次與教材；勾選後學生才看得到。
        </p>

        {/* TA / 系主任 唯讀提示 */}
        {isReadOnlyView && (
          <div
            style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20,
              background: isTaView ? 'rgba(124,58,237,0.10)' : 'rgba(255,149,0,0.10)',
              border: `1px solid ${isTaView ? '#AF52DE' : '#FF9500'}`,
              color: isTaView ? '#5856D6' : '#92400E',
            }}
          >
            {isTaView
              ? <><span>🧑‍💻 </span><strong>助教 TA 視角</strong>：可查看教材結構，但<strong>無法新增、編輯或調整可見性</strong>（授課教師專用）。</>
              : <><span>🏛️ </span><strong>系主任視角</strong>：可唯讀瀏覽教材結構，但<strong>無法新增、編輯或調整可見性</strong>（授課教師專用）。</>
            }
          </div>
        )}

        {/* 新增按鈕：TA 不可用 */}
        {caps.canEditModules ? (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              background: 'var(--brand)',
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
              background: 'var(--border)',
              color: 'var(--muted-light)',
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
            <tr style={{ background: 'var(--panel)', textAlign: 'left' }}>
              <th style={th}>週次</th>
              <th style={th}>標題</th>
              <th style={th}>教材數</th>
              <th style={th}>可見</th>
              {caps.canEditModules && <th style={th}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
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
                    <button type="button" style={linkBtn} onClick={() => onEditClick(m)}>編輯</button>
                    <button type="button" style={linkBtn} onClick={() => setAddMaterialFor(m.id)}>新增教材</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── AI 教材助理入口 ── */}
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(88,86,214,0.08)',
            border: '1px solid #5856D6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5856D6', marginBottom: 3 }}>🤖 AI 教材助理</div>
            <div style={{ fontSize: 13, color: '#3C3C43' }}>
              讓 AI 幫你生成本週課程簡介、學習目標，或根據大綱草擬教材結構。
            </div>
          </div>
          <a
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我根據資料結構課程大綱，草擬第 5 週「樹與圖」的教材模組結構，包含學習目標、活動設計和評量方式')}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            問 AI →
          </a>
        </div>
        </>}
      </main>

      {/* 新增單元 Modal */}
      <Modal
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        title="＋ 新增教材單元"
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setNewOpen(false)}>取消</button>
            <button type="button" className="btn primary" onClick={onAddModule}>建立</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>單元標題</label>
          <input
            className="input"
            placeholder="例：第 5 週：樹與圖"
            value={newDraft.title}
            onChange={(e) => setNewDraft({ ...newDraft, title: e.target.value })}
          />
          <label style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>週次</label>
          <input
            className="input"
            type="number"
            min={1}
            max={18}
            placeholder="例：5"
            value={newDraft.week}
            onChange={(e) => setNewDraft({ ...newDraft, week: e.target.value })}
          />
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            新單元預設為「不可見」，請建立後勾選可見性才會對學生顯示。
          </div>
        </div>
      </Modal>

      {/* 編輯單元 Modal */}
      <Modal
        isOpen={editingId !== null}
        onClose={() => setEditingId(null)}
        title={editingRow ? `編輯：${editingRow.title}` : '編輯單元'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditingId(null)}>取消</button>
            <button type="button" className="btn primary" onClick={onSaveEdit}>儲存</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>單元標題</label>
          <input
            className="input"
            value={editDraft.title}
            onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
          />
          <label style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>週次</label>
          <input
            className="input"
            type="number"
            min={1}
            max={18}
            value={editDraft.week}
            onChange={(e) => setEditDraft({ ...editDraft, week: e.target.value })}
          />
          {editingRow ? (
            <div style={{ marginTop: 10, padding: 12, background: 'var(--panel)', borderRadius: 8, fontSize: 12 }}>
              📦 此單元目前有 <strong>{editingRow.materialCount}</strong> 個教材
              {editingRow.materials && editingRow.materials.length > 0 ? (
                <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                  {editingRow.materials.map((mat) => (
                    <li key={mat.id} style={{ marginBottom: 2 }}>
                      {mat.kind === 'pdf' ? '📄' : mat.kind === 'video' ? '🎬' : mat.kind === 'link' ? '🔗' : '📊'} {mat.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* 新增教材 Modal */}
      <Modal
        isOpen={addMaterialFor !== null}
        onClose={() => setAddMaterialFor(null)}
        title={addMaterialRow ? `為「${addMaterialRow.title}」新增教材` : '新增教材'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAddMaterialFor(null)}>取消</button>
            <button type="button" className="btn primary" onClick={onAddMaterial}>新增</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>教材名稱</label>
          <input
            className="input"
            placeholder="例：Ch5 樹.pdf"
            value={materialDraft.name}
            onChange={(e) => setMaterialDraft({ ...materialDraft, name: e.target.value })}
          />
          <label style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>類型</label>
          <select
            className="input"
            value={materialDraft.kind}
            onChange={(e) => setMaterialDraft({ ...materialDraft, kind: e.target.value as 'pdf' })}
          >
            <option value="pdf">📄 PDF</option>
            <option value="video">🎬 影片</option>
            <option value="slides">📊 投影片</option>
            <option value="link">🔗 連結</option>
          </select>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            上傳檔案需在 TronClass 端，這裡僅建立教材條目並對應檔案名稱。
          </div>
        </div>
      </Modal>
    </SiteShell>
  );
}

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14 } as const;
const td = { padding: '12px 8px', fontSize: 14 } as const;
const linkBtn = {
  background: 'transparent',
  color: 'var(--brand)',
  border: 'none',
  cursor: 'pointer',
  marginRight: 8,
  textDecoration: 'underline',
} as const;
