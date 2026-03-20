"use client";

import { useState, useEffect } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  getAuth,
  fetchGroups,
  joinGroup,
  leaveGroup,
  checkGroupMembership,
  isFirebaseConfigured,
  type Group,
} from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

interface Club {
  id: string;
  name: string;
  category: string;
  members: number;
  nextEvent?: string;
  nextEventDate?: string;
  description: string;
  color: string;
  icon: string;
  isJoined: boolean;
}

const CLUB_COLORS = ["#5E6AD2", "#BF5AF2", "#34C759", "#FF9500", "#FF3B30", "#007AFF", "#32ADE6", "#FF6B35"];
const CLUB_ICONS = ["💻", "📷", "⛰️", "🚀", "🎻", "🏓", "🎨", "🎵"];

const MOCK_CLUBS: Club[] = [
  { id: "1", name: "程式設計社", category: "學術", members: 120, nextEvent: "黑客松", nextEventDate: "近期", description: "分享程式技術，舉辦競賽與 side project 工作坊", color: "#5E6AD2", icon: "💻", isJoined: false },
  { id: "2", name: "攝影社", category: "藝術", members: 88, nextEvent: "春季外拍", nextEventDate: "近期", description: "攝影技巧分享與校園及戶外拍攝活動", color: "#BF5AF2", icon: "📷", isJoined: false },
  { id: "3", name: "登山社", category: "運動", members: 65, nextEvent: "雪山健行", nextEventDate: "近期", description: "台灣各大名山探訪，培養野外體能與生態知識", color: "#34C759", icon: "⛰️", isJoined: false },
  { id: "4", name: "創業研究社", category: "學術", members: 52, nextEvent: "創業沙龍", nextEventDate: "近期", description: "創業理念交流、商業計畫書撰寫與投資人對接", color: "#FF9500", icon: "🚀", isJoined: false },
  { id: "5", name: "管弦樂社", category: "藝術", members: 78, nextEvent: "春季音樂會", nextEventDate: "近期", description: "弦樂與管樂交流，每學期舉辦正式演奏會", color: "#FF3B30", icon: "🎻", isJoined: false },
  { id: "6", name: "桌球社", category: "運動", members: 43, nextEvent: "社際盃", nextEventDate: "近期", description: "每週固定練習，積極參與校際桌球競賽", color: "#007AFF", icon: "🏓", isJoined: false },
];

const CATEGORIES = ["全部", "課程", "社團", "學術", "藝術", "運動"];

function mapGroupToClub(g: Group, idx: number, joinedIds: Set<string>): Club {
  const categoryMap: Record<string, string> = {
    course: "課程", club: "社團", study: "學術",
  };
  return {
    id: g.id,
    name: g.name,
    category: categoryMap[g.type ?? "club"] ?? "社團",
    members: g.memberCount ?? 0,
    description: g.description ?? "加入群組參與討論",
    color: CLUB_COLORS[idx % CLUB_COLORS.length],
    icon: CLUB_ICONS[idx % CLUB_ICONS.length],
    isJoined: joinedIds.has(g.id),
  };
}

export default function ClubsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolId, schoolName } = resolveSchoolPageContext(props.searchParams);
  const [category, setCategory] = useState("全部");
  const [clubs, setClubs] = useState<Club[]>(MOCK_CLUBS);
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [usingDemo, setUsingDemo] = useState(true);

  // 監聽 Firebase Auth
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 載入 Firebase 群組資料
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setClubs(MOCK_CLUBS);
      setUsingDemo(true);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const groups = await fetchGroups(schoolId, 30);
        if (!active) return;
        if (groups.length > 0) {
          // 查詢用戶已加入的群組
          const joinedIds = new Set<string>();
          if (user) {
            const checks = await Promise.all(
              groups.map((g) => checkGroupMembership(g.id, user.uid))
            );
            groups.forEach((g, i) => {
              if (checks[i].isMember) joinedIds.add(g.id);
            });
          }
          setClubs(groups.map((g, i) => mapGroupToClub(g, i, joinedIds)));
          setUsingDemo(false);
        } else {
          setClubs(MOCK_CLUBS);
          setUsingDemo(true);
        }
      } catch {
        if (active) { setClubs(MOCK_CLUBS); setUsingDemo(true); }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [schoolId, user]);

  const filtered = clubs.filter(
    (c) =>
      (category === "全部" || c.category === category) &&
      (!search || c.name.includes(search) || c.description.includes(search))
  );

  const toggleJoin = async (id: string) => {
    if (!user || usingDemo) {
      // Demo 模式：只更新本地狀態
      setClubs((prev) => prev.map((c) => c.id === id ? { ...c, isJoined: !c.isJoined } : c));
      return;
    }
    setJoiningId(id);
    const club = clubs.find((c) => c.id === id);
    try {
      if (club?.isJoined) {
        await leaveGroup(id, user.uid);
      } else {
        await joinGroup(id, user.uid, user.displayName ?? undefined);
      }
      setClubs((prev) => prev.map((c) => c.id === id ? { ...c, isJoined: !c.isJoined, members: c.isJoined ? c.members - 1 : c.members + 1 } : c));
    } catch (err) {
      console.error("Join/leave group failed:", err);
    } finally {
      setJoiningId(null);
    }
  };

  const joined = clubs.filter((c) => c.isJoined);

  return (
    <SiteShell title="社團活動" subtitle="探索校園活動與社團" schoolName={schoolName}>
      <div className="pageStack">
        {usingDemo && (
          <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13, color: "var(--text)" }}>
            ⚠️ 目前顯示示範資料。{!user ? "請登入帳號" : "Firebase 尚未設定或無社團資料"}。{loading && "載入中..."}
          </div>
        )}

        {/* ── My Clubs ── */}
        {joined.length > 0 && (
          <div className="sectionCard">
            <h3 className="sectionTitle">⭐ 我加入的社團</h3>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
              {joined.map((c) => (
                <div key={c.id} style={{ flexShrink: 0, width: 140, borderRadius: "var(--radius)", background: "var(--surface)", border: "1px solid var(--border)", padding: "16px 14px", boxShadow: "var(--shadow-sm)", textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                  {c.nextEvent && (
                    <div style={{ fontSize: 11, color: c.color, marginTop: 4, fontWeight: 600 }}>
                      {c.nextEvent} {c.nextEventDate}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <input
              className="input"
              type="search"
              placeholder="搜尋社團…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 42 }}
            />
          </div>
          <div className="segmentedGroup">
            {CATEGORIES.filter((cat) => cat === "全部" || clubs.some((c) => c.category === cat)).map((c) => (
              <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* ── Club Grid ── */}
        <div className="grid-2">
          {filtered.map((c) => (
            <div key={c.id} className="card" style={{ borderTop: `3px solid ${c.color}`, padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 28 }}>{c.icon}</div>
                <span style={{ fontSize: 10, padding: "3px 9px", borderRadius: "999px", background: `${c.color}14`, color: c.color, fontWeight: 700, letterSpacing: "0.06em" }}>
                  {c.category}
                </span>
              </div>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>{c.name}</h3>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{c.description}</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  👥 {c.members > 0 ? `${c.members} 人` : "—"}
                  {c.nextEvent && <span style={{ marginLeft: 6, color: c.color, fontWeight: 600 }}>· {c.nextEvent}</span>}
                </div>
                <button
                  onClick={() => toggleJoin(c.id)}
                  disabled={joiningId === c.id}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid",
                    borderColor: c.isJoined ? "var(--border)" : c.color,
                    background: c.isJoined ? "var(--panel)" : `${c.color}14`,
                    color: c.isJoined ? "var(--muted)" : c.color,
                    fontSize: 12, fontWeight: 700, cursor: joiningId === c.id ? "wait" : "pointer", transition: "all 0.15s ease",
                    opacity: joiningId === c.id ? 0.6 : 1,
                  }}
                >
                  {joiningId === c.id ? "處理中..." : c.isJoined ? "已加入" : "加入"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
            找不到符合條件的社團
          </div>
        )}
      </div>
    </SiteShell>
  );
}
