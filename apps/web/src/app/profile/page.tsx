"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState, type CSSProperties } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  fetchFavorites,
  fetchGPA,
  fetchGrades,
  fetchLibraryLoans,
  fetchUserCourses,
  fetchUserProfile,
  getAuth,
  isFirebaseConfigured,
  type Grade,
  type LibraryLoan,
  type UserCourse,
  type UserProfile,
} from "@/lib/firebase";

type Tab = "overview" | "courses" | "snapshot";

type ProfileBundle = {
  profile: UserProfile | null;
  courses: UserCourse[];
  grades: Grade[];
  gpa: Awaited<ReturnType<typeof fetchGPA>>;
  favoritesCount: number;
  loans: LibraryLoan[];
};

const PERIOD_LABELS = [
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

const WEEKDAY_LABELS: Record<number, string> = {
  1: "週一",
  2: "週二",
  3: "週三",
  4: "週四",
  5: "週五",
  6: "週六",
  7: "週日",
};

function getUserDisplayName(user: User | null, profile: UserProfile | null) {
  return (
    profile?.displayName?.trim() ||
    user?.displayName?.trim() ||
    user?.email?.split("@")[0] ||
    "校園使用者"
  );
}

function formatCourseSchedule(course: UserCourse): string {
  const start = PERIOD_LABELS.find((slot) => slot.period === course.startPeriod)?.start ?? `第 ${course.startPeriod} 節`;
  const end = PERIOD_LABELS.find((slot) => slot.period === course.endPeriod)?.end ?? `第 ${course.endPeriod} 節`;
  return `${WEEKDAY_LABELS[course.dayOfWeek] ?? "未排定"} · ${start} - ${end}`;
}

function formatDate(dateValue?: string) {
  if (!dateValue) {
    return "—";
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString("zh-TW", {
    month: "long",
    day: "numeric",
  });
}

function sortCourses(courses: UserCourse[]) {
  return [...courses].sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }

    return left.startPeriod - right.startPeriod;
  });
}

function findNextCourse(courses: UserCourse[]) {
  const now = new Date();
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  return sortCourses(courses).find((course) => {
    if (course.dayOfWeek !== weekday) {
      return false;
    }

    const start = PERIOD_LABELS.find((slot) => slot.period === course.startPeriod);
    if (!start) {
      return false;
    }

    const [hour, minute] = start.start.split(":").map(Number);
    return hour * 60 + minute >= minutes;
  });
}

function recentGrades(grades: Grade[]) {
  return [...grades].sort((left, right) => {
    const leftDate = left.publishedAt ?? "";
    const rightDate = right.publishedAt ?? "";
    return rightDate.localeCompare(leftDate);
  });
}

export default function ProfilePage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolId, schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileBundle, setProfileBundle] = useState<ProfileBundle>({
    profile: null,
    courses: [],
    grades: [],
    gpa: null,
    favoritesCount: 0,
    loans: [],
  });

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
      if (!user) {
        if (active) {
          setProfileBundle({
            profile: null,
            courses: [],
            grades: [],
            gpa: null,
            favoritesCount: 0,
            loans: [],
          });
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        if (!isFirebaseConfigured()) {
          if (!active) {
            return;
          }

          setProfileBundle({
            profile: null,
            courses: [],
            grades: [],
            gpa: null,
            favoritesCount: 0,
            loans: [],
          });
          return;
        }

        const [profile, gpa, courses, grades, favorites, loans] = await Promise.all([
          fetchUserProfile(user.uid),
          fetchGPA(user.uid),
          fetchUserCourses(user.uid),
          fetchGrades(user.uid),
          fetchFavorites(user.uid, undefined, schoolId),
          fetchLibraryLoans(user.uid, schoolId),
        ]);

        if (!active) {
          return;
        }

        setProfileBundle({
          profile,
          gpa,
          courses,
          grades,
          favoritesCount: favorites.length,
          loans,
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        console.error("Failed to load profile:", loadError);
        setProfileBundle({
          profile: null,
          courses: [],
          grades: [],
          gpa: null,
          favoritesCount: 0,
          loans: [],
        });
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [schoolId, user]);

  const displayName = useMemo(
    () => getUserDisplayName(user, profileBundle.profile),
    [profileBundle.profile, user]
  );
  const initials = displayName.slice(0, 1).toUpperCase();
  const sortedCourses = useMemo(() => sortCourses(profileBundle.courses), [profileBundle.courses]);
  const nextCourse = useMemo(() => findNextCourse(profileBundle.courses), [profileBundle.courses]);
  const recentGradeRows = useMemo(() => recentGrades(profileBundle.grades).slice(0, 5), [profileBundle.grades]);
  const activeLoans = useMemo(
    () => [...profileBundle.loans].sort((left, right) => (left.dueAt ?? "").localeCompare(right.dueAt ?? "")),
    [profileBundle.loans]
  );
  const totalCredits = useMemo(
    () => sortedCourses.reduce((sum, course) => sum + (course.credits ?? 0), 0),
    [sortedCourses]
  );

  if (!user) {
    return (
      <SiteShell schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              display: "grid",
              gap: 16,
            }}
          >
            <span className="pill" style={{ background: "var(--accent-soft)", borderColor: "var(--border)", color: "var(--brand)" }}>
              個人中心
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.05em" }}>
                登入查看個人資訊
              </h1>
              <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.8, opacity: 0.86 }}>
                集中查看你的課表、成績、收藏與借閱紀錄。
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/login${schoolSearch}`} className="btn" style={{ background: "var(--brand)", color: "var(--on-brand)", borderColor: "var(--brand)" }}>
                前往登入
              </Link>
              <Link href={`/settings${schoolSearch}`} className="btn" style={{ background: "var(--surface)", color: "var(--text)", borderColor: "var(--border)" }}>
                偏好設定
              </Link>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell schoolName={schoolName}>
      <div className="pageStack">
        <div
          className="card"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                background: "var(--brand)",
                color: "var(--on-brand)",
                border: "3px solid var(--border)",
                display: "grid",
                placeItems: "center",
                fontSize: 34,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span className="pill" style={{ background: "var(--accent-soft)", borderColor: "var(--border)", color: "var(--brand)" }}>
                  個人中心
                </span>
                {profileBundle.profile?.studentId ? (
                  <span className="pill" style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }}>
                    {profileBundle.profile.studentId}
                  </span>
                ) : null}
              </div>
              <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700, letterSpacing: "-0.05em" }}>
                {displayName}
              </h1>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.84 }}>
                {profileBundle.profile?.department ?? "尚未填寫系所"} · {profileBundle.profile?.grade ?? "尚未填寫年級"} · {user.email ?? "無 Email"}
              </p>
              <p style={{ margin: "14px 0 0", fontSize: 14, lineHeight: 1.8, opacity: 0.86 }}>
                {profileBundle.profile?.bio?.trim() || "尚未填寫自我介紹，可前往設定補充。"}
              </p>
            </div>
            <Link
              href={`/settings${schoolSearch}`}
              className="btn"
              style={{
                background: "var(--brand)",
                color: "var(--on-brand)",
                borderColor: "var(--brand)",
                whiteSpace: "nowrap",
              }}
            >
              編輯資料
            </Link>
          </div>
        </div>

        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📊</div>
            <div className="metricValue">
              {profileBundle.gpa?.cumulative != null ? profileBundle.gpa.cumulative.toFixed(2) : "—"}
            </div>
            <div className="metricLabel">累計 GPA</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--success)" } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{sortedCourses.length}</div>
            <div className="metricLabel">已同步課程</div>
            <div className="metricMeta">{totalCredits} 學分</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--warning)" } as CSSProperties}>
            <div className="metricIcon">⭐</div>
            <div className="metricValue">{profileBundle.favoritesCount}</div>
            <div className="metricLabel">收藏項目</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--info)" } as CSSProperties}>
            <div className="metricIcon">📖</div>
            <div className="metricValue">{activeLoans.length}</div>
            <div className="metricLabel">借閱中</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="sectionTitle">下一堂課</div>
                <div className="sectionText">依照你的課表，顯示今天下一堂課。</div>
              </div>
              {loading ? <span className="pill subtle">整理中…</span> : null}
            </div>
            {nextCourse ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: "var(--radius)",
                  background: "var(--accent-soft)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 800 }}>{nextCourse.name}</div>
                <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 14 }}>
                  {formatCourseSchedule(nextCourse)} · {nextCourse.room ?? "教室待補"}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--brand)", fontWeight: 700 }}>
                  授課教師：{nextCourse.instructor ?? "—"}
                </div>
              </div>
            ) : (
              <div className="emptyState">
                <div className="emptyIcon">⏰</div>
                <h3 className="emptyTitle">目前沒有即將開始的課</h3>
                <p className="emptyBody">可能今天課程已結束，或尚未同步課表。</p>
              </div>
            )}
          </div>

          <div className="card" style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="sectionTitle">借閱提醒</div>
              <div className="sectionText">查看借閱中的書籍與到期日。</div>
            </div>
            {activeLoans.length > 0 ? (
              activeLoans.slice(0, 3).map((loan) => (
                <div key={loan.id} style={{ padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)" }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{loan.bookTitle ?? loan.bookId}</div>
                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                    到期日：{formatDate(loan.dueAt)} · 已續借 {loan.renewCount ?? 0} 次
                  </div>
                </div>
              ))
            ) : (
              <div className="emptyState">
                <div className="emptyIcon">📚</div>
                <h3 className="emptyTitle">目前沒有借閱中的書</h3>
                <p className="emptyBody">圖書館借閱資料同步後會顯示在這裡。</p>
              </div>
            )}
          </div>
        </div>

        <div className="segmentedGroup">
          {([
            { key: "overview", label: "📋 概覽" },
            { key: "courses", label: "📚 課程" },
            { key: "snapshot", label: "📈 摘要" },
          ] as Array<{ key: Tab; label: string }>).map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "active" : ""}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" ? (
          <div className="grid-2">
            <div className="sectionCard">
              <div className="insetGroupHeader">個人資訊</div>
              <div className="insetGroup">
                {[
                  { icon: "🎓", label: "系所", value: profileBundle.profile?.department ?? "尚未填寫" },
                  { icon: "📅", label: "年級", value: profileBundle.profile?.grade ?? "尚未填寫" },
                  { icon: "🪪", label: "學號", value: profileBundle.profile?.studentId ?? "尚未填寫" },
                  { icon: "📧", label: "電子郵件", value: user.email ?? "—" },
                  { icon: "📱", label: "電話", value: profileBundle.profile?.phone ?? "尚未填寫" },
                ].map((row, index) => (
                  <div key={row.label} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                    <div className="insetGroupRowIcon" style={{ fontSize: 18, background: "var(--panel)" }}>{row.icon}</div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{row.label}</div>
                    </div>
                    <div style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sectionCard">
              <div className="insetGroupHeader">最近成績</div>
              <div className="insetGroup">
                {recentGradeRows.length > 0 ? (
                  recentGradeRows.map((grade, index) => (
                    <div key={grade.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                      <div
                        className="insetGroupRowIcon"
                        style={{ background: "var(--accent-soft)", color: "var(--brand)", fontWeight: 800 }}
                      >
                        {grade.grade}
                      </div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{grade.courseName}</div>
                        <div className="insetGroupRowMeta">
                          {grade.courseCode} · {grade.instructor ?? "授課教師待補"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{grade.score ?? "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{formatDate(grade.publishedAt)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="emptyState">
                    <div className="emptyIcon">📊</div>
                    <h3 className="emptyTitle">尚未同步成績</h3>
                    <p className="emptyBody">登入並完成成績同步後會自動呈現最近紀錄。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "courses" ? (
          <div className="sectionCard">
            <div className="insetGroupHeader">本學期課程</div>
            <div className="insetGroup">
              {sortedCourses.length > 0 ? (
                sortedCourses.map((course, index) => (
                  <div key={course.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                    <div className="insetGroupRowIcon" style={{ fontSize: 18, background: "var(--accent-soft)", color: "var(--brand)" }}>
                      {course.credits}
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{course.name}</div>
                      <div className="insetGroupRowMeta">
                        {formatCourseSchedule(course)} · {course.room ?? "教室待補"} · {course.instructor ?? "授課教師待補"}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="emptyState">
                  <div className="emptyIcon">🗓️</div>
                  <h3 className="emptyTitle">尚未同步課表</h3>
                  <p className="emptyBody">課程同步完成後，這裡會顯示實際節次、教師與教室資訊。</p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "snapshot" ? (
          <div className="grid-2">
            <div className="card" style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="sectionTitle">GPA 走勢</div>
                <div className="sectionText">查看最近幾個學期的 GPA。</div>
              </div>
              {profileBundle.gpa?.semesters?.length ? (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  {profileBundle.gpa.semesters.slice(-6).map((row, index, all) => {
                    const max = Math.max(...all.map((item) => item.gpa), 4.3);
                    const height = Math.max(24, (row.gpa / max) * 120);
                    return (
                      <div key={row.semester} style={{ flex: 1, display: "grid", gap: 8, justifyItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{row.gpa.toFixed(2)}</div>
                        <div
                          style={{
                            width: "100%",
                            height,
                            borderRadius: "var(--radius-xs)",
                            background:
                              index === all.length - 1
                                ? "var(--brand)"
                                : "var(--panel2)",
                          }}
                        />
                        <div style={{ fontSize: 11, color: index === all.length - 1 ? "var(--brand)" : "var(--muted)" }}>
                          {row.semester}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">
                  <div className="emptyIcon">📉</div>
                  <h3 className="emptyTitle">尚無 GPA 歷程</h3>
                  <p className="emptyBody">有成績資料後，就能查看各學期的 GPA。</p>
                </div>
              )}
            </div>

            <div className="card" style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="sectionTitle">資料摘要</div>
                <div className="sectionText">查看課務與校園服務的紀錄數量。</div>
              </div>
              {[
                { label: "個人資料", value: profileBundle.profile ? "已同步" : "待補" },
                { label: "課表", value: sortedCourses.length > 0 ? `${sortedCourses.length} 門` : "待補" },
                { label: "成績", value: profileBundle.grades.length > 0 ? `${profileBundle.grades.length} 筆` : "待補" },
                { label: "收藏", value: profileBundle.favoritesCount > 0 ? `${profileBundle.favoritesCount} 筆` : "待補" },
                { label: "借閱", value: activeLoans.length > 0 ? `${activeLoans.length} 本` : "待補" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 14 }}>{row.label}</div>
                  <span className={`pill ${row.value === "待補" ? "subtle" : "success"}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
