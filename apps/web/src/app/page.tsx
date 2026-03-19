import type { CSSProperties } from "react";
import { SiteShell } from "@/components/SiteShell";
import Link from "next/link";
import { resolveSchoolPageContext } from "@/lib/pageContext";

export default function HomePage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { school, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);

  const features = [
    {
      code: "01",
      label: "公告",
      href: `/announcements${q}`,
      desc: "重要通知與校務更新。",
      metric: "3 則待看",
      accent: "#5E6AD2",
      icon: "📢",
    },
    {
      code: "02",
      label: "活動",
      href: `/clubs${q}`,
      desc: "探索社團招募與近期活動。",
      metric: "5 場進行中",
      accent: "#30BFA8",
      icon: "🎉",
    },
    {
      code: "03",
      label: "地圖",
      href: `/map${q}`,
      desc: "快速找到教室與常用地點。",
      metric: "12 個收藏",
      accent: "#007AFF",
      icon: "🗺",
    },
    {
      code: "04",
      label: "餐廳",
      href: `/cafeteria${q}`,
      desc: "今日菜單與時段一屏掌握。",
      metric: "12 間營業",
      accent: "#FF9500",
      icon: "🍱",
    },
    {
      code: "05",
      label: "圖書館",
      href: `/library${q}`,
      desc: "借閱、預約與空位資訊。",
      metric: "64 席可用",
      accent: "#34C759",
      icon: "📚",
    },
    {
      code: "06",
      label: "公車",
      href: `/bus${q}`,
      desc: "即時班距與校園接駁狀態。",
      metric: "8 分到站",
      accent: "#32ADE6",
      icon: "🚌",
    },
    {
      code: "07",
      label: "成績",
      href: `/grades${q}`,
      desc: "成績查詢、GPA 與學期趨勢。",
      metric: "GPA 3.82",
      accent: "#FF3B30",
      icon: "📊",
    },
    {
      code: "08",
      label: "群組",
      href: `/groups${q}`,
      desc: "課程討論與社團交流整合。",
      metric: "2 則未讀",
      accent: "#BF5AF2",
      icon: "💬",
    },
    {
      code: "09",
      label: "課表",
      href: `/timetable${q}`,
      desc: "今天的節次與下一堂課。",
      metric: "14:10 下一堂",
      accent: "#FF6B35",
      icon: "📅",
    },
    {
      code: "10",
      label: "個人",
      href: `/profile${q}`,
      desc: "個人資料、偏好與設定統一管理。",
      metric: "已同步",
      accent: "#5E6AD2",
      icon: "👤",
    },
  ];

  const quickStats = [
    { label: "今日課程", value: "3 節", icon: "📅", accent: "#5E6AD2" },
    { label: "未讀公告", value: "3 則", icon: "📢", accent: "#FF9500" },
    { label: "座位可用", value: "64 席", icon: "📚", accent: "#34C759" },
    { label: "GPA", value: "3.82", icon: "📊", accent: "#FF3B30" },
  ];

  const updates = [
    {
      tag: "學術",
      time: "10 分鐘前",
      title: "期末考試時間表已公布",
      body: "113 學年度第二學期期末考試將於 6 月 17 日至 23 日舉行，請同學提前安排複習計畫。",
    },
    {
      tag: "課外",
      time: "2 小時前",
      title: "學生會徵才開跑",
      body: "學生自治會誠摯邀請對校園事務有熱情的同學加入，報名截止日為本月底。",
    },
    {
      tag: "設施",
      time: "昨天",
      title: "圖書館延長開放時間",
      body: "考試週期間圖書館將延長至凌晨一點，並增設安靜閱讀區供同學使用。",
    },
  ];

  const today = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const greeting =
    today.getHours() < 12 ? "早安" : today.getHours() < 18 ? "午安" : "晚安";

  return (
    <SiteShell schoolName={school || undefined}>
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <p
                style={{
                  margin: "0 0 4px",
                  fontSize: 12,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  opacity: 0.75,
                  fontWeight: 600,
                }}
              >
                {today.toLocaleDateString("zh-TW", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  weekday: "short",
                })}
              </p>
              <h1
                style={{
                  margin: "0 0 6px",
                  fontSize: "clamp(22px, 4vw, 28px)",
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                }}
              >
                {greeting}，歡迎回來 👋
              </h1>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
                今天是星期{weekdays[today.getDay()]}，您有 3 堂課程與 3 則待讀公告
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href={`/timetable${q}`}
                style={{
                  padding: "10px 18px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.22)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  border: "1px solid rgba(255,255,255,0.3)",
                  backdropFilter: "blur(8px)",
                  whiteSpace: "nowrap",
                }}
              >
                查看課表 →
              </Link>
            </div>
          </div>
        </div>

        {/* ── Quick Stats ── */}
        <div className="metricGrid">
          {quickStats.map((s) => (
            <div key={s.label} className="metricCard" style={{ "--tone": s.accent } as CSSProperties}>
              <div className="metricIcon">{s.icon}</div>
              <div className="metricValue">{s.value}</div>
              <div className="metricLabel">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Next Class Alert ── */}
        <div className="homePulseCard">
          <div className="homePulseLabel">⏰ 下一堂課程</div>
          <h2 className="homePulseTitle">資料結構與演算法</h2>
          <p className="homePulseText">
            今天 14:10 · 工程館 302 教室 · 王大明 教授
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Link
              href={`/map${q}`}
              style={{
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(94,106,210,0.14)",
                color: "var(--brand)",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid rgba(94,106,210,0.2)",
              }}
            >
              🗺 帶我去教室
            </Link>
            <Link
              href={`/timetable${q}`}
              style={{
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                color: "var(--muted)",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid var(--border)",
              }}
            >
              查看完整課表
            </Link>
          </div>
        </div>

        {/* ── Feature Grid ── */}
        <div className="homeSection">
          <div className="homeSectionHeader">
            <h2 className="homeSectionTitle">所有功能</h2>
            <span className="homeSectionNote">{features.length} 個模組</span>
          </div>
          <div className="homeFeatureGrid">
            {features.map((f) => (
              <Link
                key={f.code}
                href={f.href}
                className="featureCard card"
                style={
                  {
                    "--feature-accent": f.accent,
                  } as CSSProperties
                }
              >
                <div className="featureTop">
                  <div
                    className="featureBadge"
                    style={{ fontSize: 22 }}
                  >
                    {f.icon}
                  </div>
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
                <p className="homePanelSubtitle">校園最新消息與通知</p>
              </div>
              <Link
                href={`/announcements${q}`}
                style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600 }}
              >
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
                <h2 className="homePanelTitle">今日摘要</h2>
              </div>
              <div className="homeInsightGrid">
                {[
                  { label: "今日上課", value: "3 節" },
                  { label: "圖書館可用座位", value: "64 席" },
                  { label: "下班公車", value: "8 分鐘" },
                  { label: "本學期學分", value: "18 學分" },
                ].map((r) => (
                  <div key={r.label} className="homeInsightRow">
                    <span className="homeInsightLabel">{r.label}</span>
                    <span className="homeInsightValue">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
