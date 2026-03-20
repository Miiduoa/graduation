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

function formatDate(value?: string) {
  if (!value) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CoursePage(props: {
  params: { courseId: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [workspace, setWorkspace] = useState<CourseWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(!isFirebaseConfigured());

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await fetchCourseWorkspace(props.params.courseId);
        if (!active) return;
        setWorkspace(next);
        setUsingDemo(!isFirebaseConfigured() || !next.course);
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
      modules: workspace.modules.length,
      assignments: workspace.assignments.length,
      quizzes: workspace.quizzes.length,
      activeSessions: workspace.attendance.filter((session) => session.active).length,
      publishedGrades: workspace.gradebookRows.filter((row) => row.published).length,
    }),
    [workspace]
  );

  return (
    <SiteShell
      title={workspace.course?.name ?? "課程空間"}
      subtitle="課程中樞 · 教材、作業、測驗、點名與最新動態"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {usingDemo ? (
          <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13 }}>
            ⚠️ 目前顯示最低可用課程頁。若 Firebase 內已有這門課程的 `groups/{props.params.courseId}` 資料，畫面會直接切換成真實資料。
          </div>
        ) : null}

        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{summary.modules}</div>
            <div className="metricLabel">教材模組</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#FF9500" } as CSSProperties}>
            <div className="metricIcon">📝</div>
            <div className="metricValue">{summary.assignments}</div>
            <div className="metricLabel">作業</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#7C3AED" } as CSSProperties}>
            <div className="metricIcon">❓</div>
            <div className="metricValue">{summary.quizzes}</div>
            <div className="metricLabel">測驗 / 考試</div>
          </div>
          <div className="metricCard" style={{ "--tone": summary.activeSessions > 0 ? "#DC2626" : "#34C759" } as CSSProperties}>
            <div className="metricIcon">{summary.activeSessions > 0 ? "🟢" : "⏸"}</div>
            <div className="metricValue">{summary.activeSessions}</div>
            <div className="metricLabel">進行中課堂</div>
          </div>
        </div>

        <div className="toolbarPanel" style={{ justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="pill">{workspace.course?.type === "course" ? "正式課程空間" : "課程群組橋接"}</span>
            <span className="pill subtle">{workspace.course?.memberCount ?? 0} 位成員</span>
            <span className="pill subtle">{summary.publishedGrades} 筆已發布成績</span>
          </div>
          <Link href={`/teacher/course/${props.params.courseId}${q}`} className="btn">
            教師視角
          </Link>
        </div>

        <div className="pageGrid" style={{ gridTemplateColumns: "1.2fr 0.8fr", gap: 16 }}>
          <div className="pageStack">
            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">教材單元</h2>
                <span className="homeSectionNote">{summary.modules} 個模組</span>
              </div>
              <div className="insetGroup">
                {workspace.modules.length === 0 ? (
                  <div className="insetGroupRow" style={{ borderTop: "none" }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">尚未建立教材模組</div>
                      <div className="insetGroupRowMeta">請先在教師端建立單元與教材資源。</div>
                    </div>
                  </div>
                ) : (
                  workspace.modules.map((module, index) => (
                    <div key={module.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{module.title ?? `第 ${module.week ?? module.order ?? "-"} 單元`}</div>
                        <div className="insetGroupRowMeta">
                          {module.description ?? "教材內容已建立"}
                        </div>
                      </div>
                      <span className="pill subtle">
                        {module.resourceCount ?? 0} 個資源
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">近期作業與評量</h2>
                <span className="homeSectionNote">{workspace.assignments.length + workspace.quizzes.length} 項</span>
              </div>
              <div className="insetGroup">
                {[...workspace.quizzes, ...workspace.assignments].slice(0, 8).map((item, index) => (
                  <div key={item.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{item.title}</div>
                      <div className="insetGroupRowMeta">截止：{formatDate(item.dueAt)}</div>
                    </div>
                    <span className={`pill ${item.type === "quiz" || item.type === "exam" ? "" : "subtle"}`}>
                      {item.type === "quiz" ? "測驗" : item.type === "exam" ? "考試" : "作業"}
                    </span>
                  </div>
                ))}
                {workspace.assignments.length + workspace.quizzes.length === 0 ? (
                  <div className="insetGroupRow" style={{ borderTop: "none" }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">目前沒有待辦項目</div>
                      <div className="insetGroupRowMeta">建立作業或評量後，這裡會自動顯示。</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="pageStack">
            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">點名與課堂</h2>
                <span className="homeSectionNote">{workspace.attendance.length} 堂</span>
              </div>
              <div className="insetGroup">
                {workspace.attendance.length === 0 ? (
                  <div className="insetGroupRow" style={{ borderTop: "none" }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">尚未啟動課堂</div>
                      <div className="insetGroupRowMeta">教師啟動點名後，這裡會顯示狀態與簽到人數。</div>
                    </div>
                  </div>
                ) : (
                  workspace.attendance.slice(0, 5).map((session, index) => (
                    <div key={session.id} className="insetGroupRow" style={{ borderTop: index === 0 ? "none" : undefined }}>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{session.active ? "課堂進行中" : "近期課堂紀錄"}</div>
                        <div className="insetGroupRowMeta">開始：{formatDate(session.startedAt)}</div>
                      </div>
                      <span className={`pill ${session.active ? "" : "subtle"}`}>{session.attendeeCount} 人</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">課程動態</h2>
                <span className="homeSectionNote">{loading ? "載入中" : `${workspace.posts.length} 則`}</span>
              </div>
              <div className="activityTimeline">
                {workspace.posts.length === 0 ? (
                  <div className="activityItem">
                    <div className="activityMeta">
                      <span className="activityTag">課程</span>
                      <span>現在</span>
                    </div>
                    <h3 className="activityTitle">尚無最新貼文</h3>
                    <p className="activityBody">建立公告、貼文或課堂互動後，這裡會成為課程動態牆。</p>
                  </div>
                ) : (
                  workspace.posts.map((post) => (
                    <div key={post.id} className="activityItem">
                      <div className="activityMeta">
                        <span className="activityTag">{post.authorName ?? "課程"}</span>
                        <span>{formatDate(post.createdAt)}</span>
                      </div>
                      <h3 className="activityTitle">{post.content.slice(0, 36) || "最新更新"}</h3>
                      <p className="activityBody">{post.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
