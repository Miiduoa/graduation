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
        title="👤 個人檔案"
        subtitle="查看和管理您的學生資訊"
      >
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入個人資料中...</div>
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

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="👤 個人檔案"
      subtitle="查看和管理您的學生資訊"
    >
      {/* Profile Header */}
      <div className="card" style={{ 
        marginBottom: 24,
        background: "linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(236,72,153,0.1) 100%)",
      }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* Avatar */}
          <div style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            background: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 48,
            flexShrink: 0,
          }}>
            {user.avatar}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{user.name}</h1>
              <span style={{
                padding: "4px 12px",
                background: "rgba(16,185,129,0.2)",
                color: "#10B981",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
              }}>
                ✓ 已認證
              </span>
            </div>
            
            <div style={{ fontSize: 16, color: "var(--muted)", marginBottom: 12 }}>
              {user.department} · {user.grade} · {user.studentId}
            </div>
            
            <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 16, lineHeight: 1.6 }}>
              {user.bio}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {user.interests.map((interest) => (
                <span 
                  key={interest}
                  className="pill"
                  style={{ fontSize: 12 }}
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href={`/settings${q}`} className="btn primary" style={{ fontSize: 13 }}>
              ⚙️ 編輯檔案
            </Link>
            <button className="btn" style={{ fontSize: 13 }} onClick={handleShare}>
              📤 分享檔案
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", 
        gap: 16, 
        marginBottom: 24 
      }}>
        {stats.map((stat) => (
          <div 
            key={stat.label} 
            className="card"
            style={{ textAlign: "center", padding: 20 }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: stat.color, marginBottom: 4 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: 24, padding: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`btn ${activeTab === tab.key ? "primary" : ""}`}
              onClick={() => setActiveTab(tab.key)}
              style={{ fontSize: 13 }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Academic Info */}
          <div className="card">
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>🎓 學業資訊</h2>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "入學年度", value: `${user.admissionYear} 年` },
                { label: "預計畢業", value: `${user.expectedGraduation} 年` },
                { label: "目前 GPA", value: user.gpa.toFixed(2) },
                { label: "學分進度", value: `${user.totalCredits} / ${user.requiredCredits}` },
              ].map((item) => (
                <div 
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>{item.label}</span>
                  <span style={{ fontWeight: 600 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* Credit Progress */}
            <div style={{ marginTop: 16 }}>
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                marginBottom: 8,
                fontSize: 13,
              }}>
                <span>學分完成度</span>
                <span style={{ color: "var(--brand)", fontWeight: 600 }}>
                  {Math.round((user.totalCredits / user.requiredCredits) * 100)}%
                </span>
              </div>
              <div style={{
                height: 8,
                background: "var(--panel2)",
                borderRadius: 4,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${(user.totalCredits / user.requiredCredits) * 100}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #8B5CF6 0%, #EC4899 100%)",
                  borderRadius: 4,
                }} />
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div className="card">
            <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>📧 聯絡資訊</h2>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                background: "var(--panel2)",
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 20 }}>📧</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>學校信箱</div>
                  <div style={{ fontSize: 14 }}>{user.email}</div>
                </div>
              </div>

              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                background: "var(--panel2)",
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 20 }}>🐙</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>GitHub</div>
                  <div style={{ fontSize: 14 }}>@{user.social.github}</div>
                </div>
                <a 
                  href={`https://github.com/${user.social.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", fontSize: 13 }}
                >
                  查看 →
                </a>
              </div>

              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                background: "var(--panel2)",
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 20 }}>💼</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>LinkedIn</div>
                  <div style={{ fontSize: 14 }}>@{user.social.linkedin}</div>
                </div>
                <a 
                  href={`https://linkedin.com/in/${user.social.linkedin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", fontSize: 13 }}
                >
                  查看 →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "courses" && (
        <div className="card">
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
            marginBottom: 20,
          }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📚 課程紀錄</h2>
            <Link href={`/timetable${q}`} style={{ color: "var(--brand)", fontSize: 13 }}>
              查看完整課表 →
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {recentCourses.map((course) => (
              <div
                key={course.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: 16,
                  background: "var(--panel2)",
                  borderRadius: 12,
                  gap: 16,
                }}
              >
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                }}>
                  {course.credits}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{course.name}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{course.semester}</div>
                </div>
                <div style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: course.grade === "進行中" 
                    ? "rgba(59,130,246,0.1)" 
                    : "rgba(16,185,129,0.1)",
                  color: course.grade === "進行中" ? "#3B82F6" : "#10B981",
                  fontWeight: 700,
                  fontSize: 14,
                }}>
                  {course.grade}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "activities" && (
        <div className="card">
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
            marginBottom: 20,
          }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🎉 活動紀錄</h2>
            <Link href={`/clubs${q}`} style={{ color: "var(--brand)", fontSize: 13 }}>
              探索更多活動 →
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {activities.map((activity) => (
              <div
                key={activity.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: 16,
                  background: "var(--panel2)",
                  borderRadius: 12,
                  gap: 16,
                }}
              >
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 
                    activity.status === "已參加" ? "rgba(16,185,129,0.1)" :
                    activity.status === "已報名" ? "rgba(139,92,246,0.1)" :
                    "rgba(156,163,175,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                }}>
                  {activity.type === "競賽" ? "🏆" : activity.type === "工作坊" ? "💻" : "🎊"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{activity.name}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{activity.date}</div>
                </div>
                <span className="pill" style={{
                  fontSize: 12,
                  background: 
                    activity.status === "已參加" ? "rgba(16,185,129,0.2)" :
                    activity.status === "已報名" ? "rgba(139,92,246,0.2)" :
                    "var(--panel)",
                  color: 
                    activity.status === "已參加" ? "#10B981" :
                    activity.status === "已報名" ? "#8B5CF6" :
                    "var(--muted)",
                }}>
                  {activity.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "achievements" && (
        <div className="card">
          <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 700 }}>🏆 成就徽章</h2>

          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
            gap: 16 
          }}>
            {achievements.map((achievement) => (
              <div
                key={achievement.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: 16,
                  background: "var(--panel2)",
                  borderRadius: 12,
                  gap: 16,
                }}
              >
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  background: "linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}>
                  {achievement.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{achievement.name}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                    {achievement.description}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--brand)" }}>
                    🗓️ {achievement.date}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Locked Achievements */}
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--muted)" }}>
              🔒 待解鎖成就
            </h3>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", 
              gap: 16 
            }}>
              {[
                { icon: "🎓", name: "畢業在即", description: "完成所有畢業學分" },
                { icon: "🏅", name: "全能學生", description: "學業、活動、服務三滿分" },
                { icon: "📖", name: "書蟲", description: "圖書館借閱達 100 本" },
              ].map((achievement) => (
                <div
                  key={achievement.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: 16,
                    background: "var(--panel2)",
                    borderRadius: 12,
                    gap: 16,
                    opacity: 0.5,
                  }}
                >
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    background: "var(--panel)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    filter: "grayscale(100%)",
                  }}>
                    {achievement.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{achievement.name}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      {achievement.description}
                    </div>
                  </div>
                  <span style={{ fontSize: 20 }}>🔒</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SiteShell>
  );
}
