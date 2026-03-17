import type { CSSProperties } from "react";
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
    { code: "01", label: "公告", href: `/announcements${q}`, desc: "重要通知與校務更新集中整理。", metric: "3 則待看", accent: "#6D7CFF" },
    { code: "02", label: "活動", href: `/clubs${q}`, desc: "探索社團招募、校慶與近期活動。", metric: "5 場進行中", accent: "#43C2A5" },
    { code: "03", label: "地圖", href: `/map${q}`, desc: "快速找到教室、行政單位與常用地點。", metric: "12 個收藏", accent: "#53A7FF" },
    { code: "04", label: "餐廳", href: `/cafeteria${q}`, desc: "今日菜單、時段與人氣選項一屏掌握。", metric: "12 間營業", accent: "#F3A55B" },
    { code: "05", label: "圖書館", href: `/library${q}`, desc: "借閱、預約與空位資訊同時整理。", metric: "64 席可用", accent: "#52C6D3" },
    { code: "06", label: "公車", href: `/bus${q}`, desc: "即時班距與校園接駁狀態更清楚。", metric: "8 分到站", accent: "#57C48C" },
    { code: "07", label: "成績", href: `/grades${q}`, desc: "成績查詢、GPA 與學期趨勢快速查看。", metric: "GPA 3.82", accent: "#F27384" },
    { code: "08", label: "群組", href: `/groups${q}`, desc: "課程討論與社團交流整合成一個節點。", metric: "2 則未讀", accent: "#E07FE5" },
    { code: "09", label: "課表", href: `/timetable${q}`, desc: "今天的節次與下一堂課直接置頂。", metric: "14:10 下一堂", accent: "#F18A5B" },
    { code: "10", label: "個人", href: `/profile${q}`, desc: "個人資料、偏好與設定統一管理。", metric: "已同步", accent: "#7E8DFF" },
  ];

  const quickStats = [
    { value: "03", label: "今日公告", meta: "2 則重要", tone: "Live" },
    { value: "05", label: "進行中活動", meta: "校慶週持續中", tone: "Flow" },
    { value: "12", label: "餐廳營業中", meta: "尖峰時段 12:00", tone: "Food" },
  ];
  const updates = [
    { title: "期中考週圖書館延長開放", time: "2 小時前", tag: "學術", body: "自習區延長至 23:00，夜間入口改由後門進出。" },
    { title: "校慶運動會報名開始", time: "5 小時前", tag: "活動", body: "田徑與趣味競賽同步開放登記，社團可報名攤位。" },
    { title: "新學期停車證申請公告", time: "1 天前", tag: "行政", body: "申請時段延長至週五，資料檢核採線上完成。" },
  ];
  const supportFeatures = features.slice(8);
  const primaryFeatures = features.slice(0, 8);
  const quickActions = [
    { label: "全站搜尋", href: `/search${q}` },
    { label: "設定中心", href: `/settings${q}` },
    { label: "我的成績", href: `/grades${q}` },
    { label: "個人檔案", href: `/profile${q}` },
  ];

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title={`歡迎回到 ${school.name}`}
      subtitle="用更安靜、更柔和的卡片層次，把校園資訊整理成一個易讀的控制台。"
    >
      <div className="homePage">
        <section className="homeHero">
          <div className="homeHeroCopy">
            <span className="homeEyebrow">Campus Flow</span>
            <h2 className="homeTitle">今天的校園資訊，應該像 iPhone 主畫面一樣乾淨。</h2>
            <p className="homeBody">
              以更柔和的卡片層次整理公告、活動、地圖與生活資訊。先用一個畫面理解今天的節奏，再進入細節處理每一件事。
            </p>
            <div className="homeHeroActions">
              <Link href={`/search${q}`} className="btn primary">
                立即開始
              </Link>
              <Link href={`/timetable${q}`} className="btn">
                查看今日日程
              </Link>
            </div>
          </div>

          <div className="homeStatDeck">
            {quickStats.map((stat) => (
              <div key={stat.label} className="homeStatCard">
                <div className="homeStatHeader">
                  <span className="homeStatLabel">{stat.label}</span>
                  <span className="homeStatTone">{stat.tone}</span>
                </div>
                <div className="homeStatValue">{stat.value}</div>
                <div className="homeStatMeta">{stat.meta}</div>
              </div>
            ))}

            <div className="homePulseCard">
              <div className="homePulseLabel">Now Playing</div>
              <div className="homePulseTitle">14:10 課表提醒已預備</div>
              <p className="homePulseText">
                下一堂課、熱門餐廳與公告優先順序已經在同一層卡片整理完成。
              </p>
            </div>
          </div>
        </section>

        <section className="homeSection">
          <div className="homeSectionHeader">
            <div>
              <h3 className="homeSectionTitle">核心功能</h3>
              <div className="homeSectionNote">以柔和分層、圓角卡片與色塊焦點重排常用入口。</div>
            </div>
            <span className="pill subtle">8 個主要模組</span>
          </div>

          <div className="homeFeatureGrid">
            {primaryFeatures.map((feature) => (
              <Link
                key={feature.label}
                href={feature.href}
                className="card featureCard"
                style={{ "--feature-accent": feature.accent } as CSSProperties}
              >
                <div>
                  <div className="featureTop">
                    <span className="featureBadge">{feature.code}</span>
                    <span className="featureTag">Focus</span>
                  </div>
                  <h4 className="featureLabel">{feature.label}</h4>
                  <p className="featureDesc">{feature.desc}</p>
                </div>
                <div className="featureFoot">
                  <span className="featureMetric">{feature.metric}</span>
                  <span>打開模組</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="homeColumns">
          <div className="card homePanel">
            <div className="homePanelHeader">
              <div>
                <h3 className="homePanelTitle">最新動態</h3>
                <p className="homePanelSubtitle">保留最重要的三件事，讓資訊更像通知摘要而不是列表堆疊。</p>
              </div>
              <span className="pill">Today</span>
            </div>

            <div className="activityTimeline">
              {updates.map((item) => (
                <article key={item.title} className="activityItem">
                  <div className="activityMeta">
                    <span>{item.time}</span>
                    <span className="activityTag">{item.tag}</span>
                  </div>
                  <h4 className="activityTitle">{item.title}</h4>
                  <p className="activityBody">{item.body}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="homePanel" style={{ gap: 18 }}>
            <div className="card homePanel">
              <div className="homePanelHeader">
                <div>
                  <h3 className="homePanelTitle">快速動作</h3>
                  <p className="homePanelSubtitle">常用操作改成更像 iOS 快捷指令的膠囊按鈕。</p>
                </div>
              </div>
              <div className="quickActionGrid">
                {quickActions.map((action) => (
                  <Link key={action.label} href={action.href} className="btn">
                    <span>{action.label}</span>
                    <span>→</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="card homePanel">
              <div className="homePanelHeader">
                <div>
                  <h3 className="homePanelTitle">今日節奏</h3>
                  <p className="homePanelSubtitle">將最值得注意的狀態濃縮成三個簡潔的卡片指標。</p>
                </div>
              </div>
              <div className="homeInsightGrid">
                <div className="homeInsightRow">
                  <span className="homeInsightLabel">校園氣溫</span>
                  <span className="homeInsightValue">24°C</span>
                </div>
                <div className="homeInsightRow">
                  <span className="homeInsightLabel">下一班接駁</span>
                  <span className="homeInsightValue">8 分鐘</span>
                </div>
                <div className="homeInsightRow">
                  <span className="homeInsightLabel">圖書館空位</span>
                  <span className="homeInsightValue">64 席</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="compactFeatureRail">
          {supportFeatures.map((feature) => (
            <Link
              key={feature.label}
              href={feature.href}
              className="card compactFeatureCard"
              style={{ "--feature-accent": feature.accent } as CSSProperties}
            >
              <div className="compactFeatureCopy">
                <h3 className="compactFeatureTitle">{feature.label}</h3>
                <p className="compactFeatureText">{feature.desc}</p>
                <span className="featureMetric">{feature.metric}</span>
              </div>
              <span className="compactFeatureAccent">{feature.code}</span>
            </Link>
          ))}
        </section>
      </div>
    </SiteShell>
  );
}
