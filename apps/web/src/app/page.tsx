"use client";

import type { CSSProperties } from "react";
import { SiteShell } from "@/components/SiteShell";
import Link from "next/link";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { useEffect, useState } from "react";
import {
  getAuth,
  fetchAnnouncements,
  fetchGPA,
  isFirebaseConfigured,
  type Announcement,
} from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { mockAnnouncements } from "@campus/shared/src/mockData";

export default function HomePage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);

  const [user, setUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [gpa, setGpa] = useState<number | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const today = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const greeting =
    today.getHours() < 12 ? "早安" : today.getHours() < 18 ? "午安" : "晚安";

  // 監聽 Firebase Auth 狀態
  useEffect(() => {
    const auth = getAuth();
    if (!auth) {
      setLoadingData(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  // 載入公告與 GPA
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingData(true);
      try {
        if (isFirebaseConfigured()) {
          const [anns, gpaData] = await Promise.all([
            fetchAnnouncements(schoolId, 3),
            user ? fetchGPA(user.uid) : Promise.resolve(null),
          ]);
          if (active) {
            setAnnouncements(anns.length > 0 ? anns : mockAnnouncements.slice(0, 3) as Announcement[]);
            setGpa(gpaData?.cumulative ?? null);
          }
        } else {
          if (active) setAnnouncements(mockAnnouncements.slice(0, 3) as Announcement[]);
        }
      } catch {
        if (active) setAnnouncements(mockAnnouncements.slice(0, 3) as Announcement[]);
      } finally {
        if (active) setLoadingData(false);
      }
    }
    load();
    return () => { active = false; };
  }, [schoolId, user]);

  const userName = user?.displayName?.split(" ")[0] ?? user?.email?.split("@")[0] ?? null;
  const announcementCount = announcements.length;

  const features = [
    { code: "01", label: "公告", href: `/announcements${q}`, desc: "重要通知與校務更新。", metric: announcementCount > 0 ? `${announcementCount} 則待看` : "公告中", accent: "#5E6AD2", icon: "📢" },
    { code: "02", label: "活動", href: `/clubs${q}`, desc: "探索社團招募與近期活動。", metric: "探索活動", accent: "#30BFA8", icon: "🎉" },
    { code: "03", label: "地圖", href: `/map${q}`, desc: "快速找到教室與常用地點。", metric: "互動地圖", accent: "#007AFF", icon: "🗺" },
    { code: "04", label: "餐廳", href: `/cafeteria${q}`, desc: "今日菜單與時段一屏掌握。", metric: "查看菜單", accent: "#FF9500", icon: "🍱" },
    { code: "05", label: "圖書館", href: `/library${q}`, desc: "借閱、預約與空位資訊。", metric: "查詢館藏", accent: "#34C759", icon: "📚" },
    { code: "06", label: "公車", href: `/bus${q}`, desc: "即時班距與校園接駁狀態。", metric: "查看時刻", accent: "#32ADE6", icon: "🚌" },
    { code: "07", label: "成績", href: `/grades${q}`, desc: "成績查詢、GPA 與學期趨勢。", metric: gpa != null ? `GPA ${gpa.toFixed(2)}` : "查看成績", accent: "#FF3B30", icon: "📊" },
    { code: "08", label: "群組", href: `/groups${q}`, desc: "課程討論與社團交流整合。", metric: "加入討論", accent: "#BF5AF2", icon: "💬" },
    { code: "09", label: "課表", href: `/timetable${q}`, desc: "今天的節次與下一堂課。", metric: "查看課表", accent: "#FF6B35", icon: "📅" },
    { code: "10", label: "個人", href: `/profile${q}`, desc: "個人資料、偏好與設定統一管理。", metric: user ? "已登入" : "登入帳號", accent: "#5E6AD2", icon: "👤" },
  ];

  const updates = announcements.length > 0
    ? announcements.map((a, i) => ({
        tag: a.category === "academic" ? "學術" : a.category === "event" ? "課外" : "校園",
        time: a.publishedAt ? new Date(a.publishedAt).toLocaleDateString("zh-TW", { month: "short", day: "numeric" }) : "最新",
        title: a.title,
        body: a.body.slice(0, 80) + (a.body.length > 80 ? "..." : ""),
      }))
    : [
        { tag: "校園", time: "最新", title: "歡迎使用校園 App", body: "連接 Firebase 後即可看到即時公告。目前顯示示範內容。" },
      ];

  return (
    <SiteShell schoolName={schoolName}>
      <div className="homePage">
        {/* ── Greeting Hero ── */}
        <div
          className="card"
          style={{
            padding: "24px 28px",
            background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
            border: "none",
            color: "#fff",
            boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.75, fontWeight: 600 }}>
                {today.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
              </p>
              <h1 style={{ margin: "0 0 6px", fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, letterSpacing: "-0.04em" }}>
                {greeting}，{userName ? `${userName} 👋` : "歡迎回來 👋"}
              </h1>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
                今天是星期{weekdays[today.getDay()]}
                {announcementCount > 0 ? `，您有 ${announcementCount} 則待讀公告` : "，祝您學習順利"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href={`/timetable${q}`}
                style={{ padding: "10px 18px", borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.22)", color: "#fff", fontSize: 13, fontWeight: 700, border: "1px solid rgba(255,255,255,0.3)", backdropFilter: "blur(8px)", whiteSpace: "nowrap" }}
              >
                查看課表 →
              </Link>
            </div>
          </div>
        </div>

        {/* ── Quick Stats ── */}
        <div className="metricGrid">
          {[
            { label: "未讀公告", value: announcementCount > 0 ? `${announcementCount} 則` : "—", icon: "📢", accent: "#FF9500" },
            { label: "GPA", value: gpa != null ? gpa.toFixed(2) : "—", icon: "📊", accent: "#FF3B30" },
            { label: "圖書館", value: "查詢座位", icon: "📚", accent: "#34C759" },
            { label: "帳號狀態", value: user ? "已登入" : "訪客", icon: "👤", accent: "#5E6AD2" },
          ].map((s) => (
            <div key={s.label} className="metricCard" style={{ "--tone": s.accent } as CSSProperties}>
              <div className="metricIcon">{s.icon}</div>
              <div className="metricValue">{s.value}</div>
              <div className="metricLabel">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Feature Grid ── */}
        <div className="homeSection">
          <div className="homeSectionHeader">
            <h2 className="homeSectionTitle">所有功能</h2>
            <span className="homeSectionNote">{features.length} 個模組</span>
          </div>
          <div className="homeFeatureGrid">
            {features.map((f) => (
              <Link key={f.code} href={f.href} className="featureCard card" style={{ "--feature-accent": f.accent } as CSSProperties}>
                <div className="featureTop">
                  <div className="featureBadge" style={{ fontSize: 22 }}>{f.icon}</div>
                  <span className="featureTag">{f.code}</span>
                </div>
                <div>
                  <h3 className="featureLabel">{f.label}</h3>
                  <p className="featureDesc">{f.desc}</p>
                </div>
                <div className="featureFoot">
                  <span className="featureMetric">{f.metric}</span>
                  <span>→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Bottom Section: Updates + Quick Actions ── */}
        <div className="homeColumns">
          {/* Latest Updates */}
          <div className="homePanel">
            <div className="homePanelHeader">
              <div>
                <h2 className="homePanelTitle">最新動態</h2>
                <p className="homePanelSubtitle">{loadingData ? "載入中..." : "校園最新消息與通知"}</p>
              </div>
              <Link href={`/announcements${q}`} style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600 }}>
                查看全部
              </Link>
            </div>
            <div className="activityTimeline">
              {updates.map((u, i) => (
                <div key={i} className="activityItem">
                  <div className="activityMeta">
                    <span className="activityTag">{u.tag}</span>
                    <span>{u.time}</span>
                  </div>
                  <h3 className="activityTitle">{u.title}</h3>
                  <p className="activityBody">{u.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions + Insights */}
          <div className="homePanel">
            <div className="homePanelHeader">
              <h2 className="homePanelTitle">快速動作</h2>
            </div>
            <div className="quickActionGrid">
              {[
                { label: "🔍 搜尋課程", href: `/search${q}` },
                { label: "📖 借閱查詢", href: `/library${q}` },
                { label: "🚌 公車時刻", href: `/bus${q}` },
                { label: "🍱 今日菜單", href: `/cafeteria${q}` },
              ].map((a) => (
                <Link key={a.href} href={a.href} className="btn" style={{ fontSize: 13 }}>
                  {a.label}
                </Link>
              ))}
            </div>

            <div style={{ marginTop: 8 }}>
              <div className="homePanelHeader">
                <h2 className="homePanelTitle">帳號資訊</h2>
              </div>
              <div className="homeInsightGrid">
                {[
                  { label: "登入狀態", value: user ? "已登入" : "未登入" },
                  { label: "帳號", value: user?.email?.split("@")[0] ?? "—" },
                  { label: "GPA", value: gpa != null ? gpa.toFixed(2) : "—" },
                  { label: "公告數量", value: announcementCount > 0 ? `${announcementCount} 則` : "—" },
                ].map((r) => (
                  <div key={r.label} className="homeInsightRow">
                    <span className="homeInsightLabel">{r.label}</span>
                    <span className="homeInsightValue">{r.value}</span>
                  </div>
                ))}
              </div>
              {!user && (
                <div style={{ marginTop: 12 }}>
                  <Link href={`/login${q}`} className="btn" style={{ fontSize: 13, display: "block", textAlign: "center" }}>
                    🔐 登入帳號
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
