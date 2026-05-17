'use client';

import { useState, useEffect } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  getAuth,
  fetchGroups,
  joinGroup,
  leaveGroup,
  checkGroupMembership,
  isFirebaseConfigured,
  type Group,
} from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useDemoRole, getCapabilities, getDemoRoleDefinition } from '@/lib/demoRole';
import { DEMO_CLUBS, CLUB_ACTIVITIES } from '@/lib/demoData';
import {
  useDemoStore,
  applyClub,
  approveClubMember,
  rejectClubMember,
  getClubMembershipStatus,
  getPendingClubMembers,
} from '@/lib/demoStore';
import Link from 'next/link';

interface Club {
  id: string;
  name: string;
  category: string;
  members: number;
  nextEvent?: string;
  nextEventDate?: string;
  description: string;
  color: string;
  icon: string;
  isJoined: boolean;
}

const CLUB_COLORS = [
  '#5E6AD2',
  '#BF5AF2',
  '#34C759',
  '#FF9500',
  '#FF3B30',
  '#007AFF',
  '#32ADE6',
  '#FF6B35',
];
const CLUB_ICONS = ['💻', '📷', '⛰️', '🚀', '🎻', '🏓', '🎨', '🎵'];

// 唯一資料源：DEMO_CLUBS（與公告頁 relatedClubId、AI 開場白一致）
const MOCK_CLUBS: Club[] = DEMO_CLUBS.map((c) => ({
  id: c.id,           // club-1, club-2, ... — 與公告的 relatedClubId 一致
  name: c.name,
  category: c.category,
  members: c.members,
  nextEvent: c.nextEvent,
  nextEventDate: c.nextEventDate,
  description: c.description,
  color: c.color,
  icon: c.icon,
  isJoined: c.isJoined, // 程式設計社 (club-1) 預設 isJoined: true（王小明已加入）
}));

const CATEGORIES = ['全部', '課程', '社團', '學術', '藝術', '運動'];

function mapGroupToClub(g: Group, idx: number, joinedIds: Set<string>): Club {
  const categoryMap: Record<string, string> = {
    course: '課程',
    club: '社團',
    study: '學術',
  };
  return {
    id: g.id,
    name: g.name,
    category: categoryMap[g.type ?? 'club'] ?? '社團',
    members: g.memberCount ?? 0,
    description: g.description ?? '加入群組參與討論',
    color: CLUB_COLORS[idx % CLUB_COLORS.length],
    icon: CLUB_ICONS[idx % CLUB_ICONS.length],
    isJoined: joinedIds.has(g.id),
  };
}

export default function ClubsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const roleDef = getDemoRoleDefinition(demoRole);
  const { success, info } = useToast();
  const store = useDemoStore();
  // 社長視角：讀取待審核成員
  const pendingClubMembers = getPendingClubMembers('club-1', store);
  const [category, setCategory] = useState('全部');
  const [clubs, setClubs] = useState<Club[]>(MOCK_CLUBS);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [usingDemo, setUsingDemo] = useState(true);

  // 監聽 Firebase Auth
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 載入 Firebase 群組資料
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setClubs(MOCK_CLUBS);
      setUsingDemo(true);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const groups = await fetchGroups(schoolId, 30);
        if (!active) return;
        if (groups.length > 0) {
          // 查詢用戶已加入的群組
          const joinedIds = new Set<string>();
          if (user) {
            const checks = await Promise.all(
              groups.map((g) => checkGroupMembership(g.id, user.uid)),
            );
            groups.forEach((g, i) => {
              if (checks[i].isMember) joinedIds.add(g.id);
            });
          }
          setClubs(groups.map((g, i) => mapGroupToClub(g, i, joinedIds)));
          setUsingDemo(false);
        } else {
          setClubs(MOCK_CLUBS);
          setUsingDemo(true);
        }
      } catch {
        if (active) {
          setClubs(MOCK_CLUBS);
          setUsingDemo(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [schoolId, user]);

  const filtered = clubs.filter(
    (c) =>
      (category === '全部' || c.category === category) &&
      (!search || c.name.includes(search) || c.description.includes(search)),
  );

  const toggleJoin = async (id: string) => {
    // 沒有加入社團權限的角色（校友、訪客、系主任）：給友善提示
    if (!caps.canJoinClubs) {
      info(
        demoRole === 'alumni'
          ? '校友身份僅可瀏覽，無法加入社團'
          : demoRole === 'guest'
            ? '請先登入後才能加入社團'
            : `${roleDef.label}身份無法直接加入社團`,
      );
      return;
    }
    if (!user || usingDemo) {
      // Demo 模式：更新本地狀態 + 寫入 demoStore
      const club = clubs.find((c) => c.id === id);
      if (club?.isJoined) {
        setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, isJoined: false, members: c.members - 1 } : c)));
        info(`已退出「${club.name}」`);
      } else if (club) {
        setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, isJoined: true, members: c.members + 1 } : c)));
        // 學生（王小明）申請加入，通知社長
        if (demoRole === 'student') {
          applyClub({
            clubId: club.id,
            clubName: club.name,
            studentId: 'stu-001',
            studentName: '王小明',
          });
          success(`✅ 已送出加入申請！社長審核後你會收到通知。`);
        } else {
          success(`已加入「${club.name}」！`);
        }
      }
      return;
    }
    setJoiningId(id);
    const club = clubs.find((c) => c.id === id);
    try {
      if (club?.isJoined) {
        await leaveGroup(id, user.uid);
      } else {
        await joinGroup(id, user.uid, user.displayName ?? undefined);
      }
      setClubs((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, isJoined: !c.isJoined, members: c.isJoined ? c.members - 1 : c.members + 1 }
            : c,
        ),
      );
    } catch (err) {
      console.error('Join/leave group failed:', err);
    } finally {
      setJoiningId(null);
    }
  };

  const joined = clubs.filter((c) => c.isJoined);

  return (
    <SiteShell title="社團活動" subtitle="探索校園活動與社團" schoolName={schoolName}>
      <div className="pageStack">
        {/* 社團幹部管理區（只有 club_officer / admin 看得到） */}
        {caps.canPublishClubEvents ? (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'rgba(52,199,89,0.10)',
              border: '1px solid #34C759',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1F7A2E', marginBottom: 4 }}>
                  🎯 社團幹部管理區 · 程式設計社
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                  你是<strong>程式設計社社長（陳社長）</strong>，可以發布活動、管理 120 位成員與審核入社申請。
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => success('已開啟「發布社團活動」表單（demo）')}
                  className="btn primary"
                  style={{ fontSize: 13 }}
                >
                  ＋ 發布社團活動
                </button>
                <button
                  type="button"
                  onClick={() => success('已開啟「成員管理」面板（demo）')}
                  className="btn"
                  style={{ fontSize: 13 }}
                >
                  👥 管理成員
                </button>
                <button
                  type="button"
                  onClick={() => success('已開啟「入社申請審核」面板')}
                  className="btn"
                  style={{ fontSize: 13 }}
                >
                  📝 審核申請{pendingClubMembers.length > 0 ? ` (${pendingClubMembers.length})` : ''}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 社長：待審核成員列表（有申請時才顯示） */}
        {caps.canManageClubMembers && pendingClubMembers.length > 0 && (
          <div className="card" style={{ padding: '14px 18px', border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
              📥 待審核入社申請（{pendingClubMembers.length} 筆）
            </div>
            {pendingClubMembers.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{m.studentName}</span>
                  <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>申請加入 {m.clubName}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => {
                      approveClubMember(m.id);
                      success(`✅ 已核准 ${m.studentName} 加入！學生已收到通知。`);
                    }}
                  >
                    ✓ 核准
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => {
                      rejectClubMember(m.id);
                      info(`已退回 ${m.studentName} 的申請`);
                    }}
                  >
                    退回
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 學生：顯示申請狀態 */}
        {demoRole === 'student' && (() => {
          const status = getClubMembershipStatus('club-1', 'stu-001', store);
          if (status !== 'pending') return null;
          return (
            <div className="card" style={{ padding: '10px 14px', border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)', fontSize: 13 }}>
              ⏳ <strong>程式設計社申請審核中</strong>，社長核准後你會收到通知。
            </div>
          );
        })()}

        {usingDemo && (
          <div
            className="card"
            style={{
              padding: '10px 16px',
              background: 'var(--warning-soft)',
              borderColor: 'var(--warning)',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            ⚠️ 目前顯示示範資料。{!user ? '請登入帳號' : 'Firebase 尚未設定或無社團資料'}。
            {loading && '載入中...'}
          </div>
        )}

        {/* ── AI 社團活動提醒（學生：已加入社團有近期活動） ── */}
        {demoRole === 'student' && joined.length > 0 && (() => {
          const upcomingActivities = CLUB_ACTIVITIES.filter((a) =>
            joined.some((c) => c.id === a.clubId)
          ).sort((a, b) => a.date.localeCompare(b.date));
          if (upcomingActivities.length === 0) return null;
          const next = upcomingActivities[0];
          return (
            <div
              className="card"
              style={{
                padding: '14px 18px',
                background: 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(0,200,100,0.06) 100%)',
                border: '1px solid rgba(52,199,89,0.30)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1F7A2E', marginBottom: 3 }}>
                  🤖 AI 社團提醒
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                  【{next.clubName}】<strong>{next.title}</strong>，時間：{next.date}，地點：{next.location}
                  {next.registrationDeadline && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>（報名截止：{next.registrationDeadline}）</span>}
                </div>
              </div>
              <Link
                href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`我參加的社團最近有什麼活動？黑客松要怎麼準備？`)}`}
                className="btn"
                style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                問 AI →
              </Link>
            </div>
          );
        })()}

        {/* ── My Clubs ── */}
        {joined.length > 0 && (
          <div className="sectionCard">
            <h3 className="sectionTitle">⭐ 我加入的社團</h3>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {joined.map((c) => (
                <div
                  key={c.id}
                  style={{
                    flexShrink: 0,
                    width: 140,
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    padding: '16px 14px',
                    boxShadow: 'var(--shadow-sm)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {c.name}
                  </div>
                  {c.nextEvent && (
                    <div style={{ fontSize: 11, color: c.color, marginTop: 4, fontWeight: 600 }}>
                      {c.nextEvent} {c.nextEventDate}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <input
              className="input"
              type="search"
              placeholder="搜尋社團…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 42 }}
            />
          </div>
          <div className="segmentedGroup">
            {CATEGORIES.filter(
              (cat) => cat === '全部' || clubs.some((c) => c.category === cat),
            ).map((c) => (
              <button
                key={c}
                className={category === c ? 'active' : ''}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* ── Club Grid ── */}
        <div className="grid-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="card"
              style={{ borderTop: `3px solid ${c.color}`, padding: '18px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 28 }}>{c.icon}</div>
                <span
                  style={{
                    fontSize: 10,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    background: `${c.color}14`,
                    color: c.color,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                  }}
                >
                  {c.category}
                </span>
              </div>
              <h3
                style={{
                  margin: '0 0 4px',
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                {c.name}
              </h3>
              <p
                style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}
              >
                {c.description}
              </p>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  👥 {c.members > 0 ? `${c.members} 人` : '—'}
                  {c.nextEvent && (
                    <span style={{ marginLeft: 6, color: c.color, fontWeight: 600 }}>
                      · {c.nextEvent}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => toggleJoin(c.id)}
                  disabled={joiningId === c.id}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: c.isJoined ? 'var(--border)' : c.color,
                    background: c.isJoined ? 'var(--panel)' : `${c.color}14`,
                    color: c.isJoined ? 'var(--muted)' : c.color,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: joiningId === c.id ? 'wait' : 'pointer',
                    transition: 'all 0.15s ease',
                    opacity: joiningId === c.id ? 0.6 : 1,
                  }}
                >
                  {joiningId === c.id ? '處理中...' : c.isJoined ? '已加入' : '加入'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}
          >
            找不到符合條件的社團
          </div>
        )}
      </div>
    </SiteShell>
  );
}
