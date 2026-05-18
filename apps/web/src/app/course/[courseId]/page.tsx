'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { fetchCourseWorkspace, isFirebaseConfigured, type CourseWorkspace } from '@/lib/firebase';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getDemoCourseById, getDemoCourseWorkspace } from '@/lib/demoData';
import { useDemoRole } from '@/lib/demoRole';
import {
  useDemoStore,
  getDynamicAssignmentsForCourse,
  submitAssignment,
  isSubmitted,
  getActiveAttendance,
} from '@/lib/demoStore';

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
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未設定';
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CoursePage(props: {
  params: { courseId: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const { success, info } = useToast();
  const [demoRole] = useDemoRole();
  const isReadOnlyRole = demoRole === 'alumni' || demoRole === 'guest';
  const canTakeAction = !isReadOnlyRole;
  const store = useDemoStore();
  const dynAssignments = getDynamicAssignmentsForCourse(props.params.courseId, store);
  const attendanceActive = getActiveAttendance(props.params.courseId);
  const [workspace, setWorkspace] = useState<CourseWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(!isFirebaseConfigured());
  const [showAskTeacher, setShowAskTeacher] = useState(false);
  const [askTeacherText, setAskTeacherText] = useState('');

  // 教師 / TA / admin / 系主任 自動跳教師端，省去手動點按鈕的一步
  useEffect(() => {
    if (demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head') {
      router.replace(`/teacher/course/${props.params.courseId}${q}`);
    }
  }, [demoRole, props.params.courseId, q, router]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const next = await fetchCourseWorkspace(props.params.courseId);
        if (!active) return;
        // 若 Firebase 沒有這門課，就 fallback 到 demoData（讓 demo 一定有畫面）
        if (!next.course) {
          const demo = getDemoCourseWorkspace(props.params.courseId);
          if (demo) {
            setWorkspace(demo);
            setUsingDemo(true);
            return;
          }
        }
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
    [workspace],
  );

  // 404：載入完成但沒有任何資料（demoData 也沒對應）
  const isNotFound = !loading && !workspace.course && !getDemoCourseById(props.params.courseId);
  if (isNotFound) {
    return (
      <SiteShell title="找不到課程" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>🔍</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>找不到此課程</h2>
            <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 14 }}>
              課程編號「{props.params.courseId}」不存在或你沒有選修。
            </p>
            <p style={{ margin: '0 0 24px', color: 'var(--muted)', fontSize: 13 }}>
              示範模式中可用的課程：c1, c2, c3, c4, c5, c6, c7, c8
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href={`/timetable${q}`} className="btn primary">
                ← 回課表
              </Link>
              <Link href={`/groups${q}`} className="btn">
                看所有群組
              </Link>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title={workspace.course?.name ?? '課程空間'}
      subtitle="課程中樞 · 教材、作業、測驗、點名與最新動態"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* 校友 / 訪客：課程為選課學生專屬，唯讀提示 */}
        {isReadOnlyRole && (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: demoRole === 'alumni' ? 'rgba(142,142,147,0.10)' : 'rgba(0,122,255,0.08)',
              border: `1px solid ${demoRole === 'alumni' ? '#8E8E93' : '#007AFF'}`,
              fontSize: 13,
            }}
          >
            {demoRole === 'alumni' ? '🎓' : '👀'}{' '}
            <strong>{demoRole === 'alumni' ? '校友身份' : '訪客身份'}</strong>
            {' '}· 課程空間僅供選課學生使用，{demoRole === 'alumni' ? '校友' : '訪客'}以唯讀方式瀏覽示範內容，無法提交作業或參加測驗。
          </div>
        )}

        {/* 點名進行中橫幅（教師開始點名後出現） */}
        {attendanceActive && demoRole === 'student' && (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'rgba(220,38,38,0.10)',
              border: '1px solid #dc2626',
              fontSize: 13,
              fontWeight: 600,
              color: '#991b1b',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            🔴 <strong>目前正在點名中</strong>，請確認你的出席狀態！點名結束後你將收到通知。
          </div>
        )}

        {usingDemo ? (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'var(--info-soft)',
              borderColor: 'var(--info)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              📚 <strong>示範模式</strong> ·{' '}
              {getDemoCourseById(props.params.courseId)?.instructor ?? '—'} 老師 ·{' '}
              {getDemoCourseById(props.params.courseId)?.room ?? '—'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href={`/timetable${q}`} className="btn" style={{ fontSize: 12 }}>
                回課表
              </Link>
              <Link href={`/grades${q}`} className="btn" style={{ fontSize: 12 }}>
                看成績
              </Link>
            </div>
          </div>
        ) : null}

        <div className="metricGrid">
          <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{summary.modules}</div>
            <div className="metricLabel">教材模組</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#FF9500' } as CSSProperties}>
            <div className="metricIcon">📝</div>
            <div className="metricValue">{summary.assignments}</div>
            <div className="metricLabel">作業</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#7C3AED' } as CSSProperties}>
            <div className="metricIcon">❓</div>
            <div className="metricValue">{summary.quizzes}</div>
            <div className="metricLabel">測驗 / 考試</div>
          </div>
          <div
            className="metricCard"
            style={
              { '--tone': summary.activeSessions > 0 ? '#DC2626' : '#34C759' } as CSSProperties
            }
          >
            <div className="metricIcon">{summary.activeSessions > 0 ? '🟢' : '⏸'}</div>
            <div className="metricValue">{summary.activeSessions}</div>
            <div className="metricLabel">進行中課堂</div>
          </div>
        </div>

        <div className="toolbarPanel" style={{ justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill">
              {workspace.course?.type === 'course' ? '正式課程空間' : '課程群組橋接'}
            </span>
            <span className="pill subtle">{workspace.course?.memberCount ?? 0} 位成員</span>
            <span className="pill subtle">{summary.publishedGrades} 筆已發布成績</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* 學生身份：詢問 AI 按鈕 + 提問教師按鈕 */}
            {(demoRole === 'student' || demoRole === 'alumni' || demoRole === 'guest' || demoRole === 'club_officer') && (
              <>
                <Link
                  href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我分析「${workspace.course?.name ?? getDemoCourseById(props.params.courseId)?.name ?? '這門課'}」這門課：我目前的學分缺口適合選修嗎？有哪些注意事項？`)}`}
                  className="btn"
                  title="請 AI 助理分析這門課的選修建議"
                  style={{ fontWeight: 600 }}
                >
                  🤖 詢問 AI
                </Link>
                {demoRole === 'student' && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAskTeacher((v) => !v)}
                    style={{ fontWeight: 600 }}
                    title="傳送訊息給授課教師"
                  >
                    ✉️ 提問教師
                  </button>
                )}
              </>
            )}
            {/* 教師 / TA / admin：進入教師端（已被 useEffect 自動 redirect，這裡是保險按鈕） */}
            {(demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head') && (
              <Link
                href={`/teacher/course/${props.params.courseId}${q}`}
                className="btn primary"
                title="切換到教師端，可管理教材、點名、成績冊與題庫"
                style={{ fontWeight: 700 }}
              >
                🧑‍🏫 教師工作台
              </Link>
            )}
          </div>
        </div>

        {/* 提問教師 inline panel */}
        {showAskTeacher && demoRole === 'student' && (
          <div
            className="card"
            style={{
              padding: '16px 20px',
              background: 'linear-gradient(135deg, rgba(94,106,210,0.08) 0%, rgba(142,186,255,0.06) 100%)',
              border: '1px solid rgba(94,106,210,0.28)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                ✉️ 提問 {getDemoCourseById(props.params.courseId)?.instructor ?? '老師'}
              </div>
              <button
                onClick={() => { setShowAskTeacher(false); setAskTeacherText(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}
              >✕</button>
            </div>
            <textarea
              value={askTeacherText}
              onChange={(e) => setAskTeacherText(e.target.value)}
              placeholder={`輸入你想問 ${getDemoCourseById(props.params.courseId)?.instructor ?? '老師'} 的問題…`}
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 14,
                resize: 'vertical',
                lineHeight: 1.6,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setShowAskTeacher(false); setAskTeacherText(''); }}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!askTeacherText.trim()}
                onClick={() => {
                  if (!askTeacherText.trim()) return;
                  success(`✅ 訊息已送出給 ${getDemoCourseById(props.params.courseId)?.instructor ?? '老師'}，教師會盡快回覆`);
                  setShowAskTeacher(false);
                  setAskTeacherText('');
                }}
              >
                ✉️ 送出提問
              </button>
            </div>
          </div>
        )}

        <div className="pageGrid" style={{ gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
          <div className="pageStack">
            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">教材單元</h2>
                <span className="homeSectionNote">{summary.modules} 個模組</span>
              </div>
              <div className="insetGroup">
                {workspace.modules.length === 0 ? (
                  <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">尚未建立教材模組</div>
                      <div className="insetGroupRowMeta">請先在教師端建立單元與教材資源。</div>
                    </div>
                  </div>
                ) : (
                  workspace.modules.map((module, index) => (
                    <div
                      key={module.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">
                          {module.title ?? `第 ${module.week ?? module.order ?? '-'} 單元`}
                        </div>
                        <div className="insetGroupRowMeta">
                          {module.description ?? '教材內容已建立'} ·{' '}
                          {module.resourceCount ?? 0} 個資源
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <Link
                          href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我重點整理「${module.title ?? `第 ${module.week ?? ''} 單元`}」這份教材的核心觀念`)}`}
                          title="讓 AI 摘要這份教材"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid rgba(94,106,210,0.30)',
                            background: 'rgba(94,106,210,0.10)',
                            color: '#5E6AD2',
                            fontSize: 12,
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          🤖
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canTakeAction) {
                              info(
                                demoRole === 'alumni'
                                  ? '校友身份無法下載課程教材'
                                  : '請先登入後才能下載教材',
                              );
                              return;
                            }
                            success(`已開始下載：${module.title}`);
                          }}
                          title={!canTakeAction ? '此身份無法下載' : '下載教材'}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: canTakeAction ? 'var(--surface)' : 'var(--panel)',
                            color: canTakeAction ? 'var(--brand)' : 'var(--muted)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: canTakeAction ? 'pointer' : 'not-allowed',
                            opacity: canTakeAction ? 1 : 0.6,
                          }}
                        >
                          {canTakeAction ? '⬇ 下載' : '🔒 無法下載'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">近期作業與評量</h2>
                <span className="homeSectionNote">
                  {workspace.assignments.length + workspace.quizzes.length + dynAssignments.length} 項
                </span>
              </div>
              <div className="insetGroup">
                {/* 動態新增作業（教師剛建立的，真實繳交流程） */}
                {dynAssignments.map((item, index) => {
                  const submitted = isSubmitted(item.id, 'stu-001', store);
                  return (
                    <div
                      key={item.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined, background: 'rgba(94,106,210,0.06)' }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">🆕 {item.title}</div>
                        <div className="insetGroupRowMeta">
                          新作業 · 截止：{item.due} · {item.points} 分
                        </div>
                      </div>
                      {demoRole === 'student' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (submitted) return;
                            submitAssignment({
                              assignmentId: item.id,
                              courseId: props.params.courseId,
                              courseName: getDemoCourseById(props.params.courseId)?.name ?? '課程',
                              assignmentTitle: item.title,
                              studentId: 'stu-001',
                              studentName: '王小明',
                            });
                            success(`✅ 已繳交「${item.title}」！老師已收到通知。`);
                          }}
                          style={{
                            padding: '6px 12px', borderRadius: 8, border: '1px solid',
                            borderColor: submitted ? '#34C759' : '#5E6AD2',
                            background: submitted ? 'rgba(52,199,89,0.10)' : 'rgba(94,106,210,0.10)',
                            color: submitted ? '#16a34a' : '#5E6AD2',
                            fontSize: 12, fontWeight: 700,
                            cursor: submitted ? 'default' : 'pointer',
                          }}
                        >
                          {submitted ? '✅ 已繳交' : '📤 繳交'}
                        </button>
                      )}
                    </div>
                  );
                })}
                {[...workspace.quizzes, ...workspace.assignments].slice(0, 8).map((item, index) => {
                  const isQuiz = item.type === 'quiz' || item.type === 'exam';
                  const actionLabel = isQuiz ? '✏️ 應試' : '📤 繳交';
                  const actionToast = isQuiz
                    ? `已進入「${item.title}」測驗（demo）`
                    : `已開啟「${item.title}」繳交視窗（demo）`;
                  return (
                    <div
                      key={item.id}
                      className="insetGroupRow"
                      style={{ borderTop: (index === 0 && dynAssignments.length === 0) ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{item.title}</div>
                        <div className="insetGroupRowMeta">
                          {isQuiz ? '測驗' : '作業'} · 截止：{formatDate(item.dueAt)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {demoRole === 'student' && (
                          <Link
                            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我構思「${item.title}」這份${isQuiz ? '考試' : '作業'}的方向與重點`)}`}
                            title="讓 AI 給你靈感"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid rgba(94,106,210,0.30)',
                              background: 'rgba(94,106,210,0.10)',
                              color: '#5E6AD2',
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: 'none',
                            }}
                          >
                            🤖
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (!canTakeAction) {
                              info(
                                demoRole === 'alumni'
                                  ? '校友身份無法繳交作業或應試'
                                  : '請先登入後才能進行此動作',
                              );
                              return;
                            }
                            success(actionToast);
                          }}
                          title={!canTakeAction ? '此身份無法執行' : undefined}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid',
                            borderColor: canTakeAction
                              ? isQuiz
                                ? '#7C3AED'
                                : '#FF9500'
                              : 'var(--border)',
                            background: canTakeAction
                              ? isQuiz
                                ? 'rgba(124,58,237,0.10)'
                                : 'rgba(255,149,0,0.10)'
                              : 'var(--panel)',
                            color: canTakeAction
                              ? isQuiz
                                ? '#7C3AED'
                                : '#B45309'
                              : 'var(--muted)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: canTakeAction ? 'pointer' : 'not-allowed',
                            opacity: canTakeAction ? 1 : 0.6,
                          }}
                        >
                          {canTakeAction ? actionLabel : '🔒 唯讀'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {workspace.assignments.length + workspace.quizzes.length + dynAssignments.length === 0 ? (
                  <div className="insetGroupRow" style={{ borderTop: 'none' }}>
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
                  <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">尚未啟動課堂</div>
                      <div className="insetGroupRowMeta">
                        教師啟動點名後，這裡會顯示狀態與簽到人數。
                      </div>
                    </div>
                  </div>
                ) : (
                  workspace.attendance.slice(0, 5).map((session, index) => (
                    <div
                      key={session.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">
                          {session.active ? '課堂進行中' : '近期課堂紀錄'}
                        </div>
                        <div className="insetGroupRowMeta">
                          開始：{formatDate(session.startedAt)}
                        </div>
                      </div>
                      <span className={`pill ${session.active ? '' : 'subtle'}`}>
                        {session.attendeeCount} 人
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sectionCard">
              <div className="homeSectionHeader">
                <h2 className="homeSectionTitle">課程動態</h2>
                <span className="homeSectionNote">
                  {loading ? '載入中' : `${workspace.posts.length} 則`}
                </span>
              </div>
              <div className="activityTimeline">
                {workspace.posts.length === 0 ? (
                  <div className="activityItem">
                    <div className="activityMeta">
                      <span className="activityTag">課程</span>
                      <span>現在</span>
                    </div>
                    <h3 className="activityTitle">尚無最新貼文</h3>
                    <p className="activityBody">
                      建立公告、貼文或課堂互動後，這裡會成為課程動態牆。
                    </p>
                  </div>
                ) : (
                  workspace.posts.map((post) => (
                    <div key={post.id} className="activityItem">
                      <div className="activityMeta">
                        <span className="activityTag">{post.authorName ?? '課程'}</span>
                        <span>{formatDate(post.createdAt)}</span>
                      </div>
                      <h3 className="activityTitle">{post.content.slice(0, 36) || '最新更新'}</h3>
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
