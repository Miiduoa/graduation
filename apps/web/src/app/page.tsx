'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  fetchAnnouncements,
  fetchGPA,
  getAuth,
  isFirebaseConfigured,
  type Announcement,
} from '@/lib/firebase';
import { mockAnnouncements } from '@campus/shared/src/mockData';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import { getStudentContextSummary, getTeacherContextSummary, getClubOfficerContextSummary, getDeptHeadContextSummary, getAdminContextSummary } from '@/lib/aiContext';

function formatGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '早安';
  if (hour < 18) return '午安';
  return '晚上好';
}

export default function HomePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const {
    schoolId,
    schoolCode,
    schoolName,
    schoolSearch: q,
  } = resolveSchoolPageContext(props.searchParams);
  const [user, setUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [gpa, setGpa] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoRole] = useDemoRole();
  const demoRoleDef = getDemoRoleDefinition(demoRole);
  const isAlumniOrGuest = demoRole === 'alumni' || demoRole === 'guest';

  useEffect(() => {
    const auth = getAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        if (isFirebaseConfigured()) {
          const [nextAnnouncements, nextGpa] = await Promise.all([
            fetchAnnouncements(schoolId, 4),
            user ? fetchGPA(user.uid) : Promise.resolve(null),
          ]);

          if (!active) return;
          setAnnouncements(
            (nextAnnouncements.length > 0
              ? nextAnnouncements
              : mockAnnouncements.slice(0, 4)) as Announcement[],
          );
          setGpa(nextGpa?.cumulative ?? null);
        } else {
          if (!active) return;
          setAnnouncements(mockAnnouncements.slice(0, 4) as Announcement[]);
        }
      } catch {
        if (!active) return;
        setAnnouncements(mockAnnouncements.slice(0, 4) as Announcement[]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [schoolId, user]);

  const userLabel = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '訪客';

  // ── 待審公告計數（系主任 / 管理員）：需訂閱 demoPendingAnnChange 才能即時更新 ──
  const [pendingAnnTick, setPendingAnnTick] = useState(0);
  useEffect(() => {
    const handler = () => setPendingAnnTick((n) => n + 1);
    window.addEventListener('demoPendingAnnChange', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('demoPendingAnnChange', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // Context 函數在 render 時才呼叫，確保讀到最新 localStorage 資料
  const aiCtx = useMemo(() => demoRole === 'student' ? getStudentContextSummary() : null, [demoRole]);
  const teacherCtx = useMemo(() => (demoRole === 'teacher' || demoRole === 'ta') ? getTeacherContextSummary() : null, [demoRole]);
  const clubCtx = useMemo(() => demoRole === 'club_officer' ? getClubOfficerContextSummary() : null, [demoRole]);
  // pendingAnnTick 是觸發器：demoPendingAnnChange 時 +1，迫使 useMemo 重新讀 readPendingAnns()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: pendingAnnTick triggers re-read of localStorage
  const deptCtx = useMemo(() => demoRole === 'department_head' ? getDeptHeadContextSummary() : null, [demoRole, pendingAnnTick]);
  const adminCtx = useMemo(() => demoRole === 'admin' ? getAdminContextSummary() : null, [demoRole]);

  const heroConfig = (() => {
    switch (demoRole) {
      case 'teacher':
        return {
          eyebrow: 'Teaching Dashboard',
          headline: `今日 2 堂課 · ${teacherCtx?.totalPending ?? 5} 份待批改`,
          sub: '資料結構 CS301 09:10–10:50 · 最舊待批改：2 天前繳交',
          buttons: [
            { href: `/teacher/course/c1${q}`, label: '⚡ 進入工作台', primary: true },
            { href: `/grades${q}`, label: '成績分布' },
            { href: `/ai-assistant${q}`, label: 'AI 分析' },
          ],
          badge: '王大明老師',
        };
      case 'ta':
        return {
          eyebrow: 'TA Dashboard',
          headline: `1 門助教課 · ${teacherCtx?.totalPending ?? 8} 件待批改`,
          sub: '資料結構（林助教）· 本週辦公室時間 Wed 14:00–15:30',
          buttons: [
            { href: `/teacher/course/c1${q}`, label: '⚡ 進入助教台', primary: true },
            { href: `/grades${q}`, label: '成績列表' },
          ],
          badge: '林助教',
        };
      case 'club_officer':
        return {
          eyebrow: 'Club Dashboard',
          headline: `${clubCtx?.clubName ?? '程式設計社'} · ${clubCtx?.pendingMemberRequests ?? 3} 筆申請待審`,
          sub: `${clubCtx?.memberCount ?? 120} 位成員 · 本週五社課 15:30 工程館 203`,
          buttons: [
            { href: `/clubs${q}`, label: '⚡ 社團管理', primary: true },
            { href: `/announcements${q}`, label: '發布公告' },
            { href: `/ai-assistant${q}`, label: 'AI 招募文案' },
          ],
          badge: '陳社長',
        };
      case 'department_head':
        return {
          eyebrow: 'Department Dashboard',
          headline: `${deptCtx?.pendingAnnCount ?? 0} 則公告待審核 · 全系 ${deptCtx?.studentCount ?? 312} 位學生`,
          sub: `資訊工程學系 · 本學期開設課程 · ${deptCtx?.teacherCount ?? 19} 位教師`,
          buttons: [
            { href: `/admin${q}`, label: '⚡ 行政後台', primary: true },
            { href: `/announcements${q}`, label: '公告管理' },
            { href: `/ai-assistant${q}`, label: 'AI 助理' },
          ],
          badge: '黃主任',
        };
      case 'admin':
        return {
          eyebrow: 'System Dashboard',
          headline: `系統${adminCtx?.systemOk ? '正常' : '異常'} · 今日 ${adminCtx?.securityEventCount ?? 0} 件安全事件`,
          sub: `${adminCtx?.activeUsers ?? 89} 位活躍使用者 · API 回應正常 · 最近備份今日 03:00`,
          buttons: [
            { href: `/admin${q}`, label: '⚡ 系統後台', primary: true },
            { href: `/ai-assistant${q}`, label: 'AI 安全分析' },
          ],
          badge: adminCtx?.hasSecurity ? '⚠️ 注意安全警示' : '✅ 系統正常',
        };
      case 'alumni':
        return {
          eyebrow: 'Alumni Portal',
          headline: '歡迎回來，李校友 · 已畢業 3 年',
          sub: '資訊工程學系 109 屆 · 128 學分 · GPA 3.65 · 校友服務與母校資訊都在這裡',
          buttons: [
            { href: `/announcements${q}`, label: '🎓 校園公告', primary: true },
            { href: `/clubs${q}`, label: '校友活動' },
            { href: `/profile${q}`, label: '我的檔案' },
          ],
          badge: '109 屆校友',
        };
      default: // student
        return {
          eyebrow: 'Today Dashboard',
          headline: `今日 3 堂課 · ${aiCtx?.pendingAssignmentCount ?? 2} 份作業截止`,
          sub: '資料結構 09:10 · 微積分 13:10 · 英文 15:10',
          buttons: [
            { href: `/timetable${q}`, label: '📅 查看課表', primary: true },
            { href: `/grades${q}`, label: '我的成績' },
            { href: `/ai-assistant${q}`, label: '問 AI' },
          ],
          badge: loading ? '整理中…' : `${announcements.length} 則今日更新`,
        };
    }
  })();

  const importantAnnouncements = useMemo(
    () =>
      announcements.filter(
        (announcement) => announcement.pinned || announcement.title.includes('重要'),
      ).length,
    [announcements],
  );

  const roleCards = [
    {
      title: 'Today',
      description: '先看今天最重要的一步，而不是先看功能表。',
      accent: 'var(--brand)',
    },
    {
      title: '課程',
      description: '把教材、作業、測驗、點名與成績收回同一條課程主流程。',
      accent: 'var(--info)',
    },
    {
      title: '校園',
      description: '地圖、公車、餐廳與支援服務留在校園，不打斷主學習流程。',
      accent: 'var(--achievement)',
    },
    {
      title: '收件匣',
      description: '每筆更新都直接對應到下一步，而不是只顯示通知。',
      accent: 'var(--warning)',
    },
  ];

  // demo 模式：除了 guest 以外的角色都進 dashboard 視圖
  if (!user && demoRole === 'guest') {
    return (
      <SiteShell schoolName={schoolName} schoolCode={schoolCode}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              background:
                'linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(37,99,235,0.08) 100%)',
              display: 'grid',
              gap: 18,
            }}
          >
            <span className="pill brand">Campus Learning OS</span>
            <div>
              <h1 className="h1" style={{ marginBottom: 10 }}>
                不再是校園功能列表，而是今日學習與校園節奏的操作台
              </h1>
              <p className="sub" style={{ marginTop: 0 }}>
                從 Today
                開始，依序進入課程、校園、收件匣與我的。先降低認知負荷，再疊加信任感與黏著感。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href={`/login${q}`} className="btn primary">
                🎭 看 8 種角色 demo
              </Link>
              <Link href={`/announcements${q}`} className="btn">
                先看公告
              </Link>
            </div>
          </div>

          {/* 首次到訪導覽：把 demo 路徑說清楚 */}
          <div
            className="card"
            style={{
              padding: '16px 20px',
              background: 'var(--info-soft)',
              border: '1px solid var(--info)',
              display: 'grid',
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--info)',
              }}
            >
              👋 第一次到訪？
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text)' }}>
              這是「校園整合應用」畢業專題的 demo。我們把 <strong>8 種角色</strong>
              （學生、教師、TA、社團幹部、系主任、管理員、校友、訪客）都建立了示範流程，
              你可以從 <Link href={`/login${q}`}>登入頁</Link> 任選一個身份進入，
              或進站後從右上角「身份膠囊」一鍵切換。每個角色看到的權限、入口都不同。
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/login${q}`} className="btn primary" style={{ fontSize: 13 }}>
                👩‍🎓 從學生身份開始
              </Link>
              <Link href={`/admin${q}`} className="btn" style={{ fontSize: 13 }}>
                🏛️ 看管理員後台
              </Link>
              <Link href={`/teacher/course/c1${q}`} className="btn" style={{ fontSize: 13 }}>
                🧑‍🏫 看教師端
              </Link>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            {roleCards.map((card) => (
              <div key={card.title} className="card">
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 16,
                    background: `${card.accent}20`,
                    marginBottom: 14,
                  }}
                />
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{card.title}</div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 14 }}>
                  {card.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SiteShell>
    );
  }

  // 用 demoRole 對應的示範姓名取代 userLabel（如果沒真實登入）
  const displayLabel = user ? userLabel : demoRoleDef.shortLabel;

  return (
    <SiteShell
      schoolName={schoolName}
      schoolCode={schoolCode}
      title={`${formatGreeting()}，${displayLabel}`}
      subtitle={
        isAlumniOrGuest
          ? `${demoRoleDef.label}視角 · 校園資訊瀏覽（read-only）`
          : 'Today 只保留下一步、課程節奏與校園情境，不再把首頁做成功能總表。'
      }
    >
      <div className="pageStack">
        {/* Alumni read-only 提示 */}
        {demoRole === 'alumni' ? (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'rgba(142,142,147,0.10)',
              border: '1px solid #8E8E93',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            🎓 <strong>校友身份</strong> · 你可以查看校園公告、活動、地圖等公開資訊，
            但無法加入社團、借書、選課或修改個人資料。如需更多功能請聯絡系所辦公室。
          </div>
        ) : null}

        {/* ── AI Today 提醒浮動卡（學生 / 教師） ── */}
        {demoRole === 'student' && aiCtx && (aiCtx.pendingAssignmentCount > 0 || aiCtx.libraryDueSoonDays <= 3 || aiCtx.nextExam) && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(94,106,210,0.12) 0%, rgba(142,186,255,0.08) 100%)',
              border: '1px solid rgba(94,106,210,0.28)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--brand)', marginBottom: 6 }}>
                🤖 AI 今日提醒
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                {aiCtx.pendingAssignmentCount > 0 && aiCtx.soonestAssignment && (
                  <div>📝 <strong>{aiCtx.pendingAssignmentCount} 份作業</strong>待繳，最緊急：【{aiCtx.soonestAssignment.courseName}】{aiCtx.soonestAssignment.title} 截止 <strong>{aiCtx.soonestAssignment.due}</strong></div>
                )}
                {aiCtx.nextExam && (
                  <div>📅 下一場考試：【{aiCtx.nextExam.courseName}】{aiCtx.nextExam.title}，{aiCtx.nextExam.date} {aiCtx.nextExam.time} @ {aiCtx.nextExam.location}</div>
                )}
                {aiCtx.libraryDueSoonDays <= 3 && (
                  <div>📚 《{aiCtx.libraryDueSoonBook}》還有 <strong>{aiCtx.libraryDueSoonDays} 天</strong>到期，<Link href={`/library${q}`} style={{ color: 'var(--brand)' }}>前往續借 →</Link></div>
                )}
                {aiCtx.nextClubActivity && (
                  <div>🎯 【{aiCtx.nextClubActivity.clubName}】{aiCtx.nextClubActivity.title}，{aiCtx.nextClubActivity.date}</div>
                )}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('我今天有什麼重要的事要做？整理一下截止日和考試')}`}
              className="btn primary"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI 規劃 →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（教師）── */}
        {demoRole === 'teacher' && teacherCtx && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(0,200,200,0.06) 100%)',
              border: '1px solid rgba(15,139,141,0.28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F8B8D', marginBottom: 4 }}>🤖 AI 今日提醒</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                資料結構（CS301）有 <strong>{teacherCtx.totalPending} 份作業</strong>待批改，其中 {teacherCtx.pendingCount} 份尚未開始。今日班級出席率待確認。
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我查一下資料結構今天的點名和待批改作業情況')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（TA）── */}
        {demoRole === 'ta' && teacherCtx && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(167,139,250,0.06) 100%)',
              border: '1px solid rgba(124,58,237,0.28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', marginBottom: 4 }}>🤖 AI 批改助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                資料結構有 <strong>{teacherCtx.totalPending} 份程式作業</strong>待批改。本週辦公室時間 Wed 14:00–15:30。
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我列出所有待批改的作業並排序優先順序')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（社團幹部）── */}
        {demoRole === 'club_officer' && clubCtx && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)',
              border: '1px solid rgba(52,199,89,0.30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1F7A2E', marginBottom: 4 }}>🤖 AI 社團助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {clubCtx.clubName}有 <strong>{clubCtx.pendingMemberRequests} 筆成員申請</strong>待審核。
                {clubCtx.nextActivity ? ` 下次活動：${clubCtx.nextActivity.title}（${clubCtx.nextActivity.date}）。` : ''}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我寫一份社團招募公告草稿')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（系主任）── */}
        {demoRole === 'department_head' && deptCtx && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(255,149,0,0.10) 0%, rgba(255,149,0,0.04) 100%)',
              border: '1px solid rgba(255,149,0,0.30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#C17A00', marginBottom: 4 }}>🤖 AI 行政助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                有 <strong>{deptCtx.pendingAnnCount} 則公告</strong>待審核發布。全系共 {deptCtx.studentCount} 位學生、{deptCtx.teacherCount} 位教師。
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我查看待審核公告並給出處理建議')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（管理員）── */}
        {demoRole === 'admin' && adminCtx && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: adminCtx.hasSecurity
                ? 'linear-gradient(135deg, rgba(255,59,48,0.10) 0%, rgba(255,59,48,0.04) 100%)'
                : 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)',
              border: `1px solid ${adminCtx.hasSecurity ? 'rgba(255,59,48,0.30)' : 'rgba(52,199,89,0.30)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: adminCtx.hasSecurity ? '#C0392B' : '#1F7A2E', marginBottom: 4 }}>
                {adminCtx.hasSecurity ? '⚠️ 安全警示' : '🤖 AI 系統助理'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {adminCtx.hasSecurity
                  ? `今日偵測到 ${adminCtx.securityEventCount} 件異常登入嘗試，來自境外 IP。建議立即查看安全日誌。`
                  : `系統正常運行，${adminCtx.activeUsers} 位活躍使用者，無安全事件。`}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('分析今日系統安全事件，給出處置建議')}`}
              className="btn"
              style={{
                fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0,
                ...(adminCtx.hasSecurity ? { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' } : {}),
              }}
            >
              {adminCtx.hasSecurity ? '⚠️ 立即查看' : '問 AI →'}
            </Link>
          </div>
        )}

        <div
          className="card"
          style={{
            background:
              'linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(8,145,178,0.08) 100%)',
            display: 'grid',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ maxWidth: 760 }}>
              <div className="pageHeadEyebrow" style={{ marginBottom: 10 }}>
                {heroConfig.eyebrow}
              </div>
              <h2 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: '-0.05em' }}>
                {heroConfig.headline}
              </h2>
              <p className="sub" style={{ marginTop: 10 }}>
                {heroConfig.sub}
              </p>
            </div>
            <span className="pill brand">
              {heroConfig.badge}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {heroConfig.buttons.map((btn) => (
              <Link key={btn.label} href={btn.href} className={btn.primary ? 'btn primary' : 'btn'}>
                {btn.label}
              </Link>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {(() => {
            // 角色感知統計卡：每個角色看到不同的「核心指標」
            const baseAnnCard = {
              label: '重要公告',
              value: importantAnnouncements || announcements.length,
              tone: 'var(--warning)',
            };
            const idCard = {
              label: '登入身份',
              value: user?.email ? '已登入' : demoRoleDef.shortLabel,
              tone: 'var(--growth)',
            };
            const gpaCard = {
              label: '累計 GPA',
              value: gpa != null ? gpa.toFixed(2) : '3.82',
              tone: 'var(--brand)',
            };
            const teachingCard = {
              label: '我授課的課程',
              value: '1 門 · 48 位學生',
              tone: 'var(--brand)',
            };
            const taCard = {
              label: '助教課程',
              value: '1 門 · 8 件待批改',
              tone: '#7C3AED',
            };
            const clubOfficerCard = {
              label: '社團成員',
              value: '120 人',
              tone: '#34C759',
            };
            const deptCard = {
              label: '待審公告',
              value: '3 件',
              tone: '#FF9500',
            };
            const adminCard = {
              label: '系統狀態',
              value: '正常運行',
              tone: 'var(--success)',
            };

            switch (demoRole) {
              case 'teacher':
                return [baseAnnCard, teachingCard, idCard];
              case 'ta':
                return [baseAnnCard, taCard, idCard];
              case 'club_officer':
                return [baseAnnCard, clubOfficerCard, idCard];
              case 'department_head':
                return [deptCard, baseAnnCard, idCard];
              case 'admin':
                return [adminCard, deptCard, idCard];
              case 'alumni':
              case 'guest':
                return [baseAnnCard, idCard];
              case 'student':
              default:
                return [baseAnnCard, gpaCard, idCard];
            }
          })().map((item) => (
            <div key={item.label} className="card" style={{ '--tone': item.tone } as CSSProperties}>
              <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>
                {item.label}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 30,
                  fontWeight: 900,
                  letterSpacing: '-0.05em',
                  color: item.tone,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
            gap: 16,
          }}
        >
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Today 的下一步</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                  只顯示真正會改變你下一步的更新
                </div>
              </div>
              <Link href={`/announcements${q}`} className="btn">
                全部查看
              </Link>
            </div>

            {announcements.map((announcement, index) => (
              <div
                key={announcement.id}
                style={{
                  padding: 16,
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: index === 0 ? 'var(--accent-soft)' : 'var(--surface)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{announcement.title}</div>
                  <span className={`pill ${index === 0 ? 'warning' : 'subtle'}`}>
                    {index === 0 ? '先看' : '更新'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginTop: 8 }}>
                  {announcement.body.slice(0, 110)}...
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>課程骨架</div>
              <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
                教材、作業、測驗、點名與成績應該回到同一條課程主流程，而不是散在各頁。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span className="pill brand">教材</span>
                <span className="pill">作業</span>
                <span className="pill">測驗</span>
                <span className="pill">點名</span>
              </div>
              <Link href={`/groups${q}`} className="btn" style={{ marginTop: 16 }}>
                打開課程
              </Link>
            </div>

            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>校園情境</div>
              <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
                地圖、公車、餐廳與圖書館留在校園分頁，避免高頻課務被生活資訊打斷。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <Link href={`/map${q}`} className="btn">
                  地圖
                </Link>
                <Link href={`/cafeteria${q}`} className="btn">
                  餐廳
                </Link>
                <Link href={`/bus${q}`} className="btn">
                  公車
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
