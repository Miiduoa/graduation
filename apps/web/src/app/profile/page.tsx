"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

type Tab = "overview" | "courses" | "achievements";

const MOCK_USER = {
  name: "王小明",
  email: "student@campus.edu",
  department: "資訊工程學系",
  grade: "大三",
  studentId: "B11201234",
  gpa: 3.82,
  totalCredits: 72,
  requiredCredits: 128,
  bio: "熱愛程式設計與開源專案，致力於探索 AI 與軟體工程的交叉領域。",
  interests: ["程式設計", "機器學習", "音樂", "攝影"],
};

const MOCK_COURSES = [
  { name: "資料結構", grade: "A+", credits: 3, semester: "113-2" },
  { name: "線性代數", grade: "A", credits: 3, semester: "113-2" },
  { name: "作業系統", grade: "A-", credits: 3, semester: "113-2" },
  { name: "計算機網路", grade: "B+", credits: 3, semester: "113-1" },
];

const MOCK_ACHIEVEMENTS = [
  { name: "學業優異", icon: "🏆", desc: "GPA 達 3.8 以上", earned: true },
  { name: "全勤獎", icon: "✅", desc: "整學期無缺席", earned: true },
  { name: "社團積極", icon: "🎉", desc: "參與 3 個以上社團", earned: false },
  { name: "競賽達人", icon: "🥇", desc: "獲得競賽獎項", earned: false },
];

export default function ProfilePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const creditPct = Math.round((MOCK_USER.totalCredits / MOCK_USER.requiredCredits) * 100);

  return (
    <SiteShell schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Profile Hero ── */}
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
            border: "none",
            color: "#fff",
            boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div
              style={{
                width: 80, height: 80,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.24)",
                border: "3px solid rgba(255,255,255,0.5)",
                display: "grid", placeItems: "center",
                fontSize: 36, fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {MOCK_USER.name.slice(0, 1)}
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em" }}>
                {MOCK_USER.name}
              </h1>
              <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.82 }}>
                {MOCK_USER.department} · {MOCK_USER.grade} · {MOCK_USER.studentId}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MOCK_USER.interests.map((t) => (
                  <span key={t} style={{ padding: "4px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: 600 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <Link
              href={`/settings${q}`}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.2)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                border: "1px solid rgba(255,255,255,0.3)",
                whiteSpace: "nowrap",
              }}
            >
              編輯資料
            </Link>
          </div>
          <p style={{ margin: "16px 0 0", fontSize: 14, opacity: 0.82, lineHeight: 1.7 }}>
            {MOCK_USER.bio}
          </p>
        </div>

        {/* ── Quick Stats ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📊</div>
            <div className="metricValue">{MOCK_USER.gpa}</div>
            <div className="metricLabel">累計 GPA</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#34C759" } as CSSProperties}>
            <div className="metricIcon">🎓</div>
            <div className="metricValue">{MOCK_USER.totalCredits}</div>
            <div className="metricLabel">已修學分</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#FF9500" } as CSSProperties}>
            <div className="metricIcon">🏆</div>
            <div className="metricValue">{MOCK_ACHIEVEMENTS.filter((a) => a.earned).length}</div>
            <div className="metricLabel">已獲成就</div>
          </div>
        </div>

        {/* ── Credit Progress ── */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>畢業學分進度</h3>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--brand)" }}>{creditPct}%</span>
          </div>
          <div className="progressMeta">
            <span style={{ fontSize: 13, color: "var(--muted)" }}>已修 {MOCK_USER.totalCredits} / {MOCK_USER.requiredCredits} 學分</span>
          </div>
          <div className="progressTrack">
            <div
              className="progressFill"
              style={{ "--progress-width": `${creditPct}%` } as CSSProperties}
            />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="segmentedGroup">
          {([
            { key: "overview", label: "📋 概覽" },
            { key: "courses", label: "📚 課程紀錄" },
            { key: "achievements", label: "🏆 成就" },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {activeTab === "overview" && (
          <div className="sectionCard">
            <div className="insetGroupHeader">個人資訊</div>
            <div className="insetGroup">
              {[
                { icon: "🎓", label: "系所", value: MOCK_USER.department },
                { icon: "📅", label: "年級", value: MOCK_USER.grade },
                { icon: "🪪", label: "學號", value: MOCK_USER.studentId },
                { icon: "📧", label: "電子郵件", value: MOCK_USER.email },
              ].map((row, i) => (
                <div key={row.label} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                  <div className="insetGroupRowIcon" style={{ fontSize: 18, background: "var(--panel)" }}>{row.icon}</div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{row.label}</div>
                  </div>
                  <div style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500 }}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Courses ── */}
        {activeTab === "courses" && (
          <div className="insetGroup">
            {MOCK_COURSES.map((c, i) => (
              <div key={c.name} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                <div className="insetGroupRowIcon" style={{ fontSize: 18, fontWeight: 800, background: "var(--accent-soft)", color: "var(--brand)" }}>
                  {c.grade}
                </div>
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">{c.name}</div>
                  <div className="insetGroupRowMeta">{c.semester} · {c.credits} 學分</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Achievements ── */}
        {activeTab === "achievements" && (
          <div className="grid-2">
            {MOCK_ACHIEVEMENTS.map((a) => (
              <div
                key={a.name}
                className="card"
                style={{
                  textAlign: "center",
                  opacity: a.earned ? 1 : 0.45,
                  padding: "20px 16px",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}>{a.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{a.desc}</div>
                {a.earned && (
                  <div style={{ fontSize: 11, color: "var(--success)", fontWeight: 700, marginTop: 8 }}>✓ 已解鎖</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
