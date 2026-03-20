"use client";

import { SiteShell } from "@/components/SiteShell";
import { useState, useMemo, useEffect, type CSSProperties } from "react";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import {
  getAuth,
  fetchGrades,
  fetchGPA,
  isFirebaseConfigured,
  type Grade,
} from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

interface GradeDisplay {
  code: string;
  name: string;
  credits: number;
  grade: string;
  score: number;
  gpa: number;
  instructor: string;
  rank?: string;
}

const DEFAULT_GRADES: GradeDisplay[] = [
  { code: "CS301", name: "資料結構", credits: 3, grade: "A+", score: 96, gpa: 4.3, instructor: "王大明", rank: "3/87" },
  { code: "MATH201", name: "線性代數", credits: 3, grade: "A", score: 91, gpa: 4.0, instructor: "陳小華", rank: "8/102" },
  { code: "CS302", name: "作業系統", credits: 3, grade: "A-", score: 88, gpa: 3.7, instructor: "李志明", rank: "12/76" },
  { code: "CS401", name: "計算機網路", credits: 3, grade: "B+", score: 84, gpa: 3.3, instructor: "張美玲", rank: "22/68" },
  { code: "MATH101", name: "微積分", credits: 4, grade: "B", score: 79, gpa: 3.0, instructor: "吳俊傑", rank: "35/120" },
];

const DEFAULT_GPA_HISTORY = [
  { semester: "112-1", gpa: 3.52 },
  { semester: "112-2", gpa: 3.68 },
  { semester: "113-1", gpa: 3.71 },
  { semester: "113-2", gpa: 3.82 },
];

// 生成最近 4 個學期清單
function generateSemesters(): string[] {
  const now = new Date();
  const year = now.getFullYear() - 1911;
  const month = now.getMonth() + 1;
  const currentSem = month >= 2 && month <= 7 ? 2 : 1;
  const sems: string[] = [];
  let y = year; let s = currentSem;
  for (let i = 0; i < 4; i++) {
    sems.push(`${y}-${s}`);
    s--; if (s < 1) { s = 2; y--; }
  }
  return sems;
}

function gradeToGpa(grade: string): number {
  const map: Record<string, number> = {
    "A+": 4.3, "A": 4.0, "A-": 3.7,
    "B+": 3.3, "B": 3.0, "B-": 2.7,
    "C+": 2.3, "C": 2.0, "C-": 1.7,
    "D": 1.0, "F": 0,
  };
  return map[grade] ?? 0;
}

function mapFirebaseGrade(g: Grade): GradeDisplay {
  return {
    code: g.courseCode ?? g.id,
    name: g.courseName,
    credits: g.credits,
    grade: g.grade,
    score: g.score ?? 0,
    gpa: g.gpa ?? gradeToGpa(g.grade),
    instructor: g.instructor ?? "—",
    rank: g.rank != null && g.classSize != null ? `${g.rank}/${g.classSize}` : undefined,
  };
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "var(--success)";
  if (grade.startsWith("B")) return "var(--info)";
  if (grade.startsWith("C")) return "var(--warning)";
  if (grade.startsWith("D")) return "#FF9500";
  return "var(--danger)";
}

function gradeBackground(grade: string): string {
  if (grade.startsWith("A")) return "var(--success-soft)";
  if (grade.startsWith("B")) return "var(--info-soft)";
  if (grade.startsWith("C")) return "var(--warning-soft)";
  return "var(--danger-soft)";
}

const SEMESTERS = generateSemesters();

export default function GradesPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [selectedSemester, setSelectedSemester] = useState(SEMESTERS[0]);
  const [sortBy, setSortBy] = useState<"name" | "score" | "gpa">("score");
  const [user, setUser] = useState<User | null>(null);
  const [grades, setGrades] = useState<GradeDisplay[]>(DEFAULT_GRADES);
  const [gpaHistory, setGpaHistory] = useState(DEFAULT_GPA_HISTORY);
  const [loading, setLoading] = useState(false);
  const [usingDemo, setUsingDemo] = useState(true);

  // 監聽 Auth 狀態
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 依學期載入成績
  useEffect(() => {
    if (!user || !isFirebaseConfigured()) {
      setGrades(DEFAULT_GRADES);
      setUsingDemo(true);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [fbGrades, gpaData] = await Promise.all([
          fetchGrades(user!.uid, selectedSemester),
          fetchGPA(user!.uid),
        ]);
        if (!active) return;
        if (fbGrades.length > 0) {
          setGrades(fbGrades.map(mapFirebaseGrade));
          setUsingDemo(false);
        } else {
          setGrades(DEFAULT_GRADES);
          setUsingDemo(true);
        }
        if (gpaData?.semesters && gpaData.semesters.length > 0) {
          setGpaHistory(gpaData.semesters);
        }
      } catch {
        if (active) { setGrades(DEFAULT_GRADES); setUsingDemo(true); }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user, selectedSemester]);

  const sorted = useMemo(
    () => [...grades].sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "gpa") return b.gpa - a.gpa;
      return a.name.localeCompare(b.name, "zh-TW");
    }),
    [grades, sortBy]
  );

  const semGpa = useMemo(() => {
    const total = grades.reduce((s, g) => s + g.credits, 0);
    if (total === 0) return 0;
    return +(grades.reduce((s, g) => s + g.gpa * g.credits, 0) / total).toFixed(2);
  }, [grades]);

  const totalCredits = useMemo(() => grades.reduce((s, g) => s + g.credits, 0), [grades]);
  const avgScore = useMemo(
    () => grades.length > 0 ? Math.round(grades.reduce((s, g) => s + g.score, 0) / grades.length) : 0,
    [grades]
  );

  const maxGpa = gpaHistory.length > 0 ? Math.max(...gpaHistory.map((h) => h.gpa)) : 4.3;

  return (
    <SiteShell title="成績" subtitle={`${selectedSemester} 學期成績查詢`} schoolName={schoolName} schoolCode={selectedSemester}>
      <div className="pageStack">
        {usingDemo && (
          <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13, color: "var(--text)" }}>
            ⚠️ 目前顯示示範資料。{!user ? "請登入帳號" : "Firebase 尚未設定或本學期無成績"}以查看實際成績。
          </div>
        )}

        {/* ── GPA Hero Card ── */}
        <div className="card" style={{ background: "linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)", border: "none", color: "#fff", boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.75, fontWeight: 600 }}>
                {selectedSemester} 學期 · 學期 GPA
              </p>
              <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: "-0.06em", lineHeight: 1 }}>
                {loading ? "…" : semGpa}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.82 }}>
                修習 {totalCredits} 學分 · 平均分數 {avgScore} 分
              </p>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "課程數", val: grades.length },
                { label: "最高分", val: grades.length > 0 ? Math.max(...grades.map((g) => g.score)) : 0 },
                { label: "A 以上", val: grades.filter((g) => g.grade.startsWith("A")).length },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.05em" }}>{s.val}</div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── GPA Trend ── */}
        {gpaHistory.length > 0 && (
          <div className="card">
            <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>GPA 歷學期趨勢</h3>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              {gpaHistory.slice(-6).map((h) => {
                const pct = (h.gpa / (maxGpa + 0.3)) * 100;
                const isLatest = h.semester === selectedSemester;
                return (
                  <div key={h.semester} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: isLatest ? "var(--brand)" : "var(--text)" }}>{h.gpa}</div>
                    <div style={{ width: "100%", height: `${pct * 0.8}px`, minHeight: 20, borderRadius: "var(--radius-xs)", background: isLatest ? "linear-gradient(180deg, var(--brand) 0%, var(--brand2) 100%)" : "var(--panel2)", boxShadow: isLatest ? "var(--shadow-sm)" : "var(--shadow-inset)", transition: "height 0.4s ease" }} />
                    <div style={{ fontSize: 11, color: isLatest ? "var(--brand)" : "var(--muted)", fontWeight: isLatest ? 700 : 500 }}>{h.semester}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <select className="input" value={selectedSemester} onChange={(e) => setSelectedSemester(e.target.value)} style={{ minHeight: 40, fontSize: 13 }}>
              {SEMESTERS.map((s) => (
                <option key={s} value={s}>{s} 學期</option>
              ))}
            </select>
          </div>
          <div className="toolbarActions">
            <div className="segmentedGroup">
              {[{ key: "score", label: "分數" }, { key: "gpa", label: "GPA" }, { key: "name", label: "名稱" }].map((s) => (
                <button key={s.key} className={sortBy === s.key ? "active" : ""} onClick={() => setSortBy(s.key as typeof sortBy)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Grades List ── */}
        <div className="sectionCard">
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>
            {selectedSemester} 學期成績 · {grades.length} 門課程{loading ? " · 載入中..." : ""}
          </div>
          <div className="insetGroup">
            {sorted.map((g, i) => (
              <div key={g.code} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                <div className="insetGroupRowIcon" style={{ background: gradeBackground(g.grade), fontSize: 15, fontWeight: 800, color: gradeColor(g.grade), width: 38, height: 38, borderRadius: 10 }}>
                  {g.grade}
                </div>
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">{g.name}</div>
                  <div className="insetGroupRowMeta">{g.code} · {g.instructor} · {g.credits} 學分{g.rank ? ` · 排名 ${g.rank}` : ""}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: gradeColor(g.grade), letterSpacing: "-0.04em" }}>{g.score}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>GPA {g.gpa.toFixed(1)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Score Distribution ── */}
        <div className="card">
          <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>分數分布</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "A（90–100）", count: grades.filter((g) => g.score >= 90).length, color: "var(--success)" },
              { label: "B（80–89）", count: grades.filter((g) => g.score >= 80 && g.score < 90).length, color: "var(--info)" },
              { label: "C（70–79）", count: grades.filter((g) => g.score >= 70 && g.score < 80).length, color: "var(--warning)" },
              { label: "D（60–69）", count: grades.filter((g) => g.score >= 60 && g.score < 70).length, color: "#FF9500" },
            ].map((row) => (
              <div key={row.label}>
                <div className="progressMeta">
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.count} 門</span>
                </div>
                <div className="progressTrack">
                  <div className="progressFill" style={{ "--progress-width": grades.length > 0 ? `${(row.count / grades.length) * 100}%` : "0%", "--progress": `linear-gradient(90deg, ${row.color} 0%, ${row.color}80 100%)` } as CSSProperties} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Export ── */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" style={{ fontSize: 13 }} onClick={() => {
            const csv = ["科目代碼,課程名稱,學分,成績,分數,GPA,任課教師"]
              .concat(grades.map((g) => `${g.code},${g.name},${g.credits},${g.grade},${g.score},${g.gpa},${g.instructor}`))
              .join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
            a.download = `grades_${selectedSemester}.csv`;
            a.click();
          }}>
            📥 匯出 CSV
          </button>
        </div>
      </div>
    </SiteShell>
  );
}
