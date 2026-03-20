"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { SiteShell } from "@/components/SiteShell";
import { fetchCourseWorkspace, isFirebaseConfigured, type CourseWorkspace } from "@/lib/firebase";
import { resolveSchoolPageContext } from "@/lib/pageContext";

const EMPTY_WORKSPACE: CourseWorkspace = {
  course: null,
  modules: [],
  assignments: [],
  quizzes: [],
  attendance: [],
  gradebookRows: [],
  posts: [],
};

export default function TeacherCoursePage(props: {
  params: { courseId: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [workspace, setWorkspace] = useState<CourseWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await fetchCourseWorkspace(props.params.courseId);
        if (!active) return;
        setWorkspace(next);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [props.params.courseId]);

  const summary = useMemo(
    () => ({
      pendingPublishing: workspace.assignments.filter((item) => !item.gradesPublished).length,
      activeAttendance: workspace.attendance.filter((session) => session.active).length,
      publishedGrades: workspace.gradebookRows.filter((row) => row.published).length,
      totalStudents: workspace.gradebookRows.length,
    }),
    [workspace]
  );

  return (
    <SiteShell
      title={workspace.course?.name ? `${workspace.course.name} 教師端` : "教師工作台"}
      subtitle="最低可用教師工作台 · 教材、作業、點名與待批改入口"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {!isFirebaseConfigured() ? (
          <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13 }}>
            ⚠️ 目前 Firebase 未設定，教師端顯示的是最低可用框架。
          </div>
        ) : null}

        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📦</div>
            <div className="metricValue">{workspace.modules.length}</div>
            <div className="metricLabel">教材模組</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#FF9500" } as CSSProperties}>
            <div className="metricIcon">📝</div>
            <div className="metricValue">{workspace.assignments.length}</div>
            <div className="metricLabel">作業 / 評量</div>
          </div>
          <div className="metricCard" style={{ "--tone": summary.pendingPublishing > 0 ? "#DC2626" : "#34C759" } as CSSProperties}>
            <div className="metricIcon">{summary.pendingPublishing > 0 ? "⏳" : "✅"}</div>
            <div className="metricValue">{summary.pendingPublishing}</div>
            <div className="metricLabel">待發布成績</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#0EA5E9" } as CSSProperties}>
            <div className="metricIcon">👥</div>
            <div className="metricValue">{summary.totalStudents}</div>
            <div className="metricLabel">成績簿學生數</div>
          </div>
        </div>

        <div className="toolbarPanel" style={{ justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="pill">{summary.activeAttendance > 0 ? "課堂進行中" : "尚未啟動課堂"}</span>
            <span className="pill subtle">{summary.publishedGrades} 筆已發布</span>
          </div>
          <Link href={`/course/${props.params.courseId}${q}`} className="btn">
            學生視角
          </Link>
        </div>

        <div className="pageGrid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">教學內容</h2>
              <span className="homeSectionNote">{workspace.modules.length} 個模組</span>
            </div>
            <div className="insetGroup">
              {workspace.modules.map((module, index) => (
                <div key={module.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{module.title ?? "未命名模組"}</div>
                    <div className="insetGroupRowMeta">{module.description ?? "可在 mobile 教師端新增教材與連結"}</div>
                  </div>
                  <span className="pill subtle">{module.resourceCount ?? 0} 個資源</span>
                </div>
              ))}
              {workspace.modules.length === 0 ? (
                <div className="insetGroupRow" style={{ borderTop: "none" }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">尚無教材模組</div>
                    <div className="insetGroupRowMeta">先在課程模組頁建立單元，web 教師端會同步顯示。</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">待批改與發布</h2>
              <span className="homeSectionNote">{workspace.assignments.length} 項</span>
            </div>
            <div className="insetGroup">
              {workspace.assignments.map((assignment, index) => (
                <div key={assignment.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{assignment.title}</div>
                    <div className="insetGroupRowMeta">
                      {assignment.gradesPublished ? "已發布成績" : "尚未發布成績"} · {assignment.submissionCount ?? 0} 份提交
                    </div>
                  </div>
                  <span className={`pill ${assignment.gradesPublished ? "subtle" : ""}`}>
                    {assignment.weight ?? 0}%
                  </span>
                </div>
              ))}
              {workspace.assignments.length === 0 ? (
                <div className="insetGroupRow" style={{ borderTop: "none" }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">尚無作業或評量</div>
                    <div className="insetGroupRowMeta">建立作業、quiz 或 exam 後，這裡會成為教師端待辦清單。</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">點名摘要</h2>
              <span className="homeSectionNote">{workspace.attendance.length} 堂</span>
            </div>
            <div className="insetGroup">
              {workspace.attendance.map((session, index) => (
                <div key={session.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{session.active ? "進行中課堂" : "已結束課堂"}</div>
                    <div className="insetGroupRowMeta">{session.attendanceMode ?? "一般簽到"} · {session.attendeeCount} 人</div>
                  </div>
                  <span className={`pill ${session.active ? "" : "subtle"}`}>{session.source}</span>
                </div>
              ))}
              {workspace.attendance.length === 0 ? (
                <div className="insetGroupRow" style={{ borderTop: "none" }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">尚未啟動點名</div>
                    <div className="insetGroupRowMeta">啟動後會自動同步到學生端與收件匣。</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">成績簿摘要</h2>
              <span className="homeSectionNote">{loading ? "載入中" : `${summary.totalStudents} 位學生`}</span>
            </div>
            <div className="insetGroup">
              <div className="insetGroupRow" style={{ borderTop: "none" }}>
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">已發布成績</div>
                  <div className="insetGroupRowMeta">目前可在 mobile 課內成績簿查看完整明細。</div>
                </div>
                <span className="pill">{summary.publishedGrades}</span>
              </div>
              <div className="insetGroupRow">
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">尚未發布</div>
                  <div className="insetGroupRowMeta">包含未評分或未公開的作業項目。</div>
                </div>
                <span className="pill subtle">{Math.max(summary.totalStudents - summary.publishedGrades, 0)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
