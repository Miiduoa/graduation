'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { DEMO_COURSES, DEMO_CLUBS, getDemoUser } from '@/lib/demoData';
import { useDemoRole } from '@/lib/demoRole';

interface Group {
  id: string;
  name: string;
  type: 'course' | 'club';
  members: number;
  unread: number;
  lastMessage: string;
  lastTime: string;
  color: string;
  icon: string;
  href: string;
  /** 對當前角色而言的「我的角色」標籤：授課 / 助教 / 學生 / 社長 */
  myRole?: '授課' | '助教' | '學生' | '社長' | '社員';
}

export default function GroupsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [filter, setFilter] = useState<'all' | 'course' | 'club'>('all');
  const [search, setSearch] = useState('');
  const [demoRole] = useDemoRole();

  // 角色感知：教師看「我授課的」, TA 看「我助教的」, 社長看「我管理的社團」
  const courseToMyRole = useMemo((): Record<string, Group['myRole']> => {
    if (demoRole === 'teacher') {
      const u = getDemoUser('teacher');
      // 教師預設帶 c1（資料結構 - 王大明）；若資料有 instructorId 對應到帳號 uid 也能算
      const taughtIds = DEMO_COURSES.filter((c) => c.instructorId === u?.uid || c.id === 'c1').map(
        (c) => c.id,
      );
      return Object.fromEntries(taughtIds.map((id) => [id, '授課' as const]));
    }
    if (demoRole === 'ta') {
      return { c1: '助教' };
    }
    if (demoRole === 'student') {
      return Object.fromEntries(DEMO_COURSES.map((c) => [c.id, '學生' as const]));
    }
    return {};
  }, [demoRole]);

  const clubToMyRole = useMemo((): Record<string, Group['myRole']> => {
    if (demoRole === 'club_officer') {
      return { 'club-1': '社長' };
    }
    if (demoRole === 'student') {
      // demo: 學生只加入了程式設計社（DEMO_CLUBS isJoined 標記）
      return Object.fromEntries(DEMO_CLUBS.filter((c) => c.isJoined).map((c) => [c.id, '社員']));
    }
    return {};
  }, [demoRole]);

  // 從統一 demoData 合併課程與社團
  const groups: Group[] = useMemo(() => {
    const courses: Group[] = DEMO_COURSES.map((c) => ({
      id: c.id,
      name: c.name,
      type: 'course',
      members: c.members,
      unread: c.unread,
      lastMessage: c.lastMessage,
      lastTime: c.lastTime,
      color: c.color,
      icon: c.icon,
      href: `/course/${c.id}${q}`,
      myRole: courseToMyRole[c.id],
    }));
    const clubs: Group[] = DEMO_CLUBS.map((c) => ({
      id: c.id,
      name: c.name,
      type: 'club',
      members: c.members,
      unread: c.unread,
      lastMessage: c.lastMessage,
      lastTime: c.lastTime,
      color: c.color,
      icon: c.icon,
      href: `/clubs${q}`,
      myRole: clubToMyRole[c.id],
    }));
    return [...courses, ...clubs];
  }, [q, courseToMyRole, clubToMyRole]);

  const filtered = groups.filter(
    (g) => (filter === 'all' || g.type === filter) && (!search || g.name.includes(search)),
  );

  const totalUnread = groups.reduce((s, g) => s + g.unread, 0);

  return (
    <SiteShell title="群組" subtitle="課程討論與社團交流" schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Guest / Alumni 提示 ── */}
        {(demoRole === 'guest' || demoRole === 'alumni') && (
          <div className="card" style={{ padding: '12px 16px', background: 'var(--warning-soft)', borderColor: 'var(--warning)', fontSize: 13 }}>
            {demoRole === 'guest' ? (
              <>
                🔒 訪客身份僅可瀏覽群組列表。請{' '}
                <Link href={`/login${q}`} style={{ color: 'var(--brand)', fontWeight: 600 }}>登入</Link>
                {' '}後才能查看課程討論與社團內容。
              </>
            ) : (
              '🎓 校友身份可瀏覽群組列表，但無法加入課程討論群組。'
            )}
          </div>
        )}
        {/* ── Stats ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ '--tone': 'var(--brand)' } as React.CSSProperties}>
            <div className="metricIcon">💬</div>
            <div className="metricValue">{groups.length}</div>
            <div className="metricLabel">已加入群組</div>
          </div>
          <div
            className="metricCard"
            style={{ '--tone': totalUnread > 0 ? '#FF3B30' : '#34C759' } as React.CSSProperties}
          >
            <div className="metricIcon">{totalUnread > 0 ? '🔴' : '✅'}</div>
            <div className="metricValue">{totalUnread}</div>
            <div className="metricLabel">未讀訊息</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#007AFF' } as React.CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">
              {groups.filter((g) => g.type === 'course').length}
            </div>
            <div className="metricLabel">課程群組</div>
          </div>
        </div>

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <input
              className="input"
              type="search"
              placeholder="搜尋群組…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 42 }}
            />
          </div>
          <div className="segmentedGroup">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              全部
            </button>
            <button
              className={filter === 'course' ? 'active' : ''}
              onClick={() => setFilter('course')}
            >
              課程
            </button>
            <button className={filter === 'club' ? 'active' : ''} onClick={() => setFilter('club')}>
              社團
            </button>
          </div>
        </div>

        {/* ── Group List ── */}
        <div className="insetGroup">
          {filtered.map((g, i) => (
            <Link
              key={g.id}
              href={g.href}
              className="insetGroupRow"
              style={{
                borderTop: i === 0 ? 'none' : undefined,
                cursor: 'pointer',
                position: 'relative',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div
                className="insetGroupRowIcon"
                style={{
                  fontSize: 22,
                  background: `${g.color}14`,
                  color: g.color,
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  flexShrink: 0,
                }}
              >
                {g.icon}
              </div>
              <div className="insetGroupRowContent">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="insetGroupRowTitle">{g.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 7px',
                      borderRadius: '999px',
                      background: g.type === 'course' ? 'var(--info-soft)' : 'var(--success-soft)',
                      color: g.type === 'course' ? 'var(--info)' : 'var(--success)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {g.type === 'course' ? '課程' : '社團'}
                  </span>
                  {g.myRole && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: '999px',
                        background:
                          g.myRole === '授課' || g.myRole === '社長'
                            ? 'rgba(255,149,0,0.18)'
                            : g.myRole === '助教'
                              ? 'rgba(124,58,237,0.16)'
                              : 'rgba(94,106,210,0.12)',
                        color:
                          g.myRole === '授課' || g.myRole === '社長'
                            ? '#B45309'
                            : g.myRole === '助教'
                              ? '#5B21B6'
                              : 'var(--brand)',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                      title={`你是這個群組的「${g.myRole}」`}
                    >
                      {g.myRole === '授課'
                        ? '★ 我授課'
                        : g.myRole === '助教'
                          ? '★ 我助教'
                          : g.myRole === '社長'
                            ? '★ 我管理'
                            : g.myRole === '社員'
                              ? '已加入'
                              : '已修'}
                    </span>
                  )}
                </div>
                <div className="insetGroupRowMeta" style={{ display: 'flex', gap: 6 }}>
                  <span>{g.lastMessage}</span>
                </div>
              </div>
              <div
                style={{
                  textAlign: 'right',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{g.lastTime}</span>
                {g.unread > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      background: 'var(--danger)',
                      color: '#fff',
                      borderRadius: '999px',
                      padding: '2px 7px',
                      minWidth: 20,
                      textAlign: 'center',
                    }}
                  >
                    {g.unread}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="emptyState">
            <div className="emptyIcon">💬</div>
            <h3 className="emptyTitle">找不到群組</h3>
            <p className="emptyBody">嘗試調整搜尋條件</p>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
