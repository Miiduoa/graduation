'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole } from '@/lib/demoRole';

type ResultType = 'announcement' | 'course' | 'location' | 'club' | 'student' | 'teacher' | 'admin-action';

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  /** 哪些角色看得到 */
  visibleRoles?: string[];
}

const TYPE_LABELS: Record<ResultType, string> = {
  announcement: '公告',
  course: '課程',
  location: '地點',
  club: '社團',
  student: '學生',
  teacher: '教師',
  'admin-action': '管理動作',
};

const MOCK_RESULTS: SearchResult[] = [
  // 共通
  { id: '1', type: 'announcement', title: '期末考試時間表公布', subtitle: '6/17–6/23 期末考試', href: '/announcements', icon: '📢' },
  { id: '2', type: 'course', title: '資料結構', subtitle: '王大明 · 工程館 302 · 週一 08:10', href: '/course/c1', icon: '📘' },
  { id: '3', type: 'location', title: '圖書館', subtitle: '二樓安靜區有 15 席可用', href: '/library', icon: '📚' },
  { id: '4', type: 'club', title: '程式設計社', subtitle: '本週五黑客松活動', href: '/clubs', icon: '💻' },
  { id: '5', type: 'location', title: '第一餐廳', subtitle: '營業中 · 雞腿便當 $80', href: '/cafeteria', icon: '🍱' },
  // 教師 / TA 可見
  { id: 'st-1', type: 'student', title: '王小明 (M11302001)', subtitle: '資管系三年級 · 修課 6 門', href: '/admin/students/M11302001', icon: '👤', visibleRoles: ['teacher', 'ta', 'department_head', 'admin'] },
  { id: 'st-2', type: 'student', title: '陳大同 (M11302014)', subtitle: '資管系三年級 · 修課 4 門', href: '/admin/students/M11302014', icon: '👤', visibleRoles: ['teacher', 'ta', 'department_head', 'admin'] },
  // 系主任 / 管理員可見
  { id: 'tc-1', type: 'teacher', title: '王大明 老師', subtitle: '資管系 · 教授資料結構', href: '/teacher/course/c1', icon: '🧑‍🏫', visibleRoles: ['department_head', 'admin'] },
  { id: 'tc-2', type: 'teacher', title: '陳小華 老師', subtitle: '資管系 · 教授線性代數', href: '/teacher/course/c2', icon: '🧑‍🏫', visibleRoles: ['department_head', 'admin'] },
  // 系主任 / 管理員專屬動作
  { id: 'adm-1', type: 'admin-action', title: '前往公告審核佇列', subtitle: '3 件待審', href: '/admin', icon: '📥', visibleRoles: ['department_head', 'admin'] },
  { id: 'adm-2', type: 'admin-action', title: '使用者管理', subtitle: '搜尋並編輯帳號權限', href: '/admin', icon: '🛡️', visibleRoles: ['admin'] },
];

const QUICK_LINKS_BY_ROLE: Record<string, { label: string; href: string; icon: string }[]> = {
  student: [
    { label: '課表', href: '/timetable', icon: '📅' },
    { label: '成績', href: '/grades', icon: '📊' },
    { label: '學分規劃', href: '/credit-planner', icon: '🎯' },
    { label: 'AI 助理', href: '/ai-assistant', icon: '🤖' },
    { label: '公告', href: '/announcements', icon: '📢' },
    { label: '圖書館', href: '/library', icon: '📚' },
  ],
  teacher: [
    { label: '教師工作台', href: '/teacher/course/c1', icon: '🧑‍🏫' },
    { label: '點名', href: '/teacher/course/c1/attendance', icon: '✅' },
    { label: '成績冊', href: '/teacher/course/c1/gradebook', icon: '📊' },
    { label: '題庫', href: '/teacher/course/c1/question-banks', icon: '🗂️' },
    { label: '公告發布', href: '/announcements', icon: '📢' },
    { label: '我教的群組', href: '/groups', icon: '🎓' },
  ],
  ta: [
    { label: '助教課程', href: '/teacher/course/c1', icon: '🧑‍💻' },
    { label: '批改成績', href: '/teacher/course/c1/gradebook', icon: '📝' },
    { label: '點名', href: '/teacher/course/c1/attendance', icon: '✅' },
    { label: '公告', href: '/announcements', icon: '📢' },
  ],
  club_officer: [
    { label: '社團管理', href: '/clubs', icon: '🎯' },
    { label: '社團公告', href: '/announcements', icon: '📢' },
    { label: '群組', href: '/groups', icon: '👥' },
  ],
  department_head: [
    { label: '系所後台', href: '/admin', icon: '🏛️' },
    { label: '公告審核', href: '/admin', icon: '📥' },
    { label: '教師名冊', href: '/admin', icon: '🧑‍🏫' },
    { label: '系所公告', href: '/announcements', icon: '📢' },
  ],
  admin: [
    { label: '管理後台', href: '/admin', icon: '🛡️' },
    { label: '使用者管理', href: '/admin', icon: '👥' },
    { label: '系統設定', href: '/settings', icon: '⚙️' },
    { label: '系統日誌', href: '/admin', icon: '📊' },
  ],
  alumni: [
    { label: '校園公告', href: '/announcements', icon: '📢' },
    { label: '地圖', href: '/map', icon: '🗺' },
    { label: '餐廳', href: '/cafeteria', icon: '🍱' },
  ],
  guest: [
    { label: '公告', href: '/announcements', icon: '📢' },
    { label: '地圖', href: '/map', icon: '🗺' },
    { label: '餐廳', href: '/cafeteria', icon: '🍱' },
    { label: '公車', href: '/bus', icon: '🚌' },
    { label: '登入', href: '/login', icon: '🔑' },
  ],
};

export default function SearchPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  // 依角色過濾結果：沒有 visibleRoles 的視為公開；訪客 / 校友 進一步隱藏個資結果
  const visibleResults = useMemo(() => {
    return MOCK_RESULTS.filter((r) => {
      if (r.visibleRoles && !r.visibleRoles.includes(demoRole)) return false;
      // 訪客 / 校友 不應看到個人資料 / 社團活動詳情
      if ((demoRole === 'guest' || demoRole === 'alumni') && (r.type === 'student' || r.type === 'teacher')) {
        return false;
      }
      return true;
    });
  }, [demoRole]);

  const results = useMemo(
    () =>
      normalizedQuery
        ? visibleResults.filter(
            (r) =>
              r.title.toLowerCase().includes(normalizedQuery) ||
              r.subtitle.toLowerCase().includes(normalizedQuery),
          )
        : [],
    [normalizedQuery, visibleResults],
  );
  const QUICK_LINKS = QUICK_LINKS_BY_ROLE[demoRole] ?? QUICK_LINKS_BY_ROLE.student;
  const isSearching = false;

  return (
    <SiteShell schoolName={schoolName}>
      <div className="pageStack" style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* ── Search Bar ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 6px 6px 16px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid',
            borderColor: query ? 'var(--brand)' : 'var(--border)',
            background: 'var(--surface)',
            boxShadow: query
              ? 'var(--shadow-inset), 0 0 0 3px var(--focus-ring)'
              : 'var(--shadow-inset)',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
        >
          <span style={{ fontSize: 18, opacity: 0.5, flexShrink: 0 }}>🔍</span>
          <input
            autoFocus
            type="search"
            placeholder="搜尋課程、公告、地點、社團…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: 16,
              color: 'var(--text)',
              outline: 'none',
              padding: '12px 0',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted)',
                fontSize: 18,
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Quick Links (when no query) ── */}
        {!query && (
          <div className="sectionCard">
            <h3
              style={{
                margin: '0 0 10px',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--muted)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              快速導覽
            </h3>
            <div className="tileGrid">
              {QUICK_LINKS.map((l) => (
                <Link key={l.href} href={`${l.href}${q}`} className="tileLink">
                  <span className="tileIcon">{l.icon}</span>
                  <span className="tileLabel">{l.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {query && (
          <div>
            {isSearching ? (
              <div className="pageStack">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '14px 16px',
                      background: 'var(--surface)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div
                      className="skeleton"
                      style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="skeleton" style={{ height: 14, width: '70%' }} />
                      <div className="skeleton" style={{ height: 12, width: '50%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="emptyState">
                <div className="emptyIcon">🔍</div>
                <h3 className="emptyTitle">找不到「{query}」的結果</h3>
                <p className="emptyBody">嘗試不同的關鍵字或縮短搜尋詞</p>
              </div>
            ) : (
              <div className="insetGroup">
                {results.map((r, i) => (
                  <Link
                    key={r.id}
                    href={`${r.href}${q}`}
                    className="insetGroupRow"
                    style={{ borderTop: i === 0 ? 'none' : undefined }}
                  >
                    <div
                      className="insetGroupRowIcon"
                      style={{ fontSize: 20, background: 'var(--panel)', borderRadius: 10 }}
                    >
                      {r.icon}
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{r.title}</div>
                      <div className="insetGroupRowMeta">{r.subtitle}</div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'var(--panel2)',
                        color: 'var(--muted)',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {TYPE_LABELS[r.type]}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
