'use client';

import { SiteShell } from '@/components/SiteShell';
import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getAuth, fetchUserCourses, isFirebaseConfigured, type UserCourse } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { DEMO_COURSES } from '@/lib/demoData';
import { useDemoRole } from '@/lib/demoRole';
import { getStudentContextSummary } from '@/lib/aiContext';

type ViewMode = 'week' | 'day' | 'list';

interface CourseSlot {
  id: string;
  name: string;
  instructor: string;
  room: string;
  dayOfWeek: number; // 1=Mon … 5=Fri
  startPeriod: number;
  endPeriod: number;
  color: string;
  credits: number;
}

const PERIODS = [
  { period: 1, start: '08:10', end: '09:00' },
  { period: 2, start: '09:10', end: '10:00' },
  { period: 3, start: '10:10', end: '11:00' },
  { period: 4, start: '11:10', end: '12:00' },
  { period: 5, start: '13:10', end: '14:00' },
  { period: 6, start: '14:10', end: '15:00' },
  { period: 7, start: '15:10', end: '16:00' },
  { period: 8, start: '16:10', end: '17:00' },
  { period: 9, start: '17:10', end: '18:00' },
  { period: 10, start: '18:30', end: '19:20' },
  { period: 11, start: '19:30', end: '20:20' },
  { period: 12, start: '20:30', end: '21:20' },
];

// 從 demoData 衍生課表，保持單一資料源（DEMO_COURSES 是 canonical）
const MOCK_COURSES: CourseSlot[] = DEMO_COURSES.map((c) => ({
  id: c.id,
  name: c.name,
  instructor: c.instructor,
  room: c.room,
  dayOfWeek: c.dayOfWeek,
  startPeriod: c.startPeriod,
  endPeriod: c.endPeriod,
  color: c.color,
  credits: c.credits,
}));

const DAYS = ['一', '二', '三', '四', '五'];
const COURSE_COLORS = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#007AFF',
  '#FF3B30',
  '#BF5AF2',
  '#32ADE6',
  '#FF6B35',
];

function generateSemesters(): string[] {
  const now = new Date();
  const year = now.getFullYear() - 1911;
  const month = now.getMonth() + 1;
  const currentSem = month >= 2 && month <= 7 ? 2 : 1;
  const sems: string[] = [];
  let y = year;
  let s = currentSem;
  for (let i = 0; i < 4; i++) {
    sems.push(`${y}-${s}`);
    s--;
    if (s < 1) {
      s = 2;
      y--;
    }
  }
  return sems;
}

function mapUserCourse(c: UserCourse, idx: number): CourseSlot {
  return {
    id: c.id,
    name: c.name,
    instructor: c.instructor ?? '—',
    room: c.room ?? '—',
    dayOfWeek: c.dayOfWeek,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    color: c.color ?? COURSE_COLORS[idx % COURSE_COLORS.length],
    credits: c.credits,
  };
}

const SEMESTERS = generateSemesters();

const PERIOD_ROW_HEIGHT = 64;

function getNowLineTopPx(now: Date): number | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < PERIODS.length; i++) {
    const [sh, sm] = PERIODS[i].start.split(':').map(Number);
    const [eh, em] = PERIODS[i].end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (nowMin >= startMin && nowMin <= endMin) {
      const fraction = (nowMin - startMin) / (endMin - startMin);
      return i * PERIOD_ROW_HEIGHT + fraction * PERIOD_ROW_HEIGHT;
    }

    if (i < PERIODS.length - 1) {
      const [nsh, nsm] = PERIODS[i + 1].start.split(':').map(Number);
      const nextStartMin = nsh * 60 + nsm;
      if (nowMin > endMin && nowMin < nextStartMin) {
        return (i + 0.97) * PERIOD_ROW_HEIGHT;
      }
    }
  }
  return null;
}

export default function TimetablePage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const isRestrictedRole = demoRole === 'alumni' || demoRole === 'guest';
  const isTeacherView = demoRole === 'teacher' || demoRole === 'ta';
  const isDeptHead = demoRole === 'department_head';
  const isClubOfficer = demoRole === 'club_officer';
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [selectedDay, setSelectedDay] = useState<number>(
    Math.min(Math.max(new Date().getDay() || 5, 1), 5),
  );
  const [selectedSemester, setSelectedSemester] = useState(SEMESTERS[0]);
  const [user, setUser] = useState<User | null>(null);
  // 教師 / TA：只看「我授課的課」（demo 中為 c1）
  const baseCourses = useMemo(
    () => (isTeacherView ? MOCK_COURSES.filter((c) => c.id === 'c1') : MOCK_COURSES),
    [isTeacherView],
  );
  const [courses, setCourses] = useState<CourseSlot[]>(baseCourses);
  const [usingDemo, setUsingDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // 每分鐘更新當前時間以重繪時間軸
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // 監聽 Firebase Auth
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 依學期載入課程
  useEffect(() => {
    if (!user || !isFirebaseConfigured()) {
      setCourses(baseCourses);
      setUsingDemo(true);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const fbCourses = await fetchUserCourses(user!.uid, selectedSemester);
        if (!active) return;
        if (fbCourses.length > 0) {
          setCourses(fbCourses.map(mapUserCourse));
          setUsingDemo(false);
        } else {
          setCourses(baseCourses);
          setUsingDemo(true);
        }
      } catch {
        if (active) {
          setCourses(baseCourses);
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
  }, [user, selectedSemester, baseCourses]);

  const totalCredits = useMemo(() => courses.reduce((acc, c) => acc + c.credits, 0), [courses]);
  const aiCtx = useMemo(() => (demoRole === 'student' || demoRole === 'club_officer' ? getStudentContextSummary() : null), [demoRole]);

  const todayCourses = useMemo(
    () =>
      courses
        .filter((c) => c.dayOfWeek === selectedDay)
        .sort((a, b) => a.startPeriod - b.startPeriod),
    [courses, selectedDay],
  );

  const nextCourse = useMemo(() => {
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 7 : now.getDay();
    const todayHm = now.getHours() * 100 + now.getMinutes();
    return courses.find((c) => {
      if (c.dayOfWeek !== todayDow) return false;
      const p = PERIODS.find((p) => p.period === c.startPeriod);
      if (!p) return false;
      const [h, m] = p.start.split(':').map(Number);
      return h * 100 + m > todayHm;
    });
  }, [courses]);

  const coursesByDay = useMemo(() => {
    const map: Record<number, CourseSlot[]> = {};
    for (let d = 1; d <= 5; d++) {
      map[d] = courses
        .filter((c) => c.dayOfWeek === d)
        .sort((a, b) => a.startPeriod - b.startPeriod);
    }
    return map;
  }, [courses]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cardStyle = (color: string): CSSProperties => ({
    background: `${color}14`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    marginBottom: 6,
  });

  // ── 系主任：全系課程總覽（非個人課表）──
  if (isDeptHead) {
    return (
      <SiteShell title="全系課程總覽" subtitle="本學期開設課程一覽" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{ padding: '14px 16px', background: 'rgba(255,149,0,0.10)', border: '1px solid rgba(255,149,0,0.30)', fontSize: 13 }}
          >
            🏛️ <strong>系主任視角</strong> · 以下顯示本學期全系所有開設課程，非個人修課課表。
          </div>
          <div className="metricGrid">
            <div className="metricCard" style={{ '--tone': '#FF9500' } as CSSProperties}>
              <div className="metricIcon">📚</div>
              <div className="metricValue">{DEMO_COURSES.length + 8}</div>
              <div className="metricLabel">本學期開設課程</div>
            </div>
            <div className="metricCard" style={{ '--tone': '#007AFF' } as CSSProperties}>
              <div className="metricIcon">🧑‍🏫</div>
              <div className="metricValue">19</div>
              <div className="metricLabel">授課教師</div>
            </div>
            <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
              <div className="metricIcon">👥</div>
              <div className="metricValue">312</div>
              <div className="metricLabel">修課學生數</div>
            </div>
            <div className="metricCard" style={{ '--tone': '#34C759' } as CSSProperties}>
              <div className="metricIcon">🎓</div>
              <div className="metricValue">96</div>
              <div className="metricLabel">總開課學分</div>
            </div>
          </div>
          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">📋 課程一覽</h2>
              <Link
                href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('列出本學期選課人數最多和最少的課程並分析師資分配')}`}
                className="btn"
                style={{ fontSize: 12 }}
              >
                AI 分析 →
              </Link>
            </div>
            <div className="insetGroup">
              {DEMO_COURSES.map((c, i) => (
                <div key={c.id} className="insetGroupRow" style={{ borderTop: i === 0 ? 'none' : undefined }}>
                  <div
                    className="insetGroupRowIcon"
                    style={{ background: `${c.color}14`, color: c.color, fontSize: 18 }}
                  >
                    {c.icon}
                  </div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{c.name}</div>
                    <div className="insetGroupRowMeta">
                      {c.instructor} · {c.members} 位學生 ·{' '}
                      週{['', '一', '二', '三', '四', '五'][c.dayOfWeek]} 第{c.startPeriod}–{c.endPeriod}節 · {c.room}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: c.color, fontWeight: 700, flexShrink: 0 }}>
                    {c.credits} 學分
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Link href={`/admin${q}`} className="btn" style={{ alignSelf: 'flex-start' }}>
            ← 回行政後台
          </Link>
        </div>
      </SiteShell>
    );
  }

  // ── 校友 / 訪客：課表為個人資料，無法查看 ──
  if (isRestrictedRole) {
    return (
      <SiteShell title="課表" subtitle="課表屬個人修課資料" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: demoRole === 'alumni' ? 'rgba(142,142,147,0.10)' : 'rgba(0,122,255,0.08)',
              border: `1px solid ${demoRole === 'alumni' ? '#8E8E93' : '#007AFF'}`,
              fontSize: 13,
            }}
          >
            {demoRole === 'alumni' ? '🎓' : '👀'}{' '}
            <strong>{demoRole === 'alumni' ? '校友身份' : '訪客身份'}</strong>
            {' '}· 課表屬於個人選課資料，{demoRole === 'alumni' ? '校友' : '訪客'}無法查看在校學生課表。
          </div>
          <div className="emptyState">
            <div className="emptyIcon">{demoRole === 'alumni' ? '🎓' : '🔒'}</div>
            <h3 className="emptyTitle">無法查看個人課表</h3>
            <p className="emptyBody">
              {demoRole === 'alumni'
                ? '你已畢業，無個人修課課表。如需查看在校期間的歷史成績，請前往成績頁面。'
                : '訪客身份無法查看個人課表。請登入以使用完整功能。'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
              {demoRole === 'alumni'
                ? <Link href={`/grades${q}`} className="btn primary">查看歷史成績</Link>
                : <Link href={`/login${q}`} className="btn primary">登入</Link>}
              <Link href={`/${q}`} className="btn">← 回首頁</Link>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  // ── 系統管理員：不適用個人課表 ──
  if (demoRole === 'admin') {
    return (
      <SiteShell title="課表" subtitle="系統管理員不適用個人課表" schoolName={schoolName}>
        <div className="pageStack">
          <div className="emptyState">
            <div className="emptyIcon">🛡️</div>
            <h3 className="emptyTitle">系統管理員不適用個人課表</h3>
            <p className="emptyBody">
              系統管理員不是在校修課身份，無個人課表。如需查看全系課程，請前往管理後台或系主任視角。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
              <Link href={`/admin${q}`} className="btn primary">前往管理後台</Link>
              <Link href={`/${q}`} className="btn">← 回首頁</Link>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="課表"
      subtitle={`${selectedSemester} 學期課程安排`}
      schoolName={schoolName}
      schoolCode={selectedSemester}
    >
      <div className="pageStack">
        {/* 教師 / TA：顯示「我授課」 banner */}
        {isTeacherView && (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: demoRole === 'ta' ? 'rgba(124,58,237,0.10)' : 'rgba(15,139,141,0.10)',
              border: `1px solid ${demoRole === 'ta' ? '#7C3AED' : '#007AFF'}`,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1 }}>
              {demoRole === 'ta' ? '🧑‍💻' : '🧑‍🏫'}{' '}
              <strong>{demoRole === 'ta' ? '助教課表' : '教師課表'}</strong>
              {' '}· 顯示你{demoRole === 'ta' ? '助教' : '授課'}的 {courses.length} 門課，
              不是個人修課。要切回學生視角請從右上角身份膠囊。
            </div>
            <Link
              href={`/teacher/course/c1${q}`}
              className="btn primary"
              style={{ fontSize: 12 }}
            >
              進入教師工作台
            </Link>
          </div>
        )}

        {/* 社團幹部：顯示「兼修課學生」提示 */}
        {isClubOfficer && (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: 'rgba(251,191,36,0.10)',
              border: '1px solid #F59E0B',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1 }}>
              🎪 <strong>社團幹部視角</strong> · 你同時是資工系大三學生，以下顯示你個人修課課表。
              社課時間請前往{' '}
              <Link href={`/clubs${q}`} style={{ color: '#D97706', fontWeight: 600 }}>社團管理</Link>
              {' '}查看。
            </div>
          </div>
        )}

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
            ⚠️ 目前顯示示範資料。{!user ? '請登入帳號' : '本學期尚無課表記錄'}以查看實際課表。
            {loading && ' 載入中...'}
          </div>
        )}

        {/* ── AI 今日提醒（學生 / 社團幹部）── */}
        {(demoRole === 'student' || demoRole === 'club_officer') && aiCtx && (aiCtx.pendingAssignmentCount > 0 || aiCtx.libraryDueSoonDays <= 3) && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(0,122,255,0.10) 0%, rgba(90,200,250,0.08) 100%)',
              border: '1px solid rgba(0,122,255,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 4 }}>
                🤖 AI 今日提醒
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                {aiCtx.pendingAssignmentCount > 0 && aiCtx.soonestAssignment && (
                  <span>
                    📝 有 <strong>{aiCtx.pendingAssignmentCount} 份作業</strong>待繳，最緊急：
                    【{aiCtx.soonestAssignment.courseName}】{aiCtx.soonestAssignment.title}，截止 {aiCtx.soonestAssignment.due}
                    {aiCtx.libraryDueSoonDays <= 3 && <span>　・　📚 《{aiCtx.libraryDueSoonBook}》還有 <strong>{aiCtx.libraryDueSoonDays} 天</strong>到期</span>}
                  </span>
                )}
                {aiCtx.pendingAssignmentCount === 0 && aiCtx.libraryDueSoonDays <= 3 && (
                  <span>📚 《{aiCtx.libraryDueSoonBook}》還有 <strong>{aiCtx.libraryDueSoonDays} 天</strong>到期，記得歸還或續借！</span>
                )}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('我今天有什麼作業要繳？有沒有考試快到了？')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── 教師 AI 提示 ── */}
        {(demoRole === 'teacher' || demoRole === 'ta') && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(15,139,141,0.10) 0%, rgba(0,200,200,0.06) 100%)',
              border: '1px solid rgba(15,139,141,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#007AFF', marginBottom: 4 }}>
                🤖 AI 課程助理
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                資料結構（CS301）本週有 <strong>5 份作業</strong>待批改，班級今日出席率上週平均 <strong>92%</strong>
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('請分析資料結構班上本週的出席與作業繳交狀況')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── Top Metrics ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{courses.length}</div>
            <div className="metricLabel">本學期課程</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#34C759' } as CSSProperties}>
            <div className="metricIcon">🎓</div>
            <div className="metricValue">{totalCredits}</div>
            <div className="metricLabel">修習學分</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#FF9500' } as CSSProperties}>
            <div className="metricIcon">📅</div>
            <div className="metricValue">{todayCourses.length}</div>
            <div className="metricLabel">今日課程</div>
          </div>
          {nextCourse ? (
            <div className="metricCard" style={{ '--tone': nextCourse.color } as CSSProperties}>
              <div className="metricIcon">⏰</div>
              <div className="metricValue" style={{ fontSize: 18 }}>
                {PERIODS.find((p) => p.period === nextCourse.startPeriod)?.start ?? '--'}
              </div>
              <div className="metricLabel">下一堂</div>
            </div>
          ) : (
            <div className="metricCard" style={{ '--tone': '#34C759' } as CSSProperties}>
              <div className="metricIcon">✅</div>
              <div className="metricValue" style={{ fontSize: 18 }}>
                今日結束
              </div>
              <div className="metricLabel">課程狀態</div>
            </div>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <div className="segmentedGroup">
              {(['week', 'day', 'list'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  className={viewMode === m ? 'active' : ''}
                  onClick={() => setViewMode(m)}
                >
                  {m === 'week' ? '📅 週視圖' : m === 'day' ? '📋 日視圖' : '📝 列表'}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbarActions">
            <select
              className="input"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              style={{ minHeight: 40, width: 'auto', fontSize: 13 }}
            >
              {SEMESTERS.map((s) => (
                <option key={s} value={s}>
                  {s} 學期
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Day Selector (for day view) ── */}
        {viewMode === 'day' && (
          <div className="card" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {DAYS.map((d, i) => {
                const dow = i + 1;
                const isToday = dow === (new Date().getDay() === 0 ? 7 : new Date().getDay());
                return (
                  <button
                    key={d}
                    onClick={() => setSelectedDay(dow)}
                    style={{
                      flex: 1,
                      padding: '10px 4px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid',
                      borderColor: selectedDay === dow ? 'var(--brand)' : 'var(--border)',
                      background: selectedDay === dow ? 'var(--accent-soft)' : 'var(--surface)',
                      color:
                        selectedDay === dow
                          ? 'var(--brand)'
                          : isToday
                            ? 'var(--brand)'
                            : 'var(--muted)',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: selectedDay === dow ? 'var(--shadow-sm)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Week View ── */}
        {viewMode === 'week' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Scrollable container for mobile */}
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as 'auto', minWidth: 0 }}>
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '56px repeat(5, minmax(80px, 1fr))',
                minWidth: 480,
                borderBottom: '1px solid var(--border)',
                background: 'var(--panel)',
              }}
            >
              <div style={{ padding: '12px 8px', textAlign: 'center' }} />
              {DAYS.map((d, i) => {
                const dow = i + 1;
                const isToday = dow === (new Date().getDay() === 0 ? 7 : new Date().getDay());
                return (
                  <div
                    key={d}
                    style={{
                      padding: '12px 8px',
                      textAlign: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      color: isToday ? 'var(--brand)' : 'var(--muted)',
                      borderLeft: '1px solid var(--border)',
                    }}
                  >
                    <div>週{d}</div>
                    {isToday && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--brand)',
                          margin: '4px auto 0',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Period rows with now-line overlay */}
            {(() => {
              const nowDow = now.getDay() === 0 ? 7 : now.getDay();
              const isThisWeek = nowDow >= 1 && nowDow <= 5;
              const nowTopPx = isThisWeek ? getNowLineTopPx(now) : null;
              const nowTimeStr = now.toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });

              return (
                <div style={{ position: 'relative' }}>
                  {PERIODS.map((p) => (
                    <div
                      key={p.period}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px repeat(5, minmax(80px, 1fr))',
                        minWidth: 480,
                        minHeight: PERIOD_ROW_HEIGHT,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {/* Period label */}
                      <div
                        style={{
                          padding: '8px 4px',
                          textAlign: 'center',
                          borderRight: '1px solid var(--border)',
                          background: 'var(--panel)',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                          {p.period}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted-light)', marginTop: 2 }}>
                          {p.start}
                        </div>
                      </div>

                      {/* Day cells */}
                      {DAYS.map((_, di) => {
                        const dow = di + 1;
                        const course = courses.find(
                          (c) => c.dayOfWeek === dow && c.startPeriod === p.period,
                        );
                        const isNowCol = dow === nowDow;
                        return (
                          <div
                            key={di}
                            style={{
                              borderLeft: '1px solid var(--border)',
                              padding: '4px',
                              position: 'relative',
                              background:
                                isNowCol && isThisWeek ? 'rgba(0,122,255,0.03)' : undefined,
                            }}
                          >
                            {course && (
                              <Link
                                href={`${isTeacherView ? '/teacher' : ''}/course/${course.id}${q}`}
                                style={{
                                  background: `${course.color}12`,
                                  borderLeft: `3px solid ${course.color}`,
                                  borderRadius: 'var(--radius-xs)',
                                  padding: '6px 8px',
                                  height: '100%',
                                  display: 'block',
                                  textDecoration: 'none',
                                  color: 'inherit',
                                  cursor: 'pointer',
                                }}
                                title={`${course.name} · ${course.instructor} · ${course.room}`}
                              >
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: course.color,
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {course.name}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                  {course.room}
                                </div>
                              </Link>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Current time red line */}
                  {nowTopPx !== null && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: nowTopPx,
                        height: 2,
                        background: 'var(--danger, #FF3B30)',
                        zIndex: 10,
                        pointerEvents: 'none',
                      }}
                    >
                      {/* Circle dot at start */}
                      <div
                        style={{
                          position: 'absolute',
                          left: 48,
                          top: -4,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: 'var(--danger, #FF3B30)',
                        }}
                      />
                      {/* Time label */}
                      <div
                        style={{
                          position: 'absolute',
                          left: 2,
                          top: -9,
                          fontSize: 9,
                          fontWeight: 800,
                          color: 'var(--danger, #FF3B30)',
                          letterSpacing: '0.02em',
                          lineHeight: 1,
                          background: 'var(--bg)',
                          paddingRight: 2,
                        }}
                      >
                        {nowTimeStr}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            </div>{/* end scroll wrapper */}
          </div>
        )}

        {/* ── Day View ── */}
        {viewMode === 'day' && (
          <div>
            {todayCourses.length === 0 ? (
              <div className="emptyState">
                <div className="emptyIcon">🏖</div>
                <h3 className="emptyTitle">今天沒有課程</h3>
                <p className="emptyBody">享受你的空閒時間吧！</p>
              </div>
            ) : (
              <div className="pageStack">
                {todayCourses.map((c) => {
                  const startP = PERIODS.find((p) => p.period === c.startPeriod);
                  const endP = PERIODS.find((p) => p.period === c.endPeriod);
                  return (
                    <Link
                      key={c.id}
                      href={`${isTeacherView ? '/teacher' : ''}/course/${c.id}${q}`}
                      className="card"
                      style={{
                        borderLeft: `4px solid ${c.color}`,
                        padding: '18px 20px',
                        textDecoration: 'none',
                        color: 'inherit',
                        display: 'block',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: c.color,
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              marginBottom: 4,
                            }}
                          >
                            第 {c.startPeriod}–{c.endPeriod} 節 · {startP?.start}–{endP?.end}
                          </div>
                          <h3
                            style={{
                              margin: '0 0 4px',
                              fontSize: 17,
                              fontWeight: 700,
                              letterSpacing: '-0.03em',
                            }}
                          >
                            {c.name}
                          </h3>
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                            {c.instructor} · {c.room}
                          </div>
                        </div>
                        <span
                          className="pill"
                          style={{
                            background: `${c.color}12`,
                            color: c.color,
                            borderColor: `${c.color}20`,
                          }}
                        >
                          {c.credits} 學分
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── List View ── */}
        {viewMode === 'list' && (
          <div className="pageStack">
            {DAYS.map((d, di) => {
              const dow = di + 1;
              const dayCourses = coursesByDay[dow];
              if (!dayCourses || dayCourses.length === 0) return null;
              return (
                <div key={d} className="sectionCard">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 12,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        fontWeight: 600,
                      }}
                    >
                      星期{d}
                    </h3>
                    <div
                      style={{
                        flex: 1,
                        height: 1,
                        background: 'var(--border)',
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{dayCourses.length} 堂</span>
                  </div>
                  <div className="insetGroup">
                    {dayCourses.map((c, ci) => {
                      const startP = PERIODS.find((p) => p.period === c.startPeriod);
                      const endP = PERIODS.find((p) => p.period === c.endPeriod);
                      return (
                        <Link
                          key={c.id}
                          href={`${isTeacherView ? '/teacher' : ''}/course/${c.id}${q}`}
                          className="insetGroupRow"
                          style={{
                            borderTop: ci === 0 ? 'none' : undefined,
                            color: 'inherit',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <div
                            className="insetGroupRowIcon"
                            style={{ background: `${c.color}14`, fontSize: 18 }}
                          >
                            📖
                          </div>
                          <div className="insetGroupRowContent">
                            <div className="insetGroupRowTitle">{c.name}</div>
                            <div className="insetGroupRowMeta">
                              {startP?.start}–{endP?.end} · {c.room} · {c.instructor}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: c.color,
                            }}
                          >
                            {c.credits}學分
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Summary */}
            <div className="card">
              <div
                style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: 12 }}
              >
                學分統計
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 24,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color: 'var(--brand)',
                      letterSpacing: '-0.05em',
                    }}
                  >
                    {totalCredits}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>總學分</div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color: '#34C759',
                      letterSpacing: '-0.05em',
                    }}
                  >
                    {courses.length}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>門課程</div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color: '#FF9500',
                      letterSpacing: '-0.05em',
                    }}
                  >
                    5
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>授課天數</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
