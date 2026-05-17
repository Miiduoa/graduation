'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import { getDemoUser, DEMO_GRADES, CURRENT_SEMESTER } from '@/lib/demoData';

type Tab = 'overview' | 'courses' | 'achievements';

/** 每種角色的示範個人檔案 */
const ROLE_PROFILE_OVERRIDES: Record<string, {
  name: string; email: string; department: string; grade: string;
  studentId: string; gpa: number; totalCredits: number; requiredCredits: number;
  bio: string; interests: string[];
}> = {
  student: {
    name: '王小明', email: 'm11302001@pu.edu.tw', department: '資訊管理系', grade: '大三',
    // gpa: 歷史四學期加權平均（111-1→112-2），與 grades 頁 GPA trend 一致
    // totalCredits: 歷史已修 58 + 本學期修習中 20 = 78（與 credit-planner 一致）
    studentId: 'M11302001', gpa: 3.63, totalCredits: 78, requiredCredits: 128,
    bio: '熱愛程式設計與開源專案，致力於探索 AI 與軟體工程的交叉領域。',
    interests: ['程式設計', '機器學習', '音樂', '攝影'],
  },
  teacher: {
    name: '王大明 老師', email: 'wang@pu.edu.tw', department: '資訊管理系', grade: '副教授',
    studentId: '—', gpa: 0, totalCredits: 0, requiredCredits: 0,
    bio: '任教資訊管理系，專長資料庫系統與軟體工程，指導多屆畢業專題。',
    interests: ['資料庫', '軟體工程', '教學設計'],
  },
  ta: {
    name: '林助教', email: 'ta.lin@pu.edu.tw', department: '資訊管理系（碩士班）', grade: '碩二',
    studentId: 'M11102008', gpa: 3.71, totalCredits: 18, requiredCredits: 32,
    bio: '協助資料結構課程批改作業，研究方向為自然語言處理。',
    interests: ['NLP', 'Python', '教學輔導'],
  },
  club_officer: {
    name: '陳社長', email: 'club.chen@pu.edu.tw', department: '資訊工程系', grade: '大三',
    studentId: 'B11203015', gpa: 3.44, totalCredits: 68, requiredCredits: 128,
    bio: '程式設計社社長，主辦校內黑客松與程式競賽，熱愛開源貢獻。',
    interests: ['競程', '社團活動', 'Web 開發'],
  },
  department_head: {
    name: '黃主任', email: 'dept.huang@pu.edu.tw', department: '資訊管理系', grade: '系主任',
    studentId: '—', gpa: 0, totalCredits: 0, requiredCredits: 0,
    bio: '資訊管理系系主任，負責系所課程規劃、教師評鑑與對外合作。',
    interests: ['系務行政', '產學合作', '課程設計'],
  },
  admin: {
    name: '系統管理員', email: 'admin@pu.edu.tw', department: '電子計算機中心', grade: '管理員',
    studentId: '—', gpa: 0, totalCredits: 0, requiredCredits: 0,
    bio: '負責校園資訊系統維運、帳號管理與資安防護。',
    interests: ['系統運維', '資安', '雲端服務'],
  },
  alumni: {
    name: '張學長', email: 'alumni.zhang@gmail.com', department: '資訊管理系 109 屆', grade: '已畢業',
    studentId: 'B09203001', gpa: 3.65, totalCredits: 128, requiredCredits: 128,
    bio: '109 屆資管系畢業，現任職某科技公司軟體工程師，持續關注母校發展。',
    interests: ['軟體開發', '系友活動', '職涯分享'],
  },
  guest: {
    name: '訪客', email: '—', department: '—', grade: '訪客',
    studentId: '—', gpa: 0, totalCredits: 0, requiredCredits: 0,
    bio: '尚未登入，以訪客身份瀏覽公開資訊。',
    interests: ['校園資訊'],
  },
};

// 本學期修習中課程（與 DEMO_COURSES + CURRENT_SEMESTER 對齊）
const CURRENT_SEM_COURSES = CURRENT_SEMESTER.courses.map((c) => ({
  name: c.name,
  grade: '修習中',
  credits: c.credits,
  semester: '113-1（修習中）',
  // 對應 DEMO_COURSES 的 courseId（code 對照）
  courseId: c.code === 'CS301' ? 'c1' : c.code === 'MATH201' ? 'c2' : c.code === 'CS302' ? 'c3'
          : c.code === 'CS401' ? 'c4' : c.code === 'MATH101' ? 'c5' : c.code === 'ENG201' ? 'c6'
          : c.code === 'CS303' ? 'c7' : c.code === 'CS402' ? 'c8' : undefined,
}));

// 從 DEMO_GRADES 衍生已有成績的課程（與成績頁共用資料源）
const GRADED_COURSES = DEMO_GRADES.map((g) => ({
  name: g.name,
  grade: g.grade,
  credits: g.credits,
  semester: '112-2',
  courseId: g.courseId,
}));

// 合併：本學期（修習中） + 已有成績課程
const MOCK_COURSES = [...CURRENT_SEM_COURSES, ...GRADED_COURSES];

// 學業優異：需 GPA ≥ 3.8，王小明累計 GPA = 3.63 → 未達標；112-2 學期 GPA 3.82 達標
const MOCK_ACHIEVEMENTS = [
  { name: '學業優異（112-2）', icon: '🏆', desc: '大二下 GPA 達 3.82', earned: true },
  { name: '全勤獎', icon: '✅', desc: '整學期無缺席', earned: true },
  { name: '社團積極', icon: '🎉', desc: '參與 3 個以上社團', earned: false },
  { name: '競賽達人', icon: '🥇', desc: '獲得競賽獎項', earned: false },
];

export default function ProfilePage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const roleDef = getDemoRoleDefinition(demoRole);
  // 用 getDemoUser 取得角色對應的 demo 帳號，再疊上角色 profile 覆寫
  const demoUser = demoRole !== 'guest' ? getDemoUser(demoRole) : undefined;
  const profileOverride = ROLE_PROFILE_OVERRIDES[demoRole] ?? ROLE_PROFILE_OVERRIDES.student;
  const MOCK_USER = {
    ...profileOverride,
    // 若 demoUser 有真實 displayName 優先使用
    name: demoUser?.displayName ?? profileOverride.name,
    email: demoUser?.email ?? profileOverride.email,
    department: demoUser?.department ?? profileOverride.department,
  };
  const isStudentLike = ['student', 'ta', 'club_officer', 'alumni'].includes(demoRole);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Guest 沒有個人資料 — 顯示登入提示（hooks 都宣告完才能早返）
  if (demoRole === 'guest') {
    return (
      <SiteShell schoolName={schoolName} title="個人檔案">
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>👤</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>尚未登入</h2>
            <p
              style={{
                margin: '0 0 20px',
                color: 'var(--muted)',
                fontSize: 14,
                lineHeight: 1.7,
              }}
            >
              訪客身份沒有個人檔案。請選擇任一示範身份登入，或從右上角「身份膠囊」切換。
            </p>
            <Link
              href={`/login${q}`}
              className="btn primary"
              style={{ minWidth: 160, justifyContent: 'center' }}
            >
              前往登入頁
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }
  const creditPct = MOCK_USER.requiredCredits > 0
    ? Math.round((MOCK_USER.totalCredits / MOCK_USER.requiredCredits) * 100)
    : 100;

  return (
    <SiteShell schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Profile Hero ── */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)',
            border: 'none',
            color: '#fff',
            boxShadow: '6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.24)',
                border: '3px solid rgba(255,255,255,0.5)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 36,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {roleDef.icon || MOCK_USER.name.slice(0, 1)}
            </div>
            <div style={{ flex: 1 }}>
              <h1
                style={{
                  margin: '0 0 4px',
                  fontSize: 24,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                }}
              >
                {MOCK_USER.name}
              </h1>
              <p style={{ margin: '0 0 12px', fontSize: 14, opacity: 0.82 }}>
                {MOCK_USER.department} · {MOCK_USER.grade}
                {MOCK_USER.studentId !== '—' ? ` · ${MOCK_USER.studentId}` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {MOCK_USER.interests.map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'rgba(255,255,255,0.2)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <Link
              href={`/settings${q}`}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.3)',
                whiteSpace: 'nowrap',
              }}
            >
              編輯資料
            </Link>
          </div>
          <p style={{ margin: '16px 0 0', fontSize: 14, opacity: 0.82, lineHeight: 1.7 }}>
            {MOCK_USER.bio}
          </p>
        </div>

        {/* ── Quick Stats（僅學生/TA/社團幹部/校友有學業數字） ── */}
        <div className="metricGrid">
          {isStudentLike && (
            <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
              <div className="metricIcon">📊</div>
              <div className="metricValue">{MOCK_USER.gpa > 0 ? MOCK_USER.gpa : '—'}</div>
              <div className="metricLabel">累計 GPA</div>
            </div>
          )}
          {isStudentLike && MOCK_USER.requiredCredits > 0 && (
            <div className="metricCard" style={{ '--tone': '#34C759' } as CSSProperties}>
              <div className="metricIcon">🎓</div>
              <div className="metricValue">{MOCK_USER.totalCredits}</div>
              <div className="metricLabel">已修學分</div>
            </div>
          )}
          <div className="metricCard" style={{ '--tone': '#FF9500' } as CSSProperties}>
            <div className="metricIcon">🏆</div>
            <div className="metricValue">{MOCK_ACHIEVEMENTS.filter((a) => a.earned).length}</div>
            <div className="metricLabel">已獲成就</div>
          </div>
          <div className="metricCard" style={{ '--tone': roleDef.tone } as CSSProperties}>
            <div className="metricIcon">{roleDef.icon}</div>
            <div className="metricValue" style={{ fontSize: 16 }}>{roleDef.label}</div>
            <div className="metricLabel">目前身份</div>
          </div>
        </div>

        {/* ── Credit Progress（僅在學生/TA/社團幹部顯示） ── */}
        {isStudentLike && MOCK_USER.requiredCredits > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>畢業學分進度</h3>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--brand)' }}>
                {creditPct}%
              </span>
            </div>
            <div className="progressMeta">
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                已修 {MOCK_USER.totalCredits} / {MOCK_USER.requiredCredits} 學分
              </span>
            </div>
            <div className="progressTrack">
              <div
                className="progressFill"
                style={{ '--progress-width': `${creditPct}%` } as CSSProperties}
              />
            </div>
          </div>
        )}

        {/* ── AI 個人規劃入口（guest 已在上方 early-return，此處必定非訪客） ── */}
        {(
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(94,106,210,0.10) 0%, rgba(142,186,255,0.07) 100%)',
              border: '1px solid rgba(94,106,210,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 3 }}>
                🤖 AI 個人助理
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                {demoRole === 'student'
                  ? `GPA ${MOCK_USER.gpa}，已修 ${MOCK_USER.totalCredits} 學分。讓 AI 分析你的學習軌跡與職涯方向？`
                  : demoRole === 'alumni'
                  ? '校友身份：AI 可幫你回顧在校成績、連結校友活動與職涯發展。'
                  : demoRole === 'teacher'
                  ? 'AI 可幫你整理教學資源、分析班級表現，或生成課程大綱。'
                  : demoRole === 'department_head'
                  ? 'AI 可幫你分析系所數據、生成系務報告或審核公告摘要。'
                  : demoRole === 'admin'
                  ? 'AI 可幫你分析系統安全日誌、生成維運報告。'
                  : 'AI 可幫你查詢社團活動、生成招募文案或分析成員狀況。'}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(
                demoRole === 'student'
                  ? `我的 GPA 是 ${MOCK_USER.gpa}，已修 ${MOCK_USER.totalCredits} 學分。根據我的學習歷程，你有什麼職涯或選課建議？`
                  : demoRole === 'alumni'
                  ? '我是 109 屆資管系校友，請幫我查詢相關校友活動，並給予職涯發展建議。'
                  : demoRole === 'teacher'
                  ? '幫我整理本學期資料結構課程的班級整體表現，並給出教學改進建議。'
                  : demoRole === 'department_head'
                  ? '幫我生成本學期系所教學品質摘要報告，包含選課率與成績分布。'
                  : demoRole === 'admin'
                  ? '幫我分析今日安全日誌，給出資安風險評估與建議措施。'
                  : '幫我分析程式設計社的活動參與率，並給出提升社團活躍度的建議。'
              )}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="segmentedGroup">
          {(
            [
              { key: 'overview', label: '📋 概覽' },
              { key: 'courses', label: '📚 課程紀錄' },
              { key: 'achievements', label: '🏆 成就' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <div className="sectionCard">
            <div className="insetGroupHeader">個人資訊</div>
            <div className="insetGroup">
              {[
                { icon: '🎓', label: '系所', value: MOCK_USER.department },
                { icon: '📅', label: isStudentLike ? '年級' : '職稱', value: MOCK_USER.grade },
                ...(MOCK_USER.studentId !== '—'
                  ? [{ icon: '🪪', label: '學號', value: MOCK_USER.studentId }]
                  : []),
                { icon: '📧', label: '電子郵件', value: MOCK_USER.email },
              ].map((row, i) => (
                <div
                  key={row.label}
                  className="insetGroupRow"
                  style={{ borderTop: i === 0 ? 'none' : undefined }}
                >
                  <div
                    className="insetGroupRowIcon"
                    style={{ fontSize: 18, background: 'var(--panel)' }}
                  >
                    {row.icon}
                  </div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{row.label}</div>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 500 }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Courses ── */}
        {activeTab === 'courses' && demoRole === 'student' && (
          <div className="insetGroup">
            {MOCK_COURSES.map((c, i) => {
              const rowContent = (
                <>
                  <div
                    className="insetGroupRowIcon"
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      background: 'var(--accent-soft)',
                      color: 'var(--brand)',
                    }}
                  >
                    {c.grade}
                  </div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{c.name}</div>
                    <div className="insetGroupRowMeta">
                      {c.semester} · {c.credits} 學分
                    </div>
                  </div>
                  {c.courseId && (
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>→</span>
                  )}
                </>
              );
              const sharedStyle: CSSProperties = {
                borderTop: i === 0 ? 'none' : undefined,
                color: 'inherit',
                textDecoration: 'none',
                cursor: c.courseId ? 'pointer' : 'default',
              };
              return c.courseId ? (
                <Link
                  key={c.name}
                  href={`/course/${c.courseId}${q}`}
                  className="insetGroupRow"
                  style={sharedStyle}
                >
                  {rowContent}
                </Link>
              ) : (
                <div key={c.name} className="insetGroupRow" style={sharedStyle}>
                  {rowContent}
                </div>
              );
            })}
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'ta' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🧑‍💻</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>助教修課紀錄</div>
            <div>助教個人修課資料來自研究所系統。正式課表請至教務系統查詢。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/timetable${q}`} className="btn" style={{ fontSize: 13 }}>查看課表 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('我擔任資料結構助教，幫我整理本週批改進度與下一步行動')}`} className="btn primary" style={{ fontSize: 13 }}>🤖 AI 整理進度</a>
            </div>
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'club_officer' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🎯</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>社團幹部修課紀錄</div>
            <div>陳社長（B11203015）的個人修課資料來自教務系統，此處為社團幹部示範視角。請至教務系統或課表頁查詢個人課表。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/timetable${q}`} className="btn" style={{ fontSize: 13 }}>查看課表 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我分析程式設計社成員活躍度與下次活動籌備建議')}`} className="btn primary" style={{ fontSize: 13 }}>🤖 AI 社團助理</a>
            </div>
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'alumni' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🎓</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>校友在校修課紀錄（唯讀）</div>
            <div>張學長（B09203001）已於 109 屆修業期滿畢業，歷史修課紀錄請至教務處申請成績單。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/grades${q}`} className="btn" style={{ fontSize: 13 }}>查看歷史成績 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我整理在校期間的學業成就與重點修課經歷，可以用在履歷上')}`} className="btn primary" style={{ fontSize: 13 }}>🤖 AI 整理在校紀錄</a>
            </div>
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'teacher' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🧑‍🏫</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>授課課程</div>
            <div>王大明老師目前授課：<strong>資料結構（CS301）</strong>，48 位學生。前往課程工作台可管理作業、成績與點名。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/teacher/course/c1${q}`} className="btn" style={{ fontSize: 13 }}>前往課程工作台 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我分析資料結構這學期班級的整體表現，找出需要關注的學生')}`} className="btn primary" style={{ fontSize: 13 }}>🤖 AI 班級分析</a>
            </div>
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'department_head' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🏛️</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>系主任課程總覽</div>
            <div>黃主任可查看全系 {16} 門本學期課程。點下方可進入全系成績統計頁或個別課程工作台（唯讀模式）。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/grades${q}`} className="btn primary" style={{ fontSize: 13 }}>全系成績統計 →</a>
              <a href={`/groups${q}`} className="btn" style={{ fontSize: 13 }}>課程列表 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我生成本學期資管系教學摘要週報，包含開課數、平均成績、待批改、待審公告')}`} className="btn" style={{ fontSize: 13, background: 'var(--accent-soft)', color: 'var(--brand)' }}>🤖 AI 系所週報</a>
            </div>
          </div>
        )}
        {activeTab === 'courses' && demoRole === 'admin' && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🛡️</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>系統管理員課程管理</div>
            <div>管理員可查看所有課程的完整資料。前往管理後台可進行課程停用、成績複查等系統級操作。</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <a href={`/admin${q}`} className="btn primary" style={{ fontSize: 13 }}>管理後台 →</a>
              <a href={`/groups${q}`} className="btn" style={{ fontSize: 13 }}>課程列表 →</a>
              <a href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我生成系統健康摘要，包含今日安全事件、活躍使用者、API 用量與備份狀態')}`} className="btn" style={{ fontSize: 13, background: 'var(--accent-soft)', color: 'var(--brand)' }}>🤖 AI 系統摘要</a>
            </div>
          </div>
        )}

        {/* ── Achievements ── */}
        {activeTab === 'achievements' && (
          <div className="grid-2">
            {MOCK_ACHIEVEMENTS.map((a) => (
              <div
                key={a.name}
                className="card"
                style={{
                  textAlign: 'center',
                  opacity: a.earned ? 1 : 0.45,
                  padding: '20px 16px',
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}>{a.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{a.desc}</div>
                {a.earned && (
                  <div
                    style={{ fontSize: 11, color: 'var(--success)', fontWeight: 700, marginTop: 8 }}
                  >
                    ✓ 已解鎖
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
