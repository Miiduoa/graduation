"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  fetchAnnouncements,
  fetchGPA,
  getAuth,
  isFirebaseConfigured,
  type Announcement,
} from "@/lib/firebase";
import { mockAnnouncements } from "@campus/shared/src/mockData";

function formatGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "早安";
  if (hour < 18) return "午安";
  return "晚上好";
}

export default function HomePage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolId, schoolCode, schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [user, setUser] = useState<User | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [gpa, setGpa] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

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
      setLoading(true);
      try {
        if (isFirebaseConfigured()) {
          const [nextAnnouncements, nextGpa] = await Promise.all([
            fetchAnnouncements(schoolId, 4),
            user ? fetchGPA(user.uid) : Promise.resolve(null),
          ]);

          if (!active) return;
          setAnnouncements((nextAnnouncements.length > 0 ? nextAnnouncements : mockAnnouncements.slice(0, 4)) as Announcement[]);
          setGpa(nextGpa?.cumulative ?? null);
        } else {
          if (!active) return;
          setAnnouncements(mockAnnouncements.slice(0, 4) as Announcement[]);
        }
      } catch {
        if (!active) return;
        setAnnouncements(mockAnnouncements.slice(0, 4) as Announcement[]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [schoolId, user]);

  const userLabel = user?.displayName?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "訪客";
  const importantAnnouncements = useMemo(
    () => announcements.filter((announcement) => announcement.pinned || announcement.title.includes("重要")).length,
    [announcements]
  );

  const roleCards = [
    {
      title: "Today",
      description: "先看今天最重要的一步，而不是先看功能表。",
      accent: "var(--brand)",
    },
    {
      title: "課程",
      description: "把教材、作業、測驗、點名與成績收回同一條課程主流程。",
      accent: "var(--info)",
    },
    {
      title: "校園",
      description: "地圖、公車、餐廳與支援服務留在校園，不打斷主學習流程。",
      accent: "var(--achievement)",
    },
    {
      title: "收件匣",
      description: "每筆更新都直接對應到下一步，而不是只顯示通知。",
      accent: "var(--warning)",
    },
  ];

  if (!user) {
    return (
      <SiteShell schoolName={schoolName} schoolCode={schoolCode}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              background: "linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(37,99,235,0.08) 100%)",
              display: "grid",
              gap: 18,
            }}
          >
            <span className="pill brand">Campus Learning OS</span>
            <div>
              <h1 className="h1" style={{ marginBottom: 10 }}>
                不再是校園功能列表，而是今日學習與校園節奏的操作台
              </h1>
              <p className="sub" style={{ marginTop: 0 }}>
                從 Today 開始，依序進入課程、校園、收件匣與我的。先降低認知負荷，再疊加信任感與黏著感。
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/login${q}`} className="btn primary">
                登入開始
              </Link>
              <Link href={`/join${q}`} className="btn">
                選擇學校
              </Link>
              <Link href={`/announcements${q}`} className="btn">
                先看公告
              </Link>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {roleCards.map((card) => (
              <div key={card.title} className="card">
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 16,
                    background: `${card.accent}20`,
                    marginBottom: 14,
                  }}
                />
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{card.title}</div>
                <div style={{ color: "var(--muted)", lineHeight: 1.7, fontSize: 14 }}>{card.description}</div>
              </div>
            ))}
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={schoolName}
      schoolCode={schoolCode}
      title={`${formatGreeting()}，${userLabel}`}
      subtitle="Today 只保留下一步、課程節奏與校園情境，不再把首頁做成功能總表。"
    >
      <div className="pageStack">
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, rgba(15,139,141,0.12) 0%, rgba(8,145,178,0.08) 100%)",
            display: "grid",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 760 }}>
              <div className="pageHeadEyebrow" style={{ marginBottom: 10 }}>Today Dashboard</div>
              <h2 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: "-0.05em" }}>
                先完成今天最重要的一步
              </h2>
              <p className="sub" style={{ marginTop: 10 }}>
                課程、校園與收件匣都在，但首頁只顯示會改變你下一步的內容。
              </p>
            </div>
            <span className="pill brand">{loading ? "整理中…" : `${announcements.length} 則今日更新`}</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/groups${q}`} className="btn primary">
              進入課程
            </Link>
            <Link href={`/map${q}`} className="btn">
              打開校園
            </Link>
            <Link href={`/announcements${q}`} className="btn">
              查看收件匣
            </Link>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {[
            { label: "重要公告", value: importantAnnouncements || announcements.length, tone: "var(--warning)" },
            { label: "累計 GPA", value: gpa != null ? gpa.toFixed(2) : "—", tone: "var(--brand)" },
            { label: "登入身份", value: user.email ? "已登入" : "訪客", tone: "var(--growth)" },
          ].map((item) => (
            <div key={item.label} className="card" style={{ "--tone": item.tone } as CSSProperties}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>{item.label}</div>
              <div style={{ marginTop: 8, fontSize: 30, fontWeight: 900, letterSpacing: "-0.05em", color: item.tone }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
            gap: 16,
          }}
        >
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Today 的下一步</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  只顯示真正會改變你下一步的更新
                </div>
              </div>
              <Link href={`/announcements${q}`} className="btn">
                全部查看
              </Link>
            </div>

            {announcements.map((announcement, index) => (
              <div
                key={announcement.id}
                style={{
                  padding: 16,
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: index === 0 ? "var(--accent-soft)" : "var(--surface)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{announcement.title}</div>
                  <span className={`pill ${index === 0 ? "warning" : "subtle"}`}>
                    {index === 0 ? "先看" : "更新"}
                  </span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.7, marginTop: 8 }}>
                  {announcement.body.slice(0, 110)}...
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>課程骨架</div>
              <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                教材、作業、測驗、點名與成績應該回到同一條課程主流程，而不是散在各頁。
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <span className="pill brand">教材</span>
                <span className="pill">作業</span>
                <span className="pill">測驗</span>
                <span className="pill">點名</span>
              </div>
              <Link href={`/groups${q}`} className="btn" style={{ marginTop: 16 }}>
                打開課程
              </Link>
            </div>

            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>校園情境</div>
              <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                地圖、公車、餐廳與圖書館留在校園分頁，避免高頻課務被生活資訊打斷。
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <Link href={`/map${q}`} className="btn">地圖</Link>
                <Link href={`/cafeteria${q}`} className="btn">餐廳</Link>
                <Link href={`/bus${q}`} className="btn">公車</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
