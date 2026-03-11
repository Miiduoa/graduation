"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useAuth } from "@/components/AuthGuard";
import { fetchGroups, fetchGroupPosts, isFirebaseConfigured } from "@/lib/firebase";

type GroupDisplay = {
  id: string;
  name: string;
  type: string;
  memberCount: number;
  newPosts: number;
  lastActivity: string;
  instructor?: string;
  color: string;
};

type RecentPost = {
  group: string;
  author: string;
  content: string;
  time: string;
  replies: number;
};

type GroupTab = "all" | "courses" | "clubs" | "study";

const TYPE_COLORS = ["#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EC4899"];

const DEFAULT_GROUPS: GroupDisplay[] = [
  { id: "1", name: "程式設計 (一)", type: "course", memberCount: 58, newPosts: 3, lastActivity: "5 分鐘前", instructor: "王教授", color: "#8B5CF6" },
  { id: "2", name: "資料結構", type: "course", memberCount: 52, newPosts: 1, lastActivity: "1 小時前", instructor: "李教授", color: "#3B82F6" },
  { id: "3", name: "資工系學會", type: "club", memberCount: 320, newPosts: 5, lastActivity: "30 分鐘前", color: "#10B981" },
  { id: "4", name: "演算法讀書會", type: "study", memberCount: 15, newPosts: 2, lastActivity: "2 小時前", color: "#F59E0B" },
  { id: "5", name: "機器學習研究社", type: "club", memberCount: 89, newPosts: 0, lastActivity: "昨天", color: "#EC4899" },
];

const DEFAULT_POSTS: RecentPost[] = [
  { group: "程式設計 (一)", author: "王同學", content: "作業 3 的第二題有人會嗎？", time: "5 分鐘前", replies: 12 },
  { group: "資工系學會", author: "系學會", content: "期中考週免費咖啡活動開始囉！", time: "30 分鐘前", replies: 28 },
  { group: "演算法讀書會", author: "李同學", content: "這週六下午兩點在圖書館討論室", time: "2 小時前", replies: 5 },
];

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return "剛剛";
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString();
}

export default function GroupsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  
  const { loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<GroupTab>("all");
  const [groups, setGroups] = useState<GroupDisplay[]>(DEFAULT_GROUPS);
  const [recentPosts, setRecentPosts] = useState<RecentPost[]>(DEFAULT_POSTS);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [showJoinModal, setShowJoinModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setGroups(DEFAULT_GROUPS);
      setRecentPosts(DEFAULT_POSTS);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const firebaseGroups = await fetchGroups(school.id);
      
      if (firebaseGroups.length > 0) {
        const converted: GroupDisplay[] = firebaseGroups.map((g, idx) => ({
          id: g.id,
          name: g.name,
          type: g.type || "course",
          memberCount: g.memberCount,
          newPosts: 0,
          lastActivity: formatTimeAgo(g.createdAt),
          color: TYPE_COLORS[idx % TYPE_COLORS.length],
        }));
        setGroups(converted);
        
        if (converted.length > 0) {
          const posts = await fetchGroupPosts(converted[0].id, 5);
          if (posts.length > 0) {
            const convertedPosts: RecentPost[] = posts.map(p => ({
              group: converted.find(g => g.id === p.groupId)?.name ?? "未知群組",
              author: p.authorName ?? "匿名",
              content: p.content.slice(0, 100),
              time: formatTimeAgo(p.createdAt),
              replies: 0,
            }));
            setRecentPosts(convertedPosts);
          }
        }
      } else {
        setGroups(DEFAULT_GROUPS);
        setRecentPosts(DEFAULT_POSTS);
      }
    } catch (error) {
      console.error("Failed to load groups:", error);
      setGroups(DEFAULT_GROUPS);
      setRecentPosts(DEFAULT_POSTS);
    } finally {
      setLoading(false);
    }
  }, [school.id]);

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  const filteredGroups = useMemo(() => {
    if (activeTab === "all") return groups;
    const typeMap: Record<string, string> = { courses: "course", clubs: "club", study: "study" };
    return groups.filter((g) => g.type === typeMap[activeTab]);
  }, [groups, activeTab]);

  const tabs = useMemo<{ key: GroupTab; label: string; count: number }[]>(() => [
    { key: "all", label: "全部", count: groups.length },
    { key: "courses", label: "課程", count: groups.filter((g) => g.type === "course").length },
    { key: "clubs", label: "社團", count: groups.filter((g) => g.type === "club").length },
    { key: "study", label: "讀書會", count: groups.filter((g) => g.type === "study").length },
  ], [groups]);

  const handleJoinGroup = () => {
    if (!joinCode.trim()) {
      alert("請輸入群組邀請碼");
      return;
    }
    alert(`正在加入群組... 邀請碼: ${joinCode}`);
    setShowJoinModal(false);
    setJoinCode("");
  };

  const handleEnterGroup = (groupId: string) => {
    window.location.href = `/groups/${groupId}`;
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "course": return "課程";
      case "club": return "社團";
      case "study": return "讀書會";
      default: return type;
    }
  };

  if (loading || authLoading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="👥 群組"
        subtitle="課程討論 · 社團活動 · 讀書會"
      >
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入群組資料中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="👥 群組"
      subtitle="課程討論 · 社團活動 · 讀書會"
    >
      {/* Stats */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", 
        gap: 16, 
        marginBottom: 24 
      }}>
        {[
          { label: "已加入", value: groups.length.toString(), icon: "👥", color: "#8B5CF6" },
          { label: "未讀貼文", value: groups.reduce((sum, g) => sum + g.newPosts, 0).toString(), icon: "📝", color: "#EF4444" },
          { label: "待交作業", value: "2", icon: "📋", color: "#F59E0B" },
        ].map((stat) => (
          <div 
            key={stat.label} 
            className="card"
            style={{ padding: 16, textAlign: "center" }}
          >
            <div style={{ fontSize: 20, marginBottom: 6 }}>{stat.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{stat.label}</div>
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
              {tab.label}
              <span style={{ 
                marginLeft: 6, 
                opacity: 0.7,
                background: activeTab === tab.key ? "rgba(255,255,255,0.2)" : "var(--panel2)",
                padding: "2px 6px",
                borderRadius: 999,
                fontSize: 11,
              }}>
                {tab.count}
              </span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setShowJoinModal(true)}>
            ➕ 加入群組
          </button>
        </div>
      </div>

      {/* Group List */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>我的群組</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredGroups.map((group) => (
            <div 
              key={group.id}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 16,
                cursor: "pointer",
                borderLeft: `4px solid ${group.color}`,
              }}
            >
              <div style={{
                width: 50,
                height: 50,
                borderRadius: 12,
                background: `${group.color}20`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}>
                {group.type === "course" ? "📚" : group.type === "club" ? "🎭" : "📖"}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{group.name}</span>
                  <span 
                    className="pill"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                  >
                    {getTypeLabel(group.type)}
                  </span>
                  {group.newPosts > 0 && (
                    <span style={{
                      background: "#EF4444",
                      color: "#fff",
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontWeight: 700,
                    }}>
                      {group.newPosts} 新
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 12 }}>
                  <span>👥 {group.memberCount} 成員</span>
                  {group.instructor && <span>👨‍🏫 {group.instructor}</span>}
                  <span>🕐 {group.lastActivity}</span>
                </div>
              </div>

              <button className="btn" style={{ fontSize: 13 }} onClick={() => handleEnterGroup(group.id)}>
                進入
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Posts */}
      <div className="card">
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📬 最新貼文</h2>
          <button className="btn" style={{ fontSize: 13 }}>查看全部</button>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {recentPosts.map((post, idx) => (
            <div 
              key={idx}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
              }}
            >
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 8, 
                marginBottom: 8,
                fontSize: 12,
                color: "var(--muted)",
              }}>
                <span className="pill" style={{ fontSize: 10 }}>{post.group}</span>
                <span>{post.author}</span>
                <span>·</span>
                <span>{post.time}</span>
              </div>
              
              <div style={{ marginBottom: 8 }}>{post.content}</div>
              
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--muted)" }}>
                <span>💬 {post.replies} 回覆</span>
                <span style={{ cursor: "pointer" }}>👍 讚</span>
                <span style={{ cursor: "pointer" }}>↩️ 回覆</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Join Group Modal */}
      {showJoinModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }} onClick={() => setShowJoinModal(false)}>
          <div 
            className="card" 
            style={{ 
              width: "90%", 
              maxWidth: 400, 
              padding: 24,
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>加入群組</h3>
            <p style={{ color: "var(--muted)", marginBottom: 16, fontSize: 14 }}>
              請輸入群組邀請碼或掃描 QR 碼加入群組
            </p>
            <input
              type="text"
              className="input"
              placeholder="輸入邀請碼..."
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              style={{ marginBottom: 16, textTransform: "uppercase", letterSpacing: 2, fontWeight: 600 }}
            />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowJoinModal(false)}>取消</button>
              <button className="btn primary" onClick={handleJoinGroup}>加入</button>
            </div>
          </div>
        </div>
      )}
    </SiteShell>
  );
}
