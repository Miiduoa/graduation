import { SiteShell } from "@/components/SiteShell";
import Link from "next/link";
import { resolveSchool } from "@campus/shared/src/schools";

export default function HomePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;

  const features = [
    { icon: "📢", label: "公告", href: `/announcements${q}`, desc: "重要通知一手掌握", color: "#8B5CF6" },
    { icon: "🎉", label: "活動", href: `/clubs${q}`, desc: "探索精彩校園活動", color: "#10B981" },
    { icon: "🗺️", label: "地圖", href: `/map${q}`, desc: "校園導航與地點資訊", color: "#3B82F6" },
    { icon: "🍽️", label: "餐廳", href: `/cafeteria${q}`, desc: "今日菜單與美食推薦", color: "#F59E0B" },
    { icon: "📚", label: "圖書館", href: `/library${q}`, desc: "借閱管理與座位預約", color: "#06B6D4" },
    { icon: "🚌", label: "公車", href: `/bus${q}`, desc: "即時動態與時刻表", color: "#22C55E" },
    { icon: "📊", label: "成績", href: `/grades${q}`, desc: "成績查詢與GPA統計", color: "#EF4444" },
    { icon: "👥", label: "群組", href: `/groups${q}`, desc: "課程討論與社團活動", color: "#EC4899" },
    { icon: "📅", label: "課表", href: `/timetable${q}`, desc: "課程安排一目了然", color: "#F97316" },
    { icon: "👤", label: "個人", href: `/profile${q}`, desc: "管理個人檔案設定", color: "#6366F1" },
  ];

  const quickStats = [
    { value: "3", label: "今日公告", icon: "📋" },
    { value: "5", label: "進行中活動", icon: "🎭" },
    { value: "12", label: "餐廳營業中", icon: "🍜" },
    { value: "24°C", label: "校園氣溫", icon: "🌤️" },
  ];

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title={`歡迎來到 ${school.name}`}
      subtitle="智慧校園一站式平台 · 資訊整合 · 便捷生活"
    >
      <div
        className="card"
        style={{
          marginBottom: 24,
          background: "linear-gradient(140deg, #7C5CFF 0%, #5B7CFF 55%, #22D3EE 100%)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 12, opacity: 0.9, letterSpacing: 1.2, marginBottom: 8 }}>CAMPUS DASHBOARD</div>
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>今天的校園資訊，在一個畫面看完</h2>
            <p style={{ marginTop: 10, marginBottom: 0, opacity: 0.92 }}>
              一眼掌握公告、活動、餐廳與課表，先做決策，再深入細節。
            </p>
          </div>
          <div style={{ display: "grid", gap: 10, minWidth: 220 }}>
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.18)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 13 }}>{stat.label}</span>
                <strong style={{ fontSize: 18 }}>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 18 }}>核心功能</h3>
        <div className="grid-4">
          {features.slice(0, 8).map((f) => (
            <Link
              key={f.label}
              href={f.href}
              className="card"
              style={{
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: 16,
                borderLeft: `4px solid ${f.color}`,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{f.label}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{f.desc}</div>
              </div>
              <div style={{ fontSize: 22 }}>{f.icon}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>最新動態</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              { title: "期中考週圖書館延長開放", time: "2 小時前", tag: "學術" },
              { title: "校慶運動會報名開始", time: "5 小時前", tag: "活動" },
              { title: "新學期停車證申請公告", time: "1 天前", tag: "行政" },
            ].map((item, idx) => (
              <div key={idx} style={{ padding: 12, borderRadius: 10, background: "var(--panel2)" }}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>{item.time} · {item.tag}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>快速動作</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {[
              { label: "全站搜尋", href: `/search${q}` },
              { label: "設定中心", href: `/settings${q}` },
              { label: "我的成績", href: `/grades${q}` },
              { label: "個人檔案", href: `/profile${q}` },
            ].map((action) => (
              <Link key={action.label} href={action.href} className="btn" style={{ textAlign: "center" }}>
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
