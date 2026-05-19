'use client';

/**
 * Teacher · Course · Quizzes
 * TronClass parity 「測驗管理」頁。
 */
import Link from 'next/link';
import { useState } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { resolveSchoolPageContext } from '@/lib/pageContext';

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

export default function TeacherQuizzesPage({ params, searchParams }: { params: { courseId: string }; searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const isReadOnlyView = isTaView || demoRole === 'department_head';
  const { success, info } = useToast();
  const [rows, setRows] = useState<QuizRow[]>(MOCK);
  const [showNewQuizModal, setShowNewQuizModal] = useState(false);
  const [newQuiz, setNewQuiz] = useState({ title: '', type: 'quiz' as 'quiz' | 'exam', dueAt: '' });
  const [viewingAnswerOf, setViewingAnswerOf] = useState<QuizRow | null>(null);

  const publish = (id: string) => {
    if (!caps.canPublishGrades) return;
    setRows((r) => r.map((q) => (q.id === id ? { ...q, gradesPublished: true } : q)));
    success('✅ 成績已發布給學生');
  };

  const createQuiz = () => {
    if (!newQuiz.title.trim()) {
      info('請輸入測驗標題');
      return;
    }
    const id = `q-${Date.now()}`;
    setRows((r) => [{ id, title: newQuiz.title, type: newQuiz.type, dueAt: newQuiz.dueAt || null, submitted: 0, total: 42, gradesPublished: false }, ...r]);
    setNewQuiz({ title: '', type: 'quiz', dueAt: '' });
    setShowNewQuizModal(false);
    success(`✅ 已新增「${newQuiz.title}」`);
  };

  return (
    <SiteShell title="測驗管理" schoolName={schoolName}>
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
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>
          測驗 / 考試管理{isReadOnlyView ? '（檢視）' : ''}
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: isReadOnlyView ? 12 : 24 }}>
          設計題目、設定截止、發布成績。送出後 mobile 端 QuizTakingScreen 即可作答。
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
              ? <><span>🧑‍💻 </span><strong>助教 TA 視角</strong>：可查看作答情況，但<strong>無法新增測驗或發布成績</strong>（授課教師專用）。</>
              : <><span>🏛️ </span><strong>系主任視角</strong>：可唯讀瀏覽測驗管理，但<strong>無法新增測驗或發布成績</strong>（授課教師專用）。</>
            }
          </div>
        )}

        {/* 新增按鈕：TA 不可用 */}
        {caps.canEditModules ? (
          <button style={primaryBtn} onClick={() => setShowNewQuizModal(true)}>+ 新增測驗</button>
        ) : (
          <button
            disabled
            title="新增測驗為授課教師專用"
            style={{ ...primaryBtn, background: 'var(--border)', color: 'var(--muted-light)', cursor: 'not-allowed' }}
          >
            🔒 新增測驗（教師專用）
          </button>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
          <thead>
            <tr style={{ background: 'var(--panel)', textAlign: 'left' }}>
              <th style={th}>標題</th>
              <th style={th}>類型</th>
              <th style={th}>截止</th>
              <th style={th}>繳交</th>
              <th style={th}>狀態</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((qr) => (
              <tr key={qr.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={td}>{qr.title}</td>
                <td style={td}>{qr.type === 'quiz' ? '小考' : '考試'}</td>
                <td style={td}>{qr.dueAt ?? '—'}</td>
                <td style={td}>
                  {qr.submitted} / {qr.total}
                </td>
                <td style={td}>{qr.gradesPublished ? '🟢 已發布' : '⚪ 待發布'}</td>
                <td style={td}>
                  {/* 編輯題目：TA / 系主任 不可用 */}
                  {caps.canEditModules ? (
                    <Link
                      href={`/teacher/course/${params.courseId}/question-banks${q}`}
                      style={{ ...linkBtn, display: 'inline' }}
                    >
                      編輯題目
                    </Link>
                  ) : null}
                  <button style={linkBtn} onClick={() => setViewingAnswerOf(qr)}>看答案</button>
                  {/* 發布成績：TA / 系主任 不可用 */}
                  {!qr.gradesPublished && caps.canPublishGrades && (
                    <button style={linkBtn} onClick={() => publish(qr.id)}>
                      發布成績
                    </button>
                  )}
                  {!qr.gradesPublished && !caps.canPublishGrades && (
                    <span style={{ fontSize: 12, color: 'var(--muted-light)' }}>🔒 教師發布</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── AI 出題助理 ── */}
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
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5856D6', marginBottom: 3 }}>🤖 AI 出題助理</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              讓 AI 根據課程大綱生成選擇題、是非題或程式題，並附上答案與解析。
            </div>
          </div>
          <a
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我為資料結構第 5 週「樹與二元搜尋樹」生成 5 道選擇題，包含答案與詳細解析，難度中等')}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            問 AI →
          </a>
        </div>
        </>}
      </main>

      {/* 新增測驗 Modal */}
      <Modal
        isOpen={showNewQuizModal}
        onClose={() => setShowNewQuizModal(false)}
        title="+ 新增測驗 / 考試"
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setShowNewQuizModal(false)}>取消</button>
            <button className="btn primary" onClick={createQuiz}>建立</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>標題</div>
            <input
              className="input"
              value={newQuiz.title}
              onChange={(e) => setNewQuiz({ ...newQuiz, title: e.target.value })}
              placeholder="例：第六週小考"
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>類型</div>
            <select
              className="input"
              value={newQuiz.type}
              onChange={(e) => setNewQuiz({ ...newQuiz, type: e.target.value as 'quiz' | 'exam' })}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            >
              <option value="quiz">小考</option>
              <option value="exam">考試</option>
            </select>
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>截止日</div>
            <input
              type="date"
              className="input"
              value={newQuiz.dueAt}
              onChange={(e) => setNewQuiz({ ...newQuiz, dueAt: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </label>
          <div style={{ background: 'var(--accent-soft)', padding: 10, borderRadius: 8, fontSize: 12, color: 'var(--brand)' }}>
            💡 也可以讓 <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我為${newQuiz.title || '本週'}生成 5 道題目`)}`}>AI 起草題目</Link> 後再回到此處設定。
          </div>
        </div>
      </Modal>

      {/* 看答案 Modal */}
      <Modal
        isOpen={viewingAnswerOf !== null}
        onClose={() => setViewingAnswerOf(null)}
        title={viewingAnswerOf ? `📝 ${viewingAnswerOf.title} · 標準答案` : ''}
        size="lg"
        footer={<button className="btn" onClick={() => setViewingAnswerOf(null)}>關閉</button>}
      >
        {viewingAnswerOf ? (
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div style={{ marginBottom: 12, padding: 10, background: 'var(--panel)', borderRadius: 8 }}>
              <strong>{viewingAnswerOf.title}</strong> · {viewingAnswerOf.type === 'quiz' ? '小考' : '考試'} · 共 10 題
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Q1：陣列與鏈結串列的時間複雜度差異？</div>
                <div style={{ color: 'var(--muted)' }}>✅ 標準答案：陣列隨機存取 O(1)，鏈結串列 O(n)；鏈結串列插入刪除 O(1)，陣列 O(n)。</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Q2：二元搜尋樹最壞情況時間複雜度？</div>
                <div style={{ color: 'var(--muted)' }}>✅ 標準答案：O(n)，當樹完全傾斜時退化為鏈結串列。</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Q3：Hash Table 衝突解決方法？</div>
                <div style={{ color: 'var(--muted)' }}>✅ 標準答案：開放定址法（線性探測、二次探測）與鏈結法（chaining）。</div>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>… 其餘 7 題已收摺於題庫頁，可前往「編輯題目」查看完整答案。</div>
            </div>
            <div style={{ marginTop: 16, padding: 12, background: 'var(--accent-soft)', borderRadius: 8, fontSize: 12, color: 'var(--brand)' }}>
              🤖 <strong>AI 提示</strong>：可請 AI 助理為「{viewingAnswerOf.title}」生成詳細解析與評分標準。
            </div>
          </div>
        ) : null}
      </Modal>
    </SiteShell>
  );
}

const th = { padding: '12px 8px', fontWeight: 600, fontSize: 14 } as const;
const td = { padding: '12px 8px', fontSize: 14 } as const;
const primaryBtn = {
  padding: '10px 16px',
  borderRadius: 8,
  background: '#003F8A',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
} as const;
const linkBtn = {
  background: 'transparent',
  color: '#003F8A',
  border: 'none',
  cursor: 'pointer',
  marginRight: 8,
  textDecoration: 'underline',
} as const;
