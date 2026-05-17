'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import {
  getStudentContextSummary,
  getTeacherContextSummary,
  getClubOfficerContextSummary,
  getDeptHeadContextSummary,
  getAdminContextSummary,
} from '@/lib/aiContext';
import {
  DEMO_ANNOUNCEMENTS,
  DEMO_COURSES,
  readPendingAnns,
} from '@/lib/demoData';
import { useDemoStore, getUnreadCountDynamic } from '@/lib/demoStore';

function formatGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '早安';
  if (hour < 18) return '午安';
  return '晚上好';
}

/** 計算今日（或最近一個上課日）的課程 */
function getTodayCourses(): { count: number; label: string; courses: typeof DEMO_COURSES } {
  const dow = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat
  // 對應 DEMO_COURSES dayOfWeek（1=Mon..5=Fri）
  if (dow >= 1 && dow <= 5) {
    const todayCourses = DEMO_COURSES.filter((c) => c.dayOfWeek === dow);
    const dayNames = ['', '週一', '週二', '週三', '週四', '週五'];
    return { count: todayCourses.length, label: `今日（${dayNames[dow]}）${todayCourses.length} 堂課`, courses: todayCourses };
  }
  // 週末：顯示下週一
  const monCourses = DEMO_COURSES.filter((c) => c.dayOfWeek === 1);
  return { count: monCourses.length, label: `週末無課・下週一 ${monCourses.length} 堂`, courses: monCourses };
}

export default function HomePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const {
    schoolCode,
    schoolName,
    schoolSearch: q,
  } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const demoRoleDef = getDemoRoleDefinition(demoRole);
  const isAlumniOrGuest = demoRole === 'alumni' || demoRole === 'guest';
  const store = useDemoStore();

  // 動態未讀數
  const msgUnread = useMemo(() => getUnreadCountDynamic(demoRole, store), [demoRole, store]);

  // 待審公告（系主任 / 管理員）：訂閱 demoPendingAnnChange 即時更新
  const [pendingAnnTick, setPendingAnnTick] = useState(0);
  const [pendingAnns, setPendingAnns] = useState<ReturnType<typeof readPendingAnns>>([]);
  useEffect(() => {
    const refresh = () => {
      setPendingAnns(readPendingAnns());
      setPendingAnnTick((n) => n + 1);
    };
    refresh();
    window.addEventListener('demoPendingAnnChange', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('demoPendingAnnChange', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // 今日課程
  const todayCourseInfo = useMemo(() => getTodayCourses(), []);

  // 公告：直接使用 DEMO_ANNOUNCEMENTS（統一資料源，含 relatedCourseId）
  const topAnnouncements = useMemo(() => DEMO_ANNOUNCEMENTS.slice(0, 4), []);

  // AI context（各角色）
  const aiCtx = useMemo(
    () => (demoRole === 'student' ? getStudentContextSummary() : null),
    [demoRole],
  );
  const teacherCtx = useMemo(
    () => (demoRole === 'teacher' || demoRole === 'ta' ? getTeacherContextSummary() : null),
    [demoRole],
  );
  const clubCtx = useMemo(
    () => (demoRole === 'club_officer' ? getClubOfficerContextSummary() : null),
    [demoRole],
  );
  const deptCtx = useMemo(
    () => (demoRole === 'department_head' ? getDeptHeadContextSummary() : null),
    // pendingAnnTick 觸發重新讀 readPendingAnns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoRole, pendingAnnTick],
  );
  const adminCtx = useMemo(
    () => (demoRole === 'admin' ? getAdminContextSummary() : null),
    [demoRole],
  );

  // ── Hero 設定（每個角色不同）──
  const heroConfig = (() => {
    switch (demoRole) {
      case 'teacher':
        return {
          eyebrow: 'Teaching Dashboard',
          headline: `今日${todayCourseInfo.count > 0 ? ` ${todayCourseInfo.count} 堂課` : '無課'} · ${teacherCtx?.totalPending ?? 5} 份待批改`,
          sub: '資料結構 CS301 09:10–10:50 工程館 302 · 助教林助教本週可協助批改',
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
          sub: '資料結構（林助教）· 本週辦公室時間 Wed 14:00–15:30 工程館 308',
          buttons: [
            { href: `/teacher/course/c1${q}`, label: '⚡ 進入助教台', primary: true },
            { href: `/grades${q}`, label: '成績列表' },
            { href: `/messages${q}`, label: `📬 訊息${msgUnread > 0 ? `（${msgUnread}）` : ''}` },
          ],
          badge: '林助教',
        };
      case 'club_officer':
        return {
          eyebrow: 'Club Dashboard',
          headline: `${clubCtx?.clubName ?? '程式設計社'} · ${clubCtx?.pendingMemberRequests ?? 3} 筆申請待審`,
          sub: `${clubCtx?.memberCount ?? 120} 位成員 · 黑客松 5/23（六）09:00 · 工程館 B101`,
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
          headline: `${pendingAnns.length} 則公告待審核 · 全系 ${deptCtx?.studentCount ?? 312} 位學生`,
          sub: `資訊管理系 · 本學期開設 ${DEMO_COURSES.length} 門課 · ${deptCtx?.teacherCount ?? 19} 位教師`,
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
          headline: `系統${adminCtx?.systemOk ? '正常' : '異常'} · 今日 ${adminCtx?.securityEventCount ?? 1} 件安全事件`,
          sub: `${adminCtx?.activeUsers ?? 89} 位活躍使用者 · API 回應正常 · 最近備份今日 03:00`,
          buttons: [
            { href: `/admin${q}`, label: '⚡ 系統後台', primary: true },
            { href: `/ai-assistant${q}`, label: 'AI 安全分析' },
            { href: `/messages${q}`, label: `📬 訊息${msgUnread > 0 ? `（${msgUnread}）` : ''}` },
          ],
          badge: adminCtx?.hasSecurity ? '⚠️ 注意安全警示' : '✅ 系統正常',
        };
      case 'alumni':
        return {
          eyebrow: 'Alumni Portal',
          headline: '歡迎回來，張學長 · 已畢業 3 年',
          sub: '資訊管理系 109 屆 · 128 學分 · GPA 3.65 · 校友服務與母校資訊都在這裡',
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
          headline: `${todayCourseInfo.label} · ${aiCtx?.pendingAssignmentCount ?? 4} 份作業待繳`,
          sub: todayCourseInfo.courses.slice(0, 3).map((c) => `${c.name} 第${c.startPeriod}節`).join(' · ') || '今日無課，把握時間複習！',
          buttons: [
            { href: `/timetable${q}`, label: '📅 查看課表', primary: true },
            { href: `/grades${q}`, label: '我的成績' },
            { href: `/ai-assistant${q}`, label: '問 AI' },
          ],
          badge: `${topAnnouncements.length} 則今日更新`,
        };
    }
  })();

  const importantCount = topAnnouncements.filter((a) => a.pinned || a.title.includes('重要')).length;

  // ── 統計卡片（可點擊跳轉）──
  const statCards = (() => {
    const annCard = {
      label: '重要公告',
      value: importantCount || topAnnouncements.length,
      tone: 'var(--warning)',
      href: `/announcements${q}`,
    };
    const msgCard = {
      label: '未讀訊息',
      value: msgUnread > 0 ? msgUnread : 0,
      tone: msgUnread > 0 ? '#FF3B30' : 'var(--muted)',
      href: `/messages${q}`,
    };
    const gpaCard = {
      label: '累計 GPA',
      value: '3.63',
      tone: 'var(--brand)',
      href: `/grades${q}`,
    };
    const courseCard = {
      label: '授課課程',
      value: '1 門 · 48 位學生',
      tone: 'var(--brand)',
      href: `/teacher/course/c1${q}`,
    };
    const taCard = {
      label: '助教課程',
      value: `1 門 · ${teacherCtx?.totalPending ?? 5} 件待批`,
      tone: '#7C3AED',
      href: `/teacher/course/c1${q}`,
    };
    const clubCard = {
      label: '社團成員',
      value: `${clubCtx?.memberCount ?? 120} 人`,
      tone: '#34C759',
      href: `/clubs${q}`,
    };
    const pendingAnnCard = {
      label: '待審公告',
      value: `${pendingAnns.length} 件`,
      tone: pendingAnns.length > 0 ? '#FF9500' : '#34C759',
      href: `/admin${q}`,
    };
    const systemCard = {
      label: '系統狀態',
      value: adminCtx?.hasSecurity ? '⚠️ 安全警示' : '✅ 正常',
      tone: adminCtx?.hasSecurity ? '#FF3B30' : 'var(--success)',
      href: `/admin${q}`,
    };

    switch (demoRole) {
      case 'teacher': return [annCard, courseCard, msgCard];
      case 'ta': return [annCard, taCard, msgCard];
      case 'club_officer': return [annCard, clubCard, msgCard];
      case 'department_head': return [pendingAnnCard, annCard, msgCard];
      case 'admin': return [systemCard, pendingAnnCard, msgCard];
      case 'alumni':
      case 'guest': return [annCard, msgCard];
      case 'student':
      default: return [annCard, gpaCard, msgCard];
    }
  })();

  // ── 訪客首頁 ──
  if (demoRole === 'guest') {
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
                從 Today 開始，依序進入課程、校園、收件匣與我的。先降低認知負荷，再疊加信任感與黏著感。
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
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--info)' }}>
              👋 第一次到訪？
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text)' }}>
              這是「校園整合應用」畢業專題的 demo。我們把 <strong>8 種角色</strong>（學生、教師、TA、社團幹部、系主任、管理員、校友、訪客）都建立了示範流程，
              你可以從 <Link href={`/login${q}`}>登入頁</Link> 任選一個身份進入，或從右上角「身份膠囊」一鍵切換。
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/login${q}`} className="btn primary" style={{ fontSize: 13 }}>👩‍🎓 從學生身份開始</Link>
              <Link href={`/admin${q}`} className="btn" style={{ fontSize: 13 }}>🏛️ 看管理員後台</Link>
              <Link href={`/teacher/course/c1${q}`} className="btn" style={{ fontSize: 13 }}>🧑‍🏫 看教師端</Link>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { title: 'Today', desc: '先看今天最重要的一步，而不是先看功能表。', accent: 'var(--brand)' },
              { title: '課程', desc: '把教材、作業、測驗、點名與成績收回同一條課程主流程。', accent: 'var(--info)' },
              { title: '校園', desc: '地圖、公車、餐廳與支援服務留在校園，不打斷主學習流程。', accent: 'var(--achievement)' },
              { title: '收件匣', desc: '每筆更新都直接對應到下一步，而不是只顯示通知。', accent: 'var(--warning)' },
            ].map((card) => (
              <div key={card.title} className="card">
                <div style={{ width: 42, height: 42, borderRadius: 16, background: `${card.accent}20`, marginBottom: 14 }} />
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{card.title}</div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: 14 }}>{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={schoolName}
      schoolCode={schoolCode}
      title={`${formatGreeting()}，${demoRoleDef.shortLabel}`}
      subtitle={
        isAlumniOrGuest
          ? `${demoRoleDef.label}視角 · 校園資訊瀏覽（read-only）`
          : 'Today 只保留下一步、課程節奏與校園情境。'
      }
    >
      <div className="pageStack">
        {/* Alumni 提示 */}
        {demoRole === 'alumni' && (
          <div className="card" style={{ padding: '12px 16px', background: 'rgba(142,142,147,0.10)', border: '1px solid #8E8E93', fontSize: 13, color: 'var(--text)' }}>
            🎓 <strong>校友身份</strong> · 你可以查看校園公告、活動、地圖等公開資訊，但無法加入社團、借書或選課。如需更多服務請聯絡系所辦公室。
          </div>
        )}

        {/* ── AI Today 提醒（學生）── */}
        {demoRole === 'student' && aiCtx && (aiCtx.pendingAssignmentCount > 0 || aiCtx.libraryDueSoonDays <= 3 || aiCtx.nextExam) && (
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(94,106,210,0.12) 0%, rgba(142,186,255,0.08) 100%)', border: '1px solid rgba(94,106,210,0.28)', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--brand)', marginBottom: 6 }}>🤖 AI 今日提醒</div>
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
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('我今天有什麼重要的事要做？整理一下截止日和考試')}`} className="btn primary" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>
              問 AI 規劃 →
            </Link>
          </div>
        )}

        {/* ── AI 今日提醒（教師）── */}
        {demoRole === 'teacher' && teacherCtx && (
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(0,200,200,0.06) 100%)', border: '1px solid rgba(15,139,141,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F8B8D', marginBottom: 4 }}>🤖 AI 今日提醒</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                資料結構（CS301）有 <strong>{teacherCtx.totalPending} 份作業</strong>待批改，其中 {teacherCtx.pendingCount} 份尚未開始。今日 {todayCourseInfo.count > 0 ? `有 ${todayCourseInfo.count} 堂課` : '無課，可批改作業'}。
              </div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我查一下資料結構今天的點名和待批改作業情況')}`} className="btn" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>問 AI →</Link>
          </div>
        )}

        {/* ── AI 今日提醒（TA）── */}
        {demoRole === 'ta' && teacherCtx && (
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(167,139,250,0.06) 100%)', border: '1px solid rgba(124,58,237,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', marginBottom: 4 }}>🤖 AI 批改助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                資料結構有 <strong>{teacherCtx.totalPending} 份程式作業</strong>待批改，其中 {teacherCtx.pendingCount} 份尚未開始。辦公室時間 Wed 14:00–15:30。
              </div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我列出所有待批改的作業並排序優先順序')}`} className="btn" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>問 AI →</Link>
          </div>
        )}

        {/* ── AI 今日提醒（社團幹部）── */}
        {demoRole === 'club_officer' && clubCtx && (
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)', border: '1px solid rgba(52,199,89,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1F7A2E', marginBottom: 4 }}>🤖 AI 社團助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {clubCtx.clubName} 有 <strong>{clubCtx.pendingMemberRequests} 筆成員申請</strong>待審核。
                {clubCtx.nextActivity ? ` 下次活動：${clubCtx.nextActivity.title}（${clubCtx.nextActivity.date}）。` : ''}
              </div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我寫一份社團招募公告草稿')}`} className="btn" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>問 AI →</Link>
          </div>
        )}

        {/* ── AI 今日提醒（系主任）── */}
        {demoRole === 'department_head' && deptCtx && (
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(255,149,0,0.10) 0%, rgba(255,149,0,0.04) 100%)', border: '1px solid rgba(255,149,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#C17A00', marginBottom: 4 }}>🤖 AI 行政助理</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                有 <strong>{pendingAnns.length} 則公告</strong>待審核發布。全系共 {deptCtx.studentCount} 位學生、{deptCtx.teacherCount} 位教師。
              </div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我查看待審核公告並給出處理建議')}`} className="btn" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>問 AI →</Link>
          </div>
        )}

        {/* ── AI 今日提醒（管理員）── */}
        {demoRole === 'admin' && adminCtx && (
          <div className="card" style={{
            padding: '14px 18px',
            background: adminCtx.hasSecurity
              ? 'linear-gradient(135deg, rgba(255,59,48,0.10) 0%, rgba(255,59,48,0.04) 100%)'
              : 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)',
            border: `1px solid ${adminCtx.hasSecurity ? 'rgba(255,59,48,0.30)' : 'rgba(52,199,89,0.30)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
          }}>
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
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0, ...(adminCtx.hasSecurity ? { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' } : {}) }}
            >
              {adminCtx.hasSecurity ? '⚠️ 立即查看' : '問 AI →'}
            </Link>
          </div>
        )}

        {/* ── Hero 卡片 ── */}
        <div className="card" style={{ background: 'linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(8,145,178,0.08) 100%)', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 760 }}>
              <div className="pageHeadEyebrow" style={{ marginBottom: 10 }}>{heroConfig.eyebrow}</div>
              <h2 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: '-0.05em' }}>{heroConfig.headline}</h2>
              <p className="sub" style={{ marginTop: 10 }}>{heroConfig.sub}</p>
            </div>
            <span className="pill brand">{heroConfig.badge}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {heroConfig.buttons.map((btn) => (
              <Link key={btn.label} href={btn.href} className={btn.primary ? 'btn primary' : 'btn'}>{btn.label}</Link>
            ))}
          </div>
        </div>

        {/* ── 統計卡片（可點擊）── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {statCards.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="card"
              style={{ '--tone': item.tone, textDecoration: 'none', cursor: 'pointer', transition: 'transform 0.15s', display: 'block' } as CSSProperties}
            >
              <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 30, fontWeight: 900, letterSpacing: '-0.05em', color: item.tone }}>
                {item.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>點擊查看詳情 →</div>
            </Link>
          ))}
        </div>

        {/* ── 主要內容：公告 + 右側快捷 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 16 }}>
          {/* 公告列表（可點擊） */}
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Today 的下一步</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>只顯示真正會改變你下一步的更新</div>
              </div>
              <Link href={`/announcements${q}`} className="btn">全部查看</Link>
            </div>

            {topAnnouncements.map((ann, index) => (
              <Link
                key={ann.id}
                href={`/announcements/${ann.id}${q}`}
                style={{
                  display: 'block',
                  padding: 16,
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: index === 0 ? 'var(--accent-soft)' : 'var(--surface)',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{ann.title}</div>
                  <span className={`pill ${index === 0 ? 'warning' : 'subtle'}`}>
                    {ann.pinned ? '置頂' : index === 0 ? '先看' : '更新'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginTop: 8 }}>
                  {ann.body.slice(0, 110)}…
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  {ann.source} · {new Date(ann.publishedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </Link>
            ))}
          </div>

          {/* 右側快捷操作 */}
          <div style={{ display: 'grid', gap: 16 }}>
            {/* 課程骨架 */}
            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>課程總覽</div>
              <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
                教材、作業、測驗、點名與成績在同一條課程主流程內完整串連。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span className="pill brand">教材</span>
                <span className="pill">作業</span>
                <span className="pill">測驗</span>
                <span className="pill">點名</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Link href={`/groups${q}`} className="btn primary" style={{ fontSize: 13 }}>所有課程</Link>
                {(demoRole === 'teacher' || demoRole === 'ta') && (
                  <Link href={`/teacher/course/c1${q}`} className="btn" style={{ fontSize: 13 }}>工作台</Link>
                )}
              </div>
            </div>

            {/* 校園情境 */}
            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>校園服務</div>
              <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7 }}>
                地圖、公車、餐廳與圖書館不打斷主學習流程。
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <Link href={`/map${q}`} className="btn">📍 地圖</Link>
                <Link href={`/cafeteria${q}`} className="btn">🍱 餐廳</Link>
                <Link href={`/bus${q}`} className="btn">🚌 公車</Link>
                <Link href={`/library${q}`} className="btn">📚 圖書館</Link>
              </div>
            </div>

            {/* AI 助理入口 */}
            <div className="card" style={{ background: 'linear-gradient(135deg, rgba(94,106,210,0.10) 0%, rgba(94,106,210,0.04) 100%)', border: '1px solid rgba(94,106,210,0.22)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>🤖 AI 助理</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                詢問課程規劃、查閱作業截止日、讓 AI 起草公告或分析學習報告。
              </div>
              <Link href={`/ai-assistant${q}`} className="btn primary" style={{ fontSize: 13 }}>
                開始對話 →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
