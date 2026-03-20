"use client";

import { SiteShell } from "@/components/SiteShell";
import { useState, useMemo, useEffect, type CSSProperties } from "react";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  getAuth,
  fetchUserCourses,
  isFirebaseConfigured,
  type UserCourse,
} from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

type ViewMode = "week" | "day" | "list";

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
  { period: 1, start: "08:10", end: "09:00" },
  { period: 2, start: "09:10", end: "10:00" },
  { period: 3, start: "10:10", end: "11:00" },
  { period: 4, start: "11:10", end: "12:00" },
  { period: 5, start: "13:10", end: "14:00" },
  { period: 6, start: "14:10", end: "15:00" },
  { period: 7, start: "15:10", end: "16:00" },
  { period: 8, start: "16:10", end: "17:00" },
  { period: 9, start: "17:10", end: "18:00" },
  { period: 10, start: "18:30", end: "19:20" },
  { period: 11, start: "19:30", end: "20:20" },
  { period: 12, start: "20:30", end: "21:20" },
];

const MOCK_COURSES: CourseSlot[] = [
  { id: "c1", name: "資料結構", instructor: "王大明", room: "工程館 302", dayOfWeek: 1, startPeriod: 1, endPeriod: 2, color: "#5E6AD2", credits: 3 },
  { id: "c2", name: "線性代數", instructor: "陳小華", room: "理學院 201", dayOfWeek: 1, startPeriod: 5, endPeriod: 6, color: "#34C759", credits: 3 },
  { id: "c3", name: "作業系統", instructor: "李志明", room: "資工大樓 405", dayOfWeek: 2, startPeriod: 3, endPeriod: 4, color: "#FF9500", credits: 3 },
  { id: "c4", name: "計算機網路", instructor: "張美玲", room: "工程館 105", dayOfWeek: 2, startPeriod: 7, endPeriod: 8, color: "#007AFF", credits: 3 },
  { id: "c5", name: "微積分", instructor: "吳俊傑", room: "理學院 101", dayOfWeek: 3, startPeriod: 1, endPeriod: 3, color: "#FF3B30", credits: 4 },
  { id: "c6", name: "英文寫作", instructor: "Smith, J.", room: "語言中心 202", dayOfWeek: 4, startPeriod: 2, endPeriod: 3, color: "#BF5AF2", credits: 2 },
  { id: "c7", name: "資料庫系統", instructor: "劉建宏", room: "資工大樓 301", dayOfWeek: 4, startPeriod: 6, endPeriod: 7, color: "#32ADE6", credits: 3 },
  { id: "c8", name: "軟體工程", instructor: "林宜珊", room: "工程館 204", dayOfWeek: 5, startPeriod: 4, endPeriod: 5, color: "#FF6B35", credits: 3 },
];

const DAYS = ["一", "二", "三", "四", "五"];
const COURSE_COLORS = ["#5E6AD2", "#34C759", "#FF9500", "#007AFF", "#FF3B30", "#BF5AF2", "#32ADE6", "#FF6B35"];

function generateSemesters(): string[] {
  const now = new Date();
  const year = now.getFullYear() - 1911;
  const month = now.getMonth() + 1;
  const currentSem = month >= 2 && month <= 7 ? 2 : 1;
  const sems: string[] = [];
  let y = year; let s = currentSem;
  for (let i = 0; i < 4; i++) {
    sems.push(`${y}-${s}`);
    s--; if (s < 1) { s = 2; y--; }
  }
  return sems;
}

function mapUserCourse(c: UserCourse, idx: number): CourseSlot {
  return {
    id: c.id,
    name: c.name,
    instructor: c.instructor ?? "—",
    room: c.room ?? "—",
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
    const [sh, sm] = PERIODS[i].start.split(":").map(Number);
    const [eh, em] = PERIODS[i].end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (nowMin >= startMin && nowMin <= endMin) {
      const fraction = (nowMin - startMin) / (endMin - startMin);
      return i * PERIOD_ROW_HEIGHT + fraction * PERIOD_ROW_HEIGHT;
    }

    if (i < PERIODS.length - 1) {
      const [nsh, nsm] = PERIODS[i + 1].start.split(":").map(Number);
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
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDay, setSelectedDay] = useState<number>(
    Math.min(Math.max((new Date().getDay() || 5), 1), 5)
  );
  const [selectedSemester, setSelectedSemester] = useState(SEMESTERS[0]);
  const [user, setUser] = useState<User | null>(null);
  const [courses, setCourses] = useState<CourseSlot[]>(MOCK_COURSES);
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
      setCourses(MOCK_COURSES);
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
          setCourses(MOCK_COURSES);
          setUsingDemo(true);
        }
      } catch {
        if (active) { setCourses(MOCK_COURSES); setUsingDemo(true); }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user, selectedSemester]);

  const totalCredits = useMemo(
    () => courses.reduce((acc, c) => acc + c.credits, 0),
    [courses]
  );

  const todayCourses = useMemo(
    () => courses.filter((c) => c.dayOfWeek === selectedDay).sort((a, b) => a.startPeriod - b.startPeriod),
    [courses, selectedDay]
  );

  const nextCourse = useMemo(() => {
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 7 : now.getDay();
    const todayHm = now.getHours() * 100 + now.getMinutes();
    return courses.find((c) => {
      if (c.dayOfWeek !== todayDow) return false;
      const p = PERIODS.find((p) => p.period === c.startPeriod);
      if (!p) return false;
      const [h, m] = p.start.split(":").map(Number);
      return h * 100 + m > todayHm;
    });
  }, [courses]);

  const coursesByDay = useMemo(() => {
    const map: Record<number, CourseSlot[]> = {};
    for (let d = 1; d <= 5; d++) {
      map[d] = courses.filter((c) => c.dayOfWeek === d).sort((a, b) => a.startPeriod - b.startPeriod);
    }
    return map;
  }, [courses]);

  const cardStyle = (color: string): CSSProperties => ({
    background: `${color}14`,
    borderLeft: `3px solid ${color}`,
    borderRadius: "var(--radius-sm)",
    padding: "10px 12px",
    marginBottom: 6,
  });

  return (
    <SiteShell
      title="課表"
      subtitle={`${selectedSemester} 學期課程安排`}
      schoolName={schoolName}
      schoolCode={selectedSemester}
    >
      <div className="pageStack">
        {usingDemo && (
          <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13, color: "var(--text)" }}>
            ⚠️ 目前顯示示範資料。{!user ? "請登入帳號" : "本學期尚無課表記錄"}以查看實際課表。{loading && " 載入中..."}
          </div>
        )}

        {/* ── Top Metrics ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{courses.length}</div>
            <div className="metricLabel">本學期課程</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#34C759" } as CSSProperties}>
            <div className="metricIcon">🎓</div>
            <div className="metricValue">{totalCredits}</div>
            <div className="metricLabel">修習學分</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#FF9500" } as CSSProperties}>
            <div className="metricIcon">📅</div>
            <div className="metricValue">{todayCourses.length}</div>
            <div className="metricLabel">今日課程</div>
          </div>
          {nextCourse ? (
            <div className="metricCard" style={{ "--tone": nextCourse.color } as CSSProperties}>
              <div className="metricIcon">⏰</div>
              <div className="metricValue" style={{ fontSize: 18 }}>
                {PERIODS.find((p) => p.period === nextCourse.startPeriod)?.start ?? "--"}
              </div>
              <div className="metricLabel">下一堂</div>
            </div>
          ) : (
            <div className="metricCard" style={{ "--tone": "#34C759" } as CSSProperties}>
              <div className="metricIcon">✅</div>
              <div className="metricValue" style={{ fontSize: 18 }}>今日結束</div>
              <div className="metricLabel">課程狀態</div>
            </div>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <div className="segmentedGroup">
              {(["week", "day", "list"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  className={viewMode === m ? "active" : ""}
                  onClick={() => setViewMode(m)}
                >
                  {m === "week" ? "📅 週視圖" : m === "day" ? "📋 日視圖" : "📝 列表"}
                </button>
              ))}
            </div>
          </div>
          <div className="toolbarActions">
            <select
              className="input"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              style={{ minHeight: 40, width: "auto", fontSize: 13 }}
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
        {viewMode === "day" && (
          <div className="card" style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {DAYS.map((d, i) => {
                const dow = i + 1;
                const isToday = dow === (new Date().getDay() === 0 ? 7 : new Date().getDay());
                return (
                  <button
                    key={d}
                    onClick={() => setSelectedDay(dow)}
                    style={{
                      flex: 1,
                      padding: "10px 4px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid",
                      borderColor: selectedDay === dow ? "var(--brand)" : "var(--border)",
                      background: selectedDay === dow ? "var(--accent-soft)" : "var(--surface)",
                      color: selectedDay === dow ? "var(--brand)" : isToday ? "var(--brand)" : "var(--muted)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: selectedDay === dow ? "var(--shadow-sm)" : "none",
                      transition: "all 0.15s ease",
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
        {viewMode === "week" && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "56px repeat(5, 1fr)",
                borderBottom: "1px solid var(--border)",
                background: "var(--panel)",
              }}
            >
              <div style={{ padding: "12px 8px", textAlign: "center" }} />
              {DAYS.map((d, i) => {
                const dow = i + 1;
                const isToday = dow === (new Date().getDay() === 0 ? 7 : new Date().getDay());
                return (
                  <div
                    key={d}
                    style={{
                      padding: "12px 8px",
                      textAlign: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      color: isToday ? "var(--brand)" : "var(--muted)",
                      borderLeft: "1px solid var(--border)",
                    }}
                  >
                    <div>週{d}</div>
                    {isToday && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--brand)",
                          margin: "4px auto 0",
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
              const nowTimeStr = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });

              return (
                <div style={{ position: "relative" }}>
                  {PERIODS.map((p) => (
                    <div
                      key={p.period}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "56px repeat(5, 1fr)",
                        minHeight: PERIOD_ROW_HEIGHT,
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {/* Period label */}
                      <div
                        style={{
                          padding: "8px 4px",
                          textAlign: "center",
                          borderRight: "1px solid var(--border)",
                          background: "var(--panel)",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                          {p.period}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 2 }}>
                          {p.start}
                        </div>
                      </div>

                      {/* Day cells */}
                      {DAYS.map((_, di) => {
                        const dow = di + 1;
                        const course = courses.find(
                          (c) => c.dayOfWeek === dow && c.startPeriod === p.period
                        );
                        const isNowCol = dow === nowDow;
                        return (
                          <div
                            key={di}
                            style={{
                              borderLeft: "1px solid var(--border)",
                              padding: "4px",
                              position: "relative",
                              background: isNowCol && isThisWeek ? "rgba(94,106,210,0.03)" : undefined,
                            }}
                          >
                            {course && (
                              <div
                                style={{
                                  background: `${course.color}12`,
                                  borderLeft: `3px solid ${course.color}`,
                                  borderRadius: "var(--radius-xs)",
                                  padding: "6px 8px",
                                  height: "100%",
                                }}
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
                                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                                  {course.room}
                                </div>
                              </div>
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
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: nowTopPx,
                        height: 2,
                        background: "var(--danger, #FF3B30)",
                        zIndex: 10,
                        pointerEvents: "none",
                      }}
                    >
                      {/* Circle dot at start */}
                      <div
                        style={{
                          position: "absolute",
                          left: 48,
                          top: -4,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: "var(--danger, #FF3B30)",
                        }}
                      />
                      {/* Time label */}
                      <div
                        style={{
                          position: "absolute",
                          left: 2,
                          top: -9,
                          fontSize: 9,
                          fontWeight: 800,
                          color: "var(--danger, #FF3B30)",
                          letterSpacing: "0.02em",
                          lineHeight: 1,
                          background: "var(--bg)",
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
          </div>
        )}

        {/* ── Day View ── */}
        {viewMode === "day" && (
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
                    <div
                      key={c.id}
                      className="card"
                      style={{
                        borderLeft: `4px solid ${c.color}`,
                        padding: "18px 20px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: c.color,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              marginBottom: 4,
                            }}
                          >
                            第 {c.startPeriod}–{c.endPeriod} 節 · {startP?.start}–{endP?.end}
                          </div>
                          <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em" }}>
                            {c.name}
                          </h3>
                          <div style={{ fontSize: 13, color: "var(--muted)" }}>
                            {c.instructor} · {c.room}
                          </div>
                        </div>
                        <span
                          className="pill"
                          style={{ background: `${c.color}12`, color: c.color, borderColor: `${c.color}20` }}
                        >
                          {c.credits} 學分
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── List View ── */}
        {viewMode === "list" && (
          <div className="pageStack">
            {DAYS.map((d, di) => {
              const dow = di + 1;
              const courses = coursesByDay[dow];
              if (!courses || courses.length === 0) return null;
              return (
                <div key={d} className="sectionCard">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 12,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      星期{d}
                    </h3>
                    <div
                      style={{
                        flex: 1,
                        height: 1,
                        background: "var(--border)",
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {courses.length} 堂
                    </span>
                  </div>
                  <div className="insetGroup">
                    {courses.map((c, ci) => {
                      const startP = PERIODS.find((p) => p.period === c.startPeriod);
                      const endP = PERIODS.find((p) => p.period === c.endPeriod);
                      return (
                        <div
                          key={c.id}
                          className="insetGroupRow"
                          style={{ borderTop: ci === 0 ? "none" : undefined }}
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Summary */}
            <div className="card">
              <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, marginBottom: 12 }}>
                學分統計
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "var(--brand)", letterSpacing: "-0.05em" }}>
                    {totalCredits}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>總學分</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#34C759", letterSpacing: "-0.05em" }}>
                    {courses.length}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>門課程</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#FF9500", letterSpacing: "-0.05em" }}>
                    5
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>授課天數</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
