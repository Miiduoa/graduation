"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useState, useMemo } from "react";

type ViewMode = "week" | "day" | "list";

type CourseSlot = {
  id: string;
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  color: string;
  courseCode: string;
  credits: number;
};

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

const PERIODS = [
  { period: 1, time: "08:10-09:00" },
  { period: 2, time: "09:10-10:00" },
  { period: 3, time: "10:20-11:10" },
  { period: 4, time: "11:20-12:10" },
  { period: 5, time: "13:10-14:00" },
  { period: 6, time: "14:10-15:00" },
  { period: 7, time: "15:20-16:10" },
  { period: 8, time: "16:20-17:10" },
  { period: 9, time: "17:20-18:10" },
  { period: 10, time: "18:30-19:20" },
  { period: 11, time: "19:25-20:15" },
  { period: 12, time: "20:20-21:10" },
];

const COURSE_COLORS = [
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#EF4444",
  "#6366F1",
  "#14B8A6",
];

const MOCK_COURSES: CourseSlot[] = [
  { id: "1", name: "資料結構", teacher: "王教授", location: "資訊大樓 301", dayOfWeek: 1, startPeriod: 2, endPeriod: 3, color: COURSE_COLORS[0], courseCode: "CS201", credits: 3 },
  { id: "2", name: "資料庫系統", teacher: "李教授", location: "資訊大樓 402", dayOfWeek: 1, startPeriod: 6, endPeriod: 7, color: COURSE_COLORS[1], courseCode: "CS301", credits: 3 },
  { id: "3", name: "演算法", teacher: "陳教授", location: "工程大樓 201", dayOfWeek: 2, startPeriod: 3, endPeriod: 4, color: COURSE_COLORS[2], courseCode: "CS302", credits: 3 },
  { id: "4", name: "作業系統", teacher: "林教授", location: "資訊大樓 301", dayOfWeek: 3, startPeriod: 2, endPeriod: 3, color: COURSE_COLORS[3], courseCode: "CS303", credits: 3 },
  { id: "5", name: "計算機網路", teacher: "張教授", location: "資訊大樓 501", dayOfWeek: 3, startPeriod: 6, endPeriod: 8, color: COURSE_COLORS[4], courseCode: "CS304", credits: 3 },
  { id: "6", name: "軟體工程", teacher: "黃教授", location: "管理大樓 102", dayOfWeek: 4, startPeriod: 3, endPeriod: 4, color: COURSE_COLORS[5], courseCode: "CS401", credits: 3 },
  { id: "7", name: "人工智慧", teacher: "周教授", location: "資訊大樓 601", dayOfWeek: 5, startPeriod: 2, endPeriod: 3, color: COURSE_COLORS[6], courseCode: "CS402", credits: 3 },
  { id: "8", name: "專題研究", teacher: "吳教授", location: "研究大樓 301", dayOfWeek: 5, startPeriod: 6, endPeriod: 8, color: COURSE_COLORS[7], courseCode: "CS499", credits: 2 },
];

export default function TimetablePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [selectedSemester, setSelectedSemester] = useState("2025-2");

  const today = new Date().getDay();

  const totalCredits = useMemo(() => {
    return MOCK_COURSES.reduce((sum, c) => sum + c.credits, 0);
  }, []);

  const todayCourses = useMemo(() => {
    return MOCK_COURSES.filter((c) => c.dayOfWeek === today).sort((a, b) => a.startPeriod - b.startPeriod);
  }, [today]);

  const getCurrentPeriod = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const time = hour * 60 + minute;

    for (let i = 0; i < PERIODS.length; i++) {
      const [start] = PERIODS[i].time.split("-");
      const [startHour, startMin] = start.split(":").map(Number);
      const periodStart = startHour * 60 + startMin;
      const periodEnd = periodStart + 50;
      if (time >= periodStart && time < periodEnd + 10) {
        return i + 1;
      }
    }
    return 0;
  };

  const currentPeriod = getCurrentPeriod();

  const nextCourse = useMemo(() => {
    if (today === 0 || today === 6) return null;
    return todayCourses.find((c) => c.startPeriod > currentPeriod) ?? null;
  }, [todayCourses, currentPeriod, today]);

  const semesters = [
    { id: "2025-2", label: "113-2 學期", current: true },
    { id: "2025-1", label: "113-1 學期" },
    { id: "2024-2", label: "112-2 學期" },
  ];

  const renderWeekView = () => {
    const displayDays = [1, 2, 3, 4, 5];
    const displayPeriods = PERIODS.slice(0, 10);

    return (
      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ 
                width: 60, 
                padding: "12px 8px", 
                fontSize: 12, 
                color: "var(--muted)",
                textAlign: "center",
              }}>
                節次
              </th>
              {displayDays.map((day) => (
                <th 
                  key={day}
                  style={{ 
                    padding: "12px 8px", 
                    fontSize: 14, 
                    fontWeight: day === today ? 700 : 500,
                    color: day === today ? "var(--brand)" : "var(--text)",
                    background: day === today ? "rgba(139,92,246,0.1)" : "transparent",
                    borderRadius: day === today ? "8px 8px 0 0" : 0,
                  }}
                >
                  {WEEKDAYS[day]}
                  {day === today && <span style={{ marginLeft: 4 }}>✨</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayPeriods.map((p) => (
              <tr key={p.period}>
                <td style={{ 
                  padding: "8px", 
                  textAlign: "center",
                  fontSize: 12,
                  color: p.period === currentPeriod ? "var(--brand)" : "var(--muted)",
                  fontWeight: p.period === currentPeriod ? 700 : 400,
                  background: p.period === currentPeriod ? "rgba(139,92,246,0.1)" : "transparent",
                  borderRadius: p.period === currentPeriod ? "8px 0 0 8px" : 0,
                }}>
                  <div>{p.period}</div>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{p.time.split("-")[0]}</div>
                </td>
                {displayDays.map((day) => {
                  const course = MOCK_COURSES.find(
                    (c) => c.dayOfWeek === day && p.period >= c.startPeriod && p.period <= c.endPeriod
                  );
                  const isStart = course?.startPeriod === p.period;

                  if (course && isStart) {
                    const rowSpan = course.endPeriod - course.startPeriod + 1;
                    return (
                      <td 
                        key={`${day}-${p.period}`}
                        rowSpan={rowSpan}
                        style={{ 
                          padding: 4,
                          verticalAlign: "top",
                          background: day === today ? "rgba(139,92,246,0.05)" : "transparent",
                        }}
                      >
                        <div style={{
                          padding: 10,
                          borderRadius: 8,
                          background: course.color,
                          color: "#fff",
                          height: "100%",
                          minHeight: rowSpan * 48 - 8,
                          cursor: "pointer",
                          transition: "transform 0.2s, box-shadow 0.2s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "scale(1.02)";
                          e.currentTarget.style.boxShadow = `0 4px 12px ${course.color}40`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "scale(1)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{course.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.9 }}>{course.location}</div>
                          <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4 }}>{course.teacher}</div>
                        </div>
                      </td>
                    );
                  } else if (course) {
                    return null;
                  }

                  return (
                    <td 
                      key={`${day}-${p.period}`}
                      style={{ 
                        padding: 4,
                        background: day === today ? "rgba(139,92,246,0.05)" : "transparent",
                      }}
                    >
                      <div style={{
                        height: 40,
                        borderRadius: 6,
                        border: "1px dashed var(--border)",
                        background: "var(--panel2)",
                      }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDayView = () => {
    const dayCourses = MOCK_COURSES
      .filter((c) => c.dayOfWeek === selectedDay)
      .sort((a, b) => a.startPeriod - b.startPeriod);

    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((day) => (
            <button
              key={day}
              className={`btn ${selectedDay === day ? "primary" : ""}`}
              onClick={() => setSelectedDay(day)}
              style={{ fontSize: 13 }}
            >
              {WEEKDAYS[day]}
              {day === today && <span style={{ marginLeft: 4 }}>✨</span>}
            </button>
          ))}
        </div>

        {dayCourses.length === 0 ? (
          <div style={{ 
            textAlign: "center", 
            padding: 40, 
            color: "var(--muted)",
            background: "var(--panel2)",
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{WEEKDAYS[selectedDay]}沒有課程</div>
            <div style={{ fontSize: 14, marginTop: 8 }}>享受你的休息時間吧！</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dayCourses.map((course) => (
              <div 
                key={course.id}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: "var(--panel2)",
                  borderLeft: `4px solid ${course.color}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  cursor: "pointer",
                  transition: "transform 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateX(4px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateX(0)"}
              >
                <div style={{ 
                  textAlign: "center",
                  minWidth: 60,
                }}>
                  <div style={{ 
                    fontSize: 24, 
                    fontWeight: 900, 
                    color: course.color,
                  }}>
                    {course.startPeriod}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {PERIODS[course.startPeriod - 1]?.time.split("-")[0]}
                  </div>
                  {course.endPeriod > course.startPeriod && (
                    <>
                      <div style={{ color: "var(--muted)", fontSize: 10 }}>~</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: course.color }}>
                        {course.endPeriod}
                      </div>
                    </>
                  )}
                </div>
                
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{course.name}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--muted)" }}>
                    <span>👨‍🏫 {course.teacher}</span>
                    <span>📍 {course.location}</span>
                  </div>
                </div>
                
                <div style={{ 
                  padding: "4px 10px", 
                  borderRadius: 999, 
                  background: `${course.color}20`,
                  color: course.color,
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {course.credits} 學分
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderListView = () => {
    const groupedCourses = MOCK_COURSES.reduce((acc, course) => {
      if (!acc[course.dayOfWeek]) acc[course.dayOfWeek] = [];
      acc[course.dayOfWeek].push(course);
      return acc;
    }, {} as Record<number, CourseSlot[]>);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {[1, 2, 3, 4, 5].map((day) => {
          const dayCourses = groupedCourses[day] ?? [];
          if (dayCourses.length === 0) return null;

          return (
            <div key={day}>
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 12, 
                marginBottom: 12,
              }}>
                <span style={{ 
                  fontWeight: 700, 
                  fontSize: 15,
                  color: day === today ? "var(--brand)" : "var(--text)",
                }}>
                  {WEEKDAYS[day]}
                </span>
                {day === today && (
                  <span className="pill" style={{ 
                    background: "rgba(139,92,246,0.2)", 
                    color: "var(--brand)",
                    fontSize: 11,
                  }}>
                    今天
                  </span>
                )}
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dayCourses
                  .sort((a, b) => a.startPeriod - b.startPeriod)
                  .map((course) => (
                    <div 
                      key={course.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: "var(--panel2)",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div style={{
                        width: 6,
                        height: 36,
                        borderRadius: 3,
                        background: course.color,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{course.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          第 {course.startPeriod}-{course.endPeriod} 節 · {course.location}
                        </div>
                      </div>
                      <span style={{ 
                        fontSize: 12, 
                        fontWeight: 600,
                        color: course.color,
                      }}>
                        {course.credits} 學分
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="📅 課表"
      subtitle="課程安排 · 週課表 · 學分統計"
    >
      {/* Semester Selector */}
      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {semesters.map((sem) => (
            <button
              key={sem.id}
              className={`btn ${selectedSemester === sem.id ? "primary" : ""}`}
              onClick={() => setSelectedSemester(sem.id)}
              style={{ fontSize: 13 }}
            >
              {sem.label}
              {sem.current && <span style={{ marginLeft: 4 }}>✨</span>}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn" style={{ fontSize: 13 }}>
            📥 匯出課表
          </button>
          <button className="btn" style={{ fontSize: 13 }}>
            🔄 同步教務系統
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", 
        gap: 16, 
        marginBottom: 24 
      }}>
        {[
          { label: "課程數", value: MOCK_COURSES.length.toString(), icon: "📚", color: "#8B5CF6" },
          { label: "總學分", value: totalCredits.toString(), icon: "🎯", color: "#10B981" },
          { label: "今日課程", value: todayCourses.length.toString(), icon: "📅", color: "#F59E0B" },
          { label: "目前節次", value: currentPeriod > 0 ? `第 ${currentPeriod} 節` : "無", icon: "⏰", color: "#3B82F6" },
        ].map((stat) => (
          <div 
            key={stat.label} 
            className="card"
            style={{ padding: 16, textAlign: "center" }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Next Course Alert */}
      {nextCourse && (
        <div className="card" style={{ 
          marginBottom: 24, 
          background: `linear-gradient(135deg, ${nextCourse.color}15 0%, ${nextCourse.color}05 100%)`,
          borderLeft: `4px solid ${nextCourse.color}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: nextCourse.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 900,
              fontSize: 20,
            }}>
              {nextCourse.startPeriod}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>🔔 下一堂課</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{nextCourse.name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                {nextCourse.location} · {nextCourse.teacher} · {PERIODS[nextCourse.startPeriod - 1]?.time.split("-")[0]} 開始
              </div>
            </div>
            <button className="btn primary" style={{ fontSize: 13 }}>
              📍 導航到教室
            </button>
          </div>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="card" style={{ marginBottom: 24, padding: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { key: "week", label: "週課表", icon: "📊" },
            { key: "day", label: "日檢視", icon: "📅" },
            { key: "list", label: "列表", icon: "📋" },
          ].map((mode) => (
            <button
              key={mode.key}
              className={`btn ${viewMode === mode.key ? "primary" : ""}`}
              onClick={() => setViewMode(mode.key as ViewMode)}
              style={{ fontSize: 13 }}
            >
              {mode.icon} {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule View */}
      <div className="card">
        <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 700 }}>
          {viewMode === "week" ? "📊 週課表" : viewMode === "day" ? `📅 ${WEEKDAYS[selectedDay]}課程` : "📋 所有課程"}
        </h2>
        
        {viewMode === "week" && renderWeekView()}
        {viewMode === "day" && renderDayView()}
        {viewMode === "list" && renderListView()}
      </div>

      {/* Course Summary */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>📊 學分統計</h2>
        
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", 
          gap: 16 
        }}>
          {MOCK_COURSES.map((course) => (
            <div 
              key={course.id}
              style={{
                padding: 12,
                borderRadius: 10,
                background: `${course.color}10`,
                borderLeft: `3px solid ${course.color}`,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{course.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{course.courseCode}</div>
              <div style={{ 
                marginTop: 8, 
                fontSize: 18, 
                fontWeight: 800, 
                color: course.color 
              }}>
                {course.credits} 學分
              </div>
            </div>
          ))}
        </div>
        
        <div style={{ 
          marginTop: 20, 
          padding: 16, 
          background: "var(--panel2)", 
          borderRadius: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontWeight: 600 }}>本學期總計</span>
          <div style={{ display: "flex", gap: 24 }}>
            <span>
              <span style={{ color: "var(--muted)", marginRight: 8 }}>課程數</span>
              <span style={{ fontWeight: 700 }}>{MOCK_COURSES.length}</span>
            </span>
            <span>
              <span style={{ color: "var(--muted)", marginRight: 8 }}>總學分</span>
              <span style={{ fontWeight: 700, color: "var(--brand)" }}>{totalCredits}</span>
            </span>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
