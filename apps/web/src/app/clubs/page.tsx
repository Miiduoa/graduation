'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
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
  '#007AFF',
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
  const router = useRouter();
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const roleDef = getDemoRoleDefinition(demoRole);
  const { success, info } = useToast();
  const store = useDemoStore();
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);
  // 社長視角：讀取待審核成員
  const pendingClubMembers = getPendingClubMembers('club-1', store);
  const [category, setCategory] = useState('全部');
  const [clubs, setClubs] = useState<Club[]>(MOCK_CLUBS);
  // isPending 從 demoStore 衍生（持久化），不再用 session 記憶體 Set
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [, setLoading] = useState(false);
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
        // 學生（王小明）申請加入，通知社長 — 不立即標記 isJoined，等社長核准後才生效
        if (demoRole === 'student') {
          applyClub({
            clubId: club.id,
            clubName: club.name,
            studentId: 'stu-001',
            studentName: '王小明',
          });
          success(`✅ 已送出加入申請！社長審核後你會收到通知。`);
        } else {
          setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, isJoined: true, members: c.members + 1 } : c)));
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
        {/* 社團幹部管理區（只有 club_officer 看得到；admin 另有全校管理視角） */}
        {demoRole === 'club_officer' ? (
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
                  onClick={() => router.push(`/announcements${q ? q + '&' : '?'}compose=1&club=club-1`)}
                  className="btn primary"
                  style={{ fontSize: 13 }}
                >
                  ＋ 發布社團活動
                </button>
                <button
                  type="button"
                  onClick={() => setShowManageMembersModal(true)}
                  className="btn"
                  style={{ fontSize: 13 }}
                >
                  👥 管理成員（120）
                </button>
                {pendingClubMembers.length > 0 && (
                  <a
                    href="#pending-applicants"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById('pending-applicants')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="btn"
                    style={{ fontSize: 13, textDecoration: 'none' }}
                  >
                    📝 審核申請 ({pendingClubMembers.length})
                  </a>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* 社長：待審核成員列表（有申請時才顯示，club_officer 專用） */}
        {demoRole === 'club_officer' && pendingClubMembers.length > 0 && (
          <div id="pending-applicants" className="card" style={{ padding: '14px 18px', border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
              📥 待審核入社申請（{pendingClubMembers.length} 筆）
            </div>
            {pendingClubMembers.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{m.studentName}</span>
                  <span style={{ fontSize: 12, color: '#8E8E93', marginLeft: 8 }}>申請加入 {m.clubName}</span>
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

        {/* 學生：顯示所有申請中社團的狀態橫幅 */}
        {demoRole === 'student' && (() => {
          const pendingClubs = clubs.filter(
            (c) => getClubMembershipStatus(c.id, 'stu-001', store) === 'pending',
          );
          if (pendingClubs.length === 0) return null;
          return (
            <div className="card" style={{ padding: '10px 14px', border: '1px solid #FF9500', background: 'rgba(255,149,0,0.08)', fontSize: 13 }}>
              ⏳ <strong>{pendingClubs.map((c) => c.name).join('、')} 申請審核中</strong>，社長核准後你會收到通知。
            </div>
          );
        })()}

        {/* 訪客/校友：角色限制提示 */}
        {(demoRole === 'guest' || demoRole === 'alumni') && (
          <div className="card" style={{ padding: '12px 16px', background: 'var(--info-soft)', border: '1px solid var(--info)', fontSize: 13 }}>
            {demoRole === 'guest'
              ? <>🔒 <strong>訪客身份</strong>：請先 <Link href={`/login${q}`} style={{ color: 'var(--brand)', fontWeight: 600 }}>登入</Link> 後才能申請加入社團。</>
              : <>🎓 <strong>校友身份</strong>：可瀏覽社團資訊，但無法申請加入在校社團。如需聯繫請透過系友會。</>}
          </div>
        )}
        {/* 系主任/管理員：管理視角提示 */}
        {(demoRole === 'department_head' || demoRole === 'admin') && (
          <div className="card" style={{ padding: '12px 16px', background: roleDef.toneSoft, border: `1px solid ${roleDef.tone}`, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{roleDef.icon}</span>
            <span><strong>{roleDef.label}視角</strong>：查看全校社團概況，社團幹部申請的公告需經你審核後才能對外發布。</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {demoRole === 'student' && !c.isJoined && (
                    <Link
                      href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`【${c.name}】這個社團適合我嗎？它平常做什麼活動？我能從中得到什麼？`)}`}
                      title="問 AI 這社團適不適合我"
                      style={{
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(0,122,255,0.30)',
                        background: 'rgba(0,122,255,0.10)',
                        color: '#007AFF',
                        fontSize: 12,
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      🤖
                    </Link>
                  )}
                  {(() => {
                    // 從 demoStore 衍生（持久化跨頁），所有社團一致處理
                    const isPending = demoRole === 'student' &&
                      getClubMembershipStatus(c.id, 'stu-001', store) === 'pending';
                    return (
                      <button
                        onClick={() => !isPending && toggleJoin(c.id)}
                        disabled={joiningId === c.id || isPending}
                        title={
                          !caps.canJoinClubs
                            ? demoRole === 'guest' ? '請先登入' : demoRole === 'alumni' ? '校友無法加入' : `${roleDef.label}無法加入社團`
                            : isPending ? '申請審核中，請等候社長核准' : undefined
                        }
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid',
                          borderColor: !caps.canJoinClubs ? 'var(--border)' : isPending ? 'rgba(255,149,0,0.5)' : c.isJoined ? 'var(--border)' : c.color,
                          background: !caps.canJoinClubs ? 'var(--panel)' : isPending ? 'rgba(255,149,0,0.1)' : c.isJoined ? 'var(--panel)' : `${c.color}14`,
                          color: !caps.canJoinClubs ? 'var(--muted)' : isPending ? '#B45309' : c.isJoined ? 'var(--muted)' : c.color,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: joiningId === c.id || isPending ? 'default' : 'pointer',
                          transition: 'all 0.15s ease',
                          opacity: joiningId === c.id ? 0.6 : 1,
                        }}
                      >
                        {joiningId === c.id ? '處理中...'
                          : !caps.canJoinClubs ? (demoRole === 'guest' ? '🔒 登入後加入' : '🔒 無法加入')
                          : isPending ? '⏳ 審核中'
                          : c.isJoined ? '已加入' : '申請加入'}
                      </button>
                    );
                  })()}
                </div>
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

      {/* 👥 管理成員 Modal（社長視角） */}
      <Modal
        isOpen={showManageMembersModal}
        onClose={() => setShowManageMembersModal(false)}
        title="👥 程式設計社 · 成員管理（120 人）"
        size="lg"
        footer={
          <>
            <button className="btn" onClick={() => setShowManageMembersModal(false)}>關閉</button>
            <a
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我分析程式設計社的成員活躍度，找出 30 天未參與活動的成員，並起草召回信')}`}
              className="btn primary"
              onClick={() => setShowManageMembersModal(false)}
              style={{ textDecoration: 'none' }}
            >
              🤖 AI 分析活躍度
            </a>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="pill brand">✨ 幹部 6 人</span>
            <span className="pill subtle">🧑 一般成員 114 人</span>
            <span className="pill warning">🌱 近 30 天新加入 8 人</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { name: '陳社長', role: '社長', joined: '2024-09', active: true },
              { name: '林副社長', role: '副社長', joined: '2024-09', active: true },
              { name: '黃活動長', role: '活動長', joined: '2024-09', active: true },
              { name: '王小明', role: '一般成員', joined: '2025-02', active: true },
              { name: '張思源', role: '一般成員', joined: '2025-03', active: false },
              { name: '李宇欣', role: '新申請', joined: '2026-05', active: false },
            ].map((m) => (
              <div key={m.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--panel)', borderRadius: 8 }}>
                <div>
                  <strong>{m.name}</strong>
                  <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{m.role}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>加入 {m.joined}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!m.active && (
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'var(--warning-soft)', color: '#C17A00' }}>需關心</span>
                  )}
                  {m.role !== '社長' && (
                    <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => info(`已開啟「調整 ${m.name} 角色」面板`)}>調整</button>
                  )}
                </div>
              </div>
            ))}
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: 8 }}>
              … 還有 114 位成員（捲動查看，或用搜尋找特定成員）
            </div>
          </div>
        </div>
      </Modal>
    </SiteShell>
  );
}
