"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/components/AuthGuard";
import { fetchGrades, fetchGPA, isFirebaseConfigured } from "@/lib/firebase";

type GradeDisplay = {
  code: string;
  name: string;
  credits: number;
  grade: string;
  score: number;
  gpa: number;
  instructor: string;
  rank: number;
  classSize: number;
};

const DEFAULT_GRADES: GradeDisplay[] = [
  { code: "CS101", name: "程式設計", credits: 3, grade: "A+", score: 95, gpa: 4.3, instructor: "王教授", rank: 5, classSize: 60 },
  { code: "CS201", name: "資料結構", credits: 3, grade: "A", score: 88, gpa: 4.0, instructor: "李教授", rank: 12, classSize: 55 },
  { code: "CS301", name: "演算法", credits: 3, grade: "A-", score: 85, gpa: 3.7, instructor: "張教授", rank: 15, classSize: 50 },
  { code: "MA101", name: "微積分", credits: 4, grade: "B+", score: 82, gpa: 3.3, instructor: "陳教授", rank: 25, classSize: 80 },
  { code: "EN101", name: "英文寫作", credits: 2, grade: "A", score: 90, gpa: 4.0, instructor: "林教授", rank: 8, classSize: 30 },
];

const DEFAULT_SEMESTERS = [
  { id: "2025-2", label: "113-2 學期", current: true },
  { id: "2025-1", label: "113-1 學期" },
  { id: "2024-2", label: "112-2 學期" },
  { id: "2024-1", label: "112-1 學期" },
];

export default function GradesPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  
  const { user, loading: authLoading } = useAuth();

  const [selectedSemester, setSelectedSemester] = useState("2025-2");
  const [grades, setGrades] = useState<GradeDisplay[]>(DEFAULT_GRADES);
  const [loading, setLoading] = useState(true);
  const [cumulativeGpa, setCumulativeGpa] = useState<number>(3.76);
  const [gpaHistory, setGpaHistory] = useState<Array<{ semester: string; gpa: number }>>([
    { semester: "112-1", gpa: 3.65 },
    { semester: "112-2", gpa: 3.78 },
    { semester: "113-1", gpa: 3.82 },
  ]);

  const semesters = DEFAULT_SEMESTERS;

  const loadData = useCallback(async () => {
    if (!user || !isFirebaseConfigured()) {
      setGrades(DEFAULT_GRADES);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [gradesData, gpaData] = await Promise.all([
        fetchGrades(user.uid, selectedSemester),
        fetchGPA(user.uid),
      ]);

      if (gradesData.length > 0) {
        const converted: GradeDisplay[] = gradesData.map((g) => ({
          code: g.courseCode,
          name: g.courseName,
          credits: g.credits,
          grade: g.grade,
          score: g.score ?? 0,
          gpa: g.gpa ?? 0,
          instructor: g.instructor ?? "未知",
          rank: g.rank ?? 0,
          classSize: g.classSize ?? 0,
        }));
        setGrades(converted);
      } else {
        setGrades(DEFAULT_GRADES);
      }

      if (gpaData) {
        setCumulativeGpa(gpaData.cumulative);
        if (gpaData.semesters.length > 0) {
          setGpaHistory(gpaData.semesters);
        }
      }
    } catch (error) {
      console.error("Failed to load grades:", error);
      setGrades(DEFAULT_GRADES);
    } finally {
      setLoading(false);
    }
  }, [user, selectedSemester]);

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  const totalCredits = useMemo(() => grades.reduce((sum, g) => sum + g.credits, 0), [grades]);
  const semesterGpa = useMemo(() => {
    const totalGpaPoints = grades.reduce((sum, g) => sum + g.gpa * g.credits, 0);
    return totalCredits > 0 ? (totalGpaPoints / totalCredits).toFixed(2) : "0.00";
  }, [grades, totalCredits]);
  const avgScore = useMemo(() => {
    return grades.length > 0 ? (grades.reduce((sum, g) => sum + g.score, 0) / grades.length).toFixed(1) : "0.0";
  }, [grades]);

  const displayGpaHistory = useMemo(() => {
    const current = [...gpaHistory];
    const currentSemLabel = semesters.find(s => s.id === selectedSemester)?.label.replace(" 學期", "") ?? "當前";
    if (!current.find(h => h.semester === currentSemLabel)) {
      current.push({ semester: currentSemLabel, gpa: Number(semesterGpa) });
    }
    return current.slice(-4);
  }, [gpaHistory, selectedSemester, semesterGpa, semesters]);

  const getGradeColor = (grade: string) => {
    if (grade.startsWith("A")) return "#10B981";
    if (grade.startsWith("B")) return "#3B82F6";
    if (grade.startsWith("C")) return "#F59E0B";
    if (grade.startsWith("D")) return "#F97316";
    return "#EF4444";
  };

  const handleExport = () => {
    const csvContent = [
      ["課程代碼", "課程名稱", "學分", "成績", "分數", "排名", "授課教師"].join(","),
      ...grades.map(g => [g.code, g.name, g.credits, g.grade, g.score, `${g.rank}/${g.classSize}`, g.instructor].join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `成績單_${selectedSemester}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || authLoading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="📊 成績查詢"
        subtitle="學期成績 · GPA 統計 · 歷史記錄"
      >
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入成績資料中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="📊 成績查詢"
      subtitle="學期成績 · GPA 統計 · 歷史記錄"
    >
      {/* Semester Selector */}
      <div className="card" style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {semesters.map((sem) => (
            <button
              key={sem.id}
              className={`btn ${selectedSemester === sem.id ? "primary" : ""}`}
              onClick={() => setSelectedSemester(sem.id)}
              style={{ fontSize: 13 }}
            >
              {sem.label}
              {sem.current && <span style={{ marginLeft: 4 }}>✨</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Overview */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", 
        gap: 16, 
        marginBottom: 24 
      }}>
        {[
          { label: "學期 GPA", value: semesterGpa, icon: "📈", color: "#8B5CF6" },
          { label: "累計 GPA", value: cumulativeGpa.toFixed(2), icon: "🎯", color: "#10B981" },
          { label: "平均分數", value: avgScore, icon: "📝", color: "#3B82F6" },
          { label: "總學分", value: totalCredits.toString(), icon: "📚", color: "#F59E0B" },
        ].map((stat) => (
          <div 
            key={stat.label} 
            className="card"
            style={{ padding: 16, textAlign: "center" }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* GPA Trend */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>📈 GPA 趨勢</h2>
        
        <div style={{ 
          display: "flex", 
          alignItems: "flex-end", 
          gap: 16, 
          height: 120,
          paddingTop: 20,
        }}>
          {displayGpaHistory.map((item, idx) => {
            const height = ((item.gpa - 3) / 1.3) * 100;
            const isLatest = idx === displayGpaHistory.length - 1;
            
            return (
              <div 
                key={item.semester}
                style={{ 
                  flex: 1, 
                  display: "flex", 
                  flexDirection: "column", 
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ 
                  fontSize: 14, 
                  fontWeight: 700, 
                  color: isLatest ? "var(--brand)" : "var(--text)" 
                }}>
                  {item.gpa.toFixed(2)}
                </div>
                <div style={{
                  width: "100%",
                  maxWidth: 60,
                  height: `${height}%`,
                  minHeight: 20,
                  background: isLatest 
                    ? "linear-gradient(180deg, var(--brand) 0%, rgba(139,92,246,0.3) 100%)"
                    : "var(--panel2)",
                  borderRadius: 8,
                  transition: "height 0.3s ease",
                }} />
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {item.semester}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grade List */}
      <div className="card">
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📋 成績明細</h2>
          <button className="btn" style={{ fontSize: 13 }} onClick={handleExport}>
            📥 匯出成績單
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["課程代碼", "課程名稱", "學分", "成績", "分數", "排名", "授課教師"].map((header) => (
                  <th 
                    key={header}
                    style={{ 
                      padding: "12px 8px", 
                      textAlign: "left", 
                      fontSize: 12, 
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => (
                <tr 
                  key={grade.code}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "14px 8px", fontFamily: "monospace", fontWeight: 600 }}>
                    {grade.code}
                  </td>
                  <td style={{ padding: "14px 8px", fontWeight: 500 }}>
                    {grade.name}
                  </td>
                  <td style={{ padding: "14px 8px", textAlign: "center" }}>
                    {grade.credits}
                  </td>
                  <td style={{ padding: "14px 8px" }}>
                    <span 
                      style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        borderRadius: 999,
                        background: `${getGradeColor(grade.grade)}20`,
                        color: getGradeColor(grade.grade),
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {grade.grade}
                    </span>
                  </td>
                  <td style={{ padding: "14px 8px", fontWeight: 600 }}>
                    {grade.score}
                  </td>
                  <td style={{ padding: "14px 8px", fontSize: 13, color: "var(--muted)" }}>
                    {grade.rank}/{grade.classSize}
                  </td>
                  <td style={{ padding: "14px 8px", fontSize: 13, color: "var(--muted)" }}>
                    {grade.instructor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ 
          marginTop: 16, 
          padding: 16, 
          background: "var(--panel2)", 
          borderRadius: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontWeight: 600 }}>本學期總計</span>
          <div style={{ display: "flex", gap: 24 }}>
            <span>
              <span style={{ color: "var(--muted)", marginRight: 8 }}>學分</span>
              <span style={{ fontWeight: 700 }}>{totalCredits}</span>
            </span>
            <span>
              <span style={{ color: "var(--muted)", marginRight: 8 }}>GPA</span>
              <span style={{ fontWeight: 700, color: "var(--brand)" }}>{semesterGpa}</span>
            </span>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
