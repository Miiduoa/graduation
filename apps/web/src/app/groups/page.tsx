'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { DEMO_COURSES, DEMO_CLUBS } from '@/lib/demoData';

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
}

export default function GroupsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [filter, setFilter] = useState<'all' | 'course' | 'club'>('all');
  const [search, setSearch] = useState('');

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
    }));
    return [...courses, ...clubs];
  }, [q]);

  const filtered = groups.filter(
    (g) => (filter === 'all' || g.type === filter) && (!search || g.name.includes(search)),
  );

  const totalUnread = groups.reduce((s, g) => s + g.unread, 0);

  return (
    <SiteShell title="群組" subtitle="課程討論與社團交流" schoolName={schoolName}>
      <div className="pageStack">
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
