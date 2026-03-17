"use client";

import { useState, useEffect, useCallback } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import Link from "next/link";
import { useAuth } from "@/components/AuthGuard";
import { fetchUserProfile, fetchGrades, fetchGPA, isFirebaseConfigured } from "@/lib/firebase";

type Tab = "overview" | "courses" | "activities" | "achievements";

type UserDisplay = {
  name: string;
  email: string;
  avatar: string;
  department: string;
  grade: string;
  studentId: string;
  admissionYear: number;
  expectedGraduation: number;
  gpa: number;
  totalCredits: number;
  requiredCredits: number;
  bio: string;
  interests: string[];
  social: { github: string; linkedin: string };
};

type CourseDisplay = {
  name: string;
  grade: string;
  credits: number;
  semester: string;
};

type ActivityDisplay = {
  name: string;
  date: string;
  status: string;
  type: string;
};

type AchievementDisplay = {
  icon: string;
  name: string;
  description: string;
  date: string;
};

const DEFAULT_USER: UserDisplay = {
  name: "王大明",
  email: "d12345678@mail.ncku.edu.tw",
  avatar: "👨‍🎓",
  department: "資訊工程學系",
  grade: "大三",
  studentId: "D12345678",
  admissionYear: 2022,
  expectedGraduation: 2026,
  gpa: 3.85,
  totalCredits: 96,
  requiredCredits: 128,
  bio: "熱愛程式設計與人工智慧，專注於深度學習研究。",
  interests: ["人工智慧", "機器學習", "Web 開發", "競賽程式"],
  social: { github: "wang-daming", linkedin: "wang-daming" },
};

const DEFAULT_COURSES: CourseDisplay[] = [
  { name: "資料結構", grade: "A+", credits: 3, semester: "113-1" },
  { name: "演算法", grade: "A", credits: 3, semester: "113-1" },
  { name: "作業系統", grade: "A", credits: 3, semester: "113-1" },
  { name: "計算機網路", grade: "A-", credits: 3, semester: "113-1" },
  { name: "人工智慧", grade: "進行中", credits: 3, semester: "113-2" },
];

const DEFAULT_ACTIVITIES: ActivityDisplay[] = [
  { name: "程式設計競賽校內選拔", date: "2025-03-15", status: "已報名", type: "競賽" },
  { name: "AI 工作坊", date: "2025-03-20", status: "已報名", type: "工作坊" },
  { name: "社團博覽會", date: "2025-03-01", status: "已參加", type: "活動" },
  { name: "校慶運動會", date: "2025-05-10", status: "未報名", type: "活動" },
];

const DEFAULT_ACHIEVEMENTS: AchievementDisplay[] = [
  { icon: "🏆", name: "學業優秀獎", description: "學期成績排名前 5%", date: "2024-09" },
  { icon: "💻", name: "程式競賽銀牌", description: "校內程式設計競賽", date: "2024-05" },
  { icon: "📚", name: "勤學獎", description: "連續 3 學期無缺曠課", date: "2024-01" },
  { icon: "🤝", name: "志工服務獎", description: "完成 50 小時志工服務", date: "2023-12" },
  { icon: "🎯", name: "新生學習達人", description: "完成新生學習任務", date: "2022-10" },
];

export default function ProfilePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;
  
  const { user: authUser, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [user, setUser] = useState<UserDisplay>(DEFAULT_USER);
  const [recentCourses, setRecentCourses] = useState<CourseDisplay[]>(DEFAULT_COURSES);
  const [activities] = useState<ActivityDisplay[]>(DEFAULT_ACTIVITIES);
  const [achievements] = useState<AchievementDisplay[]>(DEFAULT_ACHIEVEMENTS);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!authUser || !isFirebaseConfigured()) {
      setUser(DEFAULT_USER);
      setRecentCourses(DEFAULT_COURSES);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [profile, grades, gpaData] = await Promise.all([
        fetchUserProfile(authUser.uid),
        fetchGrades(authUser.uid),
        fetchGPA(authUser.uid),
      ]);

      if (profile) {
        setUser({
          name: profile.displayName || authUser.displayName || "使用者",
          email: profile.email || authUser.email || "",
          avatar: "👨‍🎓",
          department: profile.department || "未設定",
          grade: profile.grade || "未設定",
          studentId: profile.studentId || "未設定",
          admissionYear: profile.enrollmentYear || new Date().getFullYear(),
          expectedGraduation: (profile.enrollmentYear || new Date().getFullYear()) + 4,
          gpa: gpaData?.cumulative || 0,
          totalCredits: grades.reduce((sum, g) => sum + g.credits, 0),
          requiredCredits: 128,
          bio: profile.bio || "",
          interests: [],
          social: { github: "", linkedin: "" },
        });
      } else {
        setUser({
          ...DEFAULT_USER,
          name: authUser.displayName || "使用者",
          email: authUser.email || "",
        });
      }

      if (grades.length > 0) {
        const converted: CourseDisplay[] = grades.slice(0, 5).map((g) => ({
          name: g.courseName,
          grade: g.grade,
          credits: g.credits,
          semester: g.semester,
        }));
        setRecentCourses(converted);
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      setUser(DEFAULT_USER);
      setRecentCourses(DEFAULT_COURSES);
    } finally {
      setLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  const handleShare = async () => {
    try {
      await navigator.share({
        title: `${user.name} 的個人檔案`,
        text: `${user.department} · ${user.grade}`,
        url: window.location.href,
      });
    } catch {
      navigator.clipboard.writeText(window.location.href);
      alert("個人檔案連結已複製到剪貼簿！");
    }
  };

  if (loading || authLoading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="個人檔案"
        subtitle="查看和管理您的學生資訊。"
      >
        <div className="card emptyState">
          <div className="emptyIcon">⏳</div>
          <p className="emptyTitle">載入個人資料中...</p>
          <p className="emptyBody">正在同步您的學籍、課程與活動資料。</p>
        </div>
      </SiteShell>
    );
  }

  const stats = [
    { label: "GPA", value: user.gpa.toFixed(2), icon: "📊", color: "#10B981" },
    { label: "已修學分", value: `${user.totalCredits}/${user.requiredCredits}`, icon: "📚", color: "#3B82F6" },
    { label: "參與活動", value: "15", icon: "🎉", color: "#F59E0B" },
    { label: "獲得成就", value: achievements.length.toString(), icon: "🏆", color: "#8B5CF6" },
  ];

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "overview", label: "總覽", icon: "📋" },
    { key: "courses", label: "課程", icon: "📚" },
    { key: "activities", label: "活動", icon: "🎉" },
    { key: "achievements", label: "成就", icon: "🏆" },
  ];
  const completionPercent = Math.round((user.totalCredits / user.requiredCredits) * 100);
  const lockedAchievements = [
    { icon: "🎓", name: "畢業在即", description: "完成所有畢業學分" },
    { icon: "🏅", name: "全能學生", description: "學業、活動、服務三滿分" },
    { icon: "📖", name: "書蟲", description: "圖書館借閱達 100 本" },
  ];

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="個人檔案"
      subtitle="查看和管理您的學生資訊。"
    >
      <div className="pageStack">
        <section className="heroPanel">
          <div className="heroIdentity">
            <div className="heroAvatar is-round">{user.avatar}</div>
            <div className="heroCopy">
              <div className="heroTitleRow">
                <h2 className="heroTitle">{user.name}</h2>
                <span className="statusBadge">已認證</span>
              </div>
              <p className="heroMeta">{user.department} · {user.grade} · {user.studentId}</p>
              <p className="heroText">{user.bio}</p>
              {user.interests.length > 0 ? (
                <div className="heroChips">
                  {user.interests.map((interest) => (
                    <span key={interest} className="pill">
                      {interest}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="heroActions">
              <Link href={`/settings${q}`} className="btn primary">
                編輯檔案
              </Link>
              <button type="button" className="btn" onClick={handleShare}>
                分享檔案
              </button>
            </div>
          </div>
        </section>

        <div className="metricGrid">
          {stats.map((stat) => (
            <div key={stat.label} className="metricCard" style={{ "--tone": stat.color } as React.CSSProperties}>
              <div className="metricIcon">{stat.icon}</div>
              <div className="metricValue">{stat.value}</div>
              <div className="metricLabel">{stat.label}</div>
            </div>
          ))}
        </div>

        <section className="card sectionCard">
          <div className="segmentedGroup">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`btn ${activeTab === tab.key ? "primary" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </section>

      {activeTab === "overview" && (
        <div className="pageSplit">
          <section className="card sectionCard">
            <div className="sectionCopy">
              <p className="sectionEyebrow">Academic</p>
              <h2 className="sectionTitle">學業資訊</h2>
            </div>

            <div className="infoRows">
              {[
                { label: "入學年度", value: `${user.admissionYear} 年` },
                { label: "預計畢業", value: `${user.expectedGraduation} 年` },
                { label: "目前 GPA", value: user.gpa.toFixed(2) },
                { label: "學分進度", value: `${user.totalCredits} / ${user.requiredCredits}` },
              ].map((item) => (
                <div key={item.label} className="infoRow">
                  <span className="infoKey">{item.label}</span>
                  <span className="infoValue">{item.value}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="progressMeta">
                <span>學分完成度</span>
                <span className="infoValue" style={{ color: "var(--brand)" }}>{completionPercent}%</span>
              </div>
              <div className="progressTrack">
                <div className="progressFill" style={{ "--progress-width": `${completionPercent}%`, "--progress": "linear-gradient(90deg, #8B5CF6 0%, #EC4899 100%)" } as React.CSSProperties} />
              </div>
            </div>
          </section>

          <section className="card sectionCard">
            <div className="sectionCopy">
              <p className="sectionEyebrow">Contact</p>
              <h2 className="sectionTitle">聯絡資訊</h2>
            </div>

            <div className="surfaceList">
              <div className="surfaceItem">
                <div className="surfaceAccent">📧</div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">學校信箱</h3>
                  <p className="surfaceMeta">{user.email}</p>
                </div>
              </div>

              <div className="surfaceItem">
                <div className="surfaceAccent">🐙</div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">GitHub</h3>
                  <p className="surfaceMeta">@{user.social.github || "未設定"}</p>
                </div>
                {user.social.github ? <a href={`https://github.com/${user.social.github}`} target="_blank" rel="noopener noreferrer" className="btn">查看</a> : null}
              </div>

              <div className="surfaceItem">
                <div className="surfaceAccent">💼</div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">LinkedIn</h3>
                  <p className="surfaceMeta">@{user.social.linkedin || "未設定"}</p>
                </div>
                {user.social.linkedin ? <a href={`https://linkedin.com/in/${user.social.linkedin}`} target="_blank" rel="noopener noreferrer" className="btn">查看</a> : null}
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "courses" && (
        <section className="card sectionCard">
          <div className="sectionHead">
            <div className="sectionCopy">
              <p className="sectionEyebrow">Courses</p>
              <h2 className="sectionTitle">課程紀錄</h2>
            </div>
            <Link href={`/timetable${q}`} className="btn">
              查看完整課表
            </Link>
          </div>

          <div className="surfaceList">
            {recentCourses.map((course) => (
              <div key={course.name} className="surfaceItem">
                <div className="surfaceAccent" style={{ "--accent-bg": "var(--accent-soft)", "--accent": "#fff", background: "var(--brand)" } as React.CSSProperties}>
                  {course.credits}
                </div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">{course.name}</h3>
                  <p className="surfaceMeta">{course.semester}</p>
                </div>
                <span
                  className="statusBadge"
                  style={
                    course.grade === "進行中"
                      ? ({ "--status-bg": "rgba(91, 166, 255, 0.16)", "--status-color": "var(--info)" } as React.CSSProperties)
                      : ({ "--status-bg": "rgba(44, 184, 168, 0.16)", "--status-color": "var(--success)" } as React.CSSProperties)
                  }
                >
                  {course.grade}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === "activities" && (
        <section className="card sectionCard">
          <div className="sectionHead">
            <div className="sectionCopy">
              <p className="sectionEyebrow">Activities</p>
              <h2 className="sectionTitle">活動紀錄</h2>
            </div>
            <Link href={`/clubs${q}`} className="btn">
              探索更多活動
            </Link>
          </div>

          <div className="surfaceList">
            {activities.map((activity) => (
              <div key={activity.name} className="surfaceItem">
                <div
                  className="surfaceAccent"
                  style={
                    activity.status === "已參加"
                      ? ({ "--accent-bg": "rgba(44, 184, 168, 0.16)", "--accent": "var(--success)" } as React.CSSProperties)
                      : activity.status === "已報名"
                        ? ({ "--accent-bg": "rgba(91, 108, 255, 0.14)", "--accent": "var(--brand)" } as React.CSSProperties)
                        : ({ "--accent-bg": "var(--panel2)", "--accent": "var(--muted)" } as React.CSSProperties)
                  }
                >
                  {activity.type === "競賽" ? "🏆" : activity.type === "工作坊" ? "💻" : "🎊"}
                </div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">{activity.name}</h3>
                  <p className="surfaceMeta">{activity.date}</p>
                </div>
                <span
                  className="statusBadge"
                  style={
                    activity.status === "已參加"
                      ? ({ "--status-bg": "rgba(44, 184, 168, 0.16)", "--status-color": "var(--success)" } as React.CSSProperties)
                      : activity.status === "已報名"
                        ? ({ "--status-bg": "rgba(91, 108, 255, 0.14)", "--status-color": "var(--brand)" } as React.CSSProperties)
                        : ({ "--status-bg": "var(--panel2)", "--status-color": "var(--muted)" } as React.CSSProperties)
                  }
                >
                  {activity.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === "achievements" && (
        <section className="card sectionCard">
          <div className="sectionCopy">
            <p className="sectionEyebrow">Achievements</p>
            <h2 className="sectionTitle">成就徽章</h2>
          </div>

          <div className="surfaceGrid">
            {achievements.map((achievement) => (
              <div key={achievement.name} className="surfaceItem">
                <div className="surfaceAccent is-round" style={{ "--accent-bg": "linear-gradient(135deg, rgba(91, 108, 255, 0.18) 0%, rgba(239, 109, 126, 0.14) 100%)" } as React.CSSProperties}>
                  {achievement.icon}
                </div>
                <div className="surfaceContent">
                  <h3 className="surfaceTitle">{achievement.name}</h3>
                  <p className="surfaceMeta">{achievement.description}</p>
                  <p className="metricMeta">{achievement.date}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="sectionCard">
            <div className="sectionCopy">
              <h3 className="sectionTitle">待解鎖成就</h3>
              <p className="sectionText">保留未達成目標，讓整體頁面更像持續累積的個人儀表板。</p>
            </div>
            <div className="surfaceGrid">
              {lockedAchievements.map((achievement) => (
                <div key={achievement.name} className="surfaceItem" style={{ opacity: 0.58 }}>
                  <div className="surfaceAccent is-round" style={{ "--accent-bg": "var(--panel2)", "--accent": "var(--muted)", filter: "grayscale(100%)" } as React.CSSProperties}>
                    {achievement.icon}
                  </div>
                  <div className="surfaceContent">
                    <h3 className="surfaceTitle">{achievement.name}</h3>
                    <p className="surfaceMeta">{achievement.description}</p>
                  </div>
                  <span className="metricMeta">🔒</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      </div>
    </SiteShell>
  );
}
