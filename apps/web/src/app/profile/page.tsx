'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import { getDemoUser } from '@/lib/demoData';

type Tab = 'overview' | 'courses' | 'achievements';

/** 每種角色的示範個人檔案 */
const ROLE_PROFILE_OVERRIDES: Record<string, {
  name: string; email: string; department: string; grade: string;
  studentId: string; gpa: number; totalCredits: number; requiredCredits: number;
  bio: string; interests: string[];
}> = {
  student: {
    name: '王小明', email: 'm11302001@pu.edu.tw', department: '資訊管理系', grade: '大三',
    studentId: 'M11302001', gpa: 3.82, totalCredits: 72, requiredCredits: 128,
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

const MOCK_COURSES = [
  { name: '資料結構', grade: 'A+', credits: 3, semester: '113-2' },
  { name: '線性代數', grade: 'A', credits: 3, semester: '113-2' },
  { name: '作業系統', grade: 'A-', credits: 3, semester: '113-2' },
  { name: '計算機網路', grade: 'B+', credits: 3, semester: '113-1' },
];

const MOCK_ACHIEVEMENTS = [
  { name: '學業優異', icon: '🏆', desc: 'GPA 達 3.8 以上', earned: true },
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
        {activeTab === 'courses' && (
          <div className="insetGroup">
            {MOCK_COURSES.map((c, i) => (
              <div
                key={c.name}
                className="insetGroupRow"
                style={{ borderTop: i === 0 ? 'none' : undefined }}
              >
                <div
                  className="insetGroupRowIcon"
                  style={{
                    fontSize: 18,
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
              </div>
            ))}
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
