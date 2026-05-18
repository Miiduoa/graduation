'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useToast } from '@/components/ui';
import { addAssignment, useDemoStore, getDynamicAssignmentsForCourse } from '@/lib/demoStore';
import { getDemoCourseById as _getCourse, getDemoUser } from '@/lib/demoData';

import { SiteShell } from '@/components/SiteShell';
import {
  checkGroupMembership,
  fetchCourseWorkspace,
  getAuth,
  isFirebaseConfigured,
  onAuthStateChanged,
  type CourseWorkspace,
} from '@/lib/firebase';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getDemoCourseWorkspace } from '@/lib/demoData';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';

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
  const [authReady, setAuthReady] = useState(false);
  /** canView：可讀取 workspace（teacher / ta / admin / department_head）*/
  const [canView, setCanView] = useState(false);
  /** canManage：可編輯教材、批改作業、發布成績（teacher / ta / admin，不含系主任）*/
  const [canManage, setCanManage] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const isDeptHeadView = demoRole === 'department_head';
  const { success, info } = useToast();
  const store = useDemoStore();
  const dynAssignments = getDynamicAssignmentsForCourse(props.params.courseId, store);
  const [showAddHw, setShowAddHw] = useState(false);
  const [hwTitle, setHwTitle] = useState('');
  const [hwDue, setHwDue] = useState('');
  const [hwPoints, setHwPoints] = useState('100');
  const courseInfo = _getCourse(props.params.courseId);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setAuthReady(true);
      // Demo 模式：教師 / TA / 管理員 → 完整操作；系主任 → 唯讀瀏覽（canView = true, canManage = false）
      const viewAllowedRoles: string[] = ['teacher', 'ta', 'admin', 'department_head'];
      const manageAllowedRoles: string[] = ['teacher', 'ta', 'admin'];
      const canViewNow = viewAllowedRoles.includes(demoRole);
      setCanView(canViewNow);
      setCanManage(manageAllowedRoles.includes(demoRole));
      if (!canViewNow) {
        setAuthError(`目前以「${demoRole}」身份瀏覽，無教師課程管理權限。請從右上角切換為「🧑‍🏫 教師」或「🧑‍💻 TA」角色。`);
      }
      return;
    }

    const auth = getAuth();
    if (!auth) {
      setAuthReady(true);
      setCanView(false);
      setCanManage(false);
      setAuthError('目前無法驗證登入狀態。');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCanView(false);
        setCanManage(false);
        setAuthError('請先登入具備課程管理權限的帳號。');
        setAuthReady(true);
        return;
      }

      try {
        const membership = await checkGroupMembership(props.params.courseId, user.uid);
        const role = membership.role ?? '';
        const allowed = membership.isMember && ['owner', 'instructor', 'moderator'].includes(role);
        setCanView(allowed);
        setCanManage(allowed);
        setAuthError(allowed ? null : '你不是這門課程的教師或管理成員。');
      } catch {
        setCanView(false);
        setCanManage(false);
        setAuthError('無法確認你的課程權限。');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  // demoRole 加入 deps：角色切換時立即重新評估權限
  }, [props.params.courseId, demoRole]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!authReady) return;
      if (!canView) {
        setWorkspace(EMPTY_WORKSPACE);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const next = await fetchCourseWorkspace(props.params.courseId);
        if (!active) return;
        // demo fallback：Firebase 抓不到時用 demoData，讓教師端 demo 一定有畫面
        if (!next.course) {
          const demo = getDemoCourseWorkspace(props.params.courseId);
          if (demo) {
            setWorkspace(demo);
            return;
          }
        }
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
  }, [authReady, canView, props.params.courseId]);

  const summary = useMemo(
    () => ({
      pendingPublishing: workspace.assignments.filter((item) => !item.gradesPublished).length,
      activeAttendance: workspace.attendance.filter((session) => session.active).length,
      publishedGrades: workspace.gradebookRows.filter((row) => row.published).length,
      totalStudents: workspace.gradebookRows.length,
    }),
    [workspace],
  );
  // accessDenied：authReady 後 canView 仍為 false → 顯示錯誤提示
  const accessDenied = authReady && !canView;

  return (
    <SiteShell
      title={workspace.course?.name ? `${workspace.course.name} 教師端` : '教師工作台'}
      subtitle="最低可用教師工作台 · 教材、作業、點名與待批改入口"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {!isFirebaseConfigured() && !accessDenied ? (
          <div
            className="card"
            style={{
              padding: '10px 16px',
              background: 'var(--warning-soft)',
              borderColor: 'var(--warning)',
              fontSize: 13,
            }}
          >
            ⚠️ 目前 Firebase 未設定，教師端顯示的是最低可用框架。
          </div>
        ) : null}

        {accessDenied ? (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: 'var(--danger-soft)',
              borderColor: 'var(--danger)',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>無法存取教師工作台</div>
            <div style={{ fontSize: 14, opacity: 0.82 }}>
              {authError ?? '只有課程 owner、instructor 或 moderator 可以查看此頁面。'}
            </div>
          </div>
        ) : null}

        {!accessDenied ? (
          <>
            {/* TA 角色提示 */}
            {isTaView ? (
              <div className="card" style={{ padding: '12px 16px', background: 'rgba(124,58,237,0.10)', border: '1px solid #7C3AED', fontSize: 13, color: '#5B21B6' }}>
                🧑‍💻 <strong>助教 TA 視角</strong> ·
                你可以批改作業、查看出席與成績，但教材結構、題庫編輯、成績發布屬於授課教師的權限，相關按鈕會以灰色顯示。
              </div>
            ) : null}

            {/* 系主任唯讀提示 */}
            {isDeptHeadView ? (
              <div className="card" style={{ padding: '12px 16px', background: 'rgba(255,149,0,0.10)', border: '1px solid #FF9500', fontSize: 13, color: '#92400E' }}>
                🏛️ <strong>系主任唯讀視角</strong> ·
                你可以查看課程的教材、作業、出席與成績概況，但無法編輯教材、批改作業或發布成績。如需操作，請洽授課教師。
              </div>
            ) : null}

            <div className="metricGrid">
              <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
                <div className="metricIcon">📦</div>
                <div className="metricValue">{workspace.modules.length}</div>
                <div className="metricLabel">教材模組</div>
              </div>
              <div className="metricCard" style={{ '--tone': '#FF9500' } as CSSProperties}>
                <div className="metricIcon">📝</div>
                <div className="metricValue">{workspace.assignments.length}</div>
                <div className="metricLabel">作業 / 評量</div>
              </div>
              <div
                className="metricCard"
                style={
                  {
                    '--tone': summary.pendingPublishing > 0 ? '#DC2626' : '#34C759',
                  } as CSSProperties
                }
              >
                <div className="metricIcon">{summary.pendingPublishing > 0 ? '⏳' : '✅'}</div>
                <div className="metricValue">{summary.pendingPublishing}</div>
                <div className="metricLabel">待發布成績</div>
              </div>
              <div className="metricCard" style={{ '--tone': '#0EA5E9' } as CSSProperties}>
                <div className="metricIcon">👥</div>
                <div className="metricValue">{summary.totalStudents}</div>
                <div className="metricLabel">成績簿學生數</div>
              </div>
            </div>

            <div className="toolbarPanel" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="pill">
                  {summary.activeAttendance > 0 ? '課堂進行中' : '尚未啟動課堂'}
                </span>
                <span className="pill subtle">{summary.publishedGrades} 筆已發布</span>
              </div>
              {/* 系主任已被 auto-redirect 回教師端，無法瀏覽學生視角，故隱藏此按鈕 */}
              {!isDeptHeadView && (
                <Link href={`/course/${props.params.courseId}${q}`} className="btn">
                  學生視角
                </Link>
              )}
            </div>

            {/* ── TronClass parity 教師工具區 ── */}
            <nav
              className="toolbarPanel"
              aria-label="教師工具"
              style={{ flexWrap: 'wrap', gap: 8 }}
            >
              {/* 教材單元：TA 不能編輯結構，只能看 */}
              {caps.canEditModules ? (
                <Link href={`/teacher/course/${props.params.courseId}/modules${q}`} className="btn">
                  📚 教材單元
                </Link>
              ) : (
                <span
                  className="btn"
                  title="TA 無法編輯教材結構（僅授課教師可用）"
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                >
                  📚 教材單元（教師專用）
                </span>
              )}
              {/* 測驗：TA 可看，不可建 */}
              <Link href={`/teacher/course/${props.params.courseId}/quizzes${q}`} className="btn">
                📝 測驗 / 考試{isTaView ? '（檢視）' : ''}
              </Link>
              {/* 題庫：教師專用 */}
              {caps.canEditQuestionBank ? (
                <Link
                  href={`/teacher/course/${props.params.courseId}/question-banks${q}`}
                  className="btn"
                >
                  🗂️ 題庫
                </Link>
              ) : (
                <span
                  className="btn"
                  title="題庫編輯為授課教師專用"
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                >
                  🗂️ 題庫（教師專用）
                </span>
              )}
              <Link href={`/teacher/course/${props.params.courseId}/rubrics${q}`} className="btn">
                📐 Rubric
              </Link>
              <Link href={`/teacher/course/${props.params.courseId}/attendance${q}`} className="btn">
                ✅ 點名
              </Link>
              <Link href={`/teacher/course/${props.params.courseId}/gradebook${q}`} className="btn">
                📊 成績簿{isTaView ? '（批改）' : ''}
              </Link>
            </nav>

            <div className="pageGrid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="sectionCard">
                <div className="homeSectionHeader">
                  <h2 className="homeSectionTitle">教學內容</h2>
                  <span className="homeSectionNote">{workspace.modules.length} 個模組</span>
                </div>
                <div className="insetGroup">
                  {workspace.modules.map((module, index) => (
                    <div
                      key={module.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{module.title ?? '未命名模組'}</div>
                        <div className="insetGroupRowMeta">
                          {module.description ?? '可在 mobile 教師端新增教材與連結'}
                        </div>
                      </div>
                      <span className="pill subtle">{module.resourceCount ?? 0} 個資源</span>
                    </div>
                  ))}
                  {workspace.modules.length === 0 ? (
                    <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">尚無教材模組</div>
                        <div className="insetGroupRowMeta">
                          先在課程模組頁建立單元，web 教師端會同步顯示。
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="sectionCard">
                <div className="homeSectionHeader">
                  <h2 className="homeSectionTitle">待批改與發布</h2>
                  <span className="homeSectionNote">{workspace.assignments.length + dynAssignments.length} 項</span>
                </div>
                {/* 新增作業按鈕（教師專用，TA 不可） */}
                {caps.canEditModules && (
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                    {!showAddHw ? (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ fontSize: 12 }}
                        onClick={() => setShowAddHw(true)}
                      >
                        ＋ 新增作業
                      </button>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input
                          className="input"
                          placeholder="作業標題 *"
                          value={hwTitle}
                          onChange={(e) => setHwTitle(e.target.value)}
                          style={{ fontSize: 13 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="input"
                            type="date"
                            value={hwDue}
                            onChange={(e) => setHwDue(e.target.value)}
                            style={{ fontSize: 13, flex: 1 }}
                          />
                          <input
                            className="input"
                            type="number"
                            placeholder="配分"
                            value={hwPoints}
                            onChange={(e) => setHwPoints(e.target.value)}
                            style={{ fontSize: 13, width: 80 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn primary"
                            style={{ fontSize: 12 }}
                            disabled={!hwTitle.trim() || !hwDue}
                            onClick={() => {
                              if (!hwTitle.trim() || !hwDue) return;
                              // Guard：教師只能在自己授課的課程發布作業（避免假冒其他教師）
                              const course = _getCourse(props.params.courseId);
                              const demoUser = getDemoUser(demoRole);
                              if (course && course.instructorId !== demoUser?.uid && demoRole !== 'admin') {
                                info('你不是這門課的授課教師，無法新增作業');
                                return;
                              }
                              addAssignment({
                                courseId: props.params.courseId,
                                courseName: courseInfo?.name ?? '課程',
                                title: hwTitle.trim(),
                                due: hwDue,
                                points: parseInt(hwPoints) || 100,
                              });
                              success(`✅ 已新增作業「${hwTitle.trim()}」，學生已收到通知！`);
                              setHwTitle('');
                              setHwDue('');
                              setHwPoints('100');
                              setShowAddHw(false);
                            }}
                          >
                            ✓ 確認新增
                          </button>
                          <button type="button" className="btn" style={{ fontSize: 12 }} onClick={() => setShowAddHw(false)}>取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="insetGroup">
                  {/* 動態新增的作業（教師剛建立的） */}
                  {dynAssignments.map((assignment, index) => (
                    <div
                      key={assignment.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined, background: 'rgba(94,106,210,0.06)' }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">
                          🆕 {assignment.title}
                        </div>
                        <div className="insetGroupRowMeta">
                          截止 {assignment.due} · {assignment.points} 分 · 學生已收到通知
                        </div>
                      </div>
                      <span className="pill">新</span>
                    </div>
                  ))}
                  {workspace.assignments.map((assignment, index) => (
                    <div
                      key={assignment.id}
                      className="insetGroupRow"
                      style={{ borderTop: (index === 0 && dynAssignments.length === 0) ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{assignment.title}</div>
                        <div className="insetGroupRowMeta">
                          {assignment.gradesPublished ? '已發布成績' : '尚未發布成績'} ·{' '}
                          {assignment.submissionCount ?? 0} 份提交
                        </div>
                      </div>
                      <span className={`pill ${assignment.gradesPublished ? 'subtle' : ''}`}>
                        {((assignment.weight ?? 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                  {workspace.assignments.length === 0 && dynAssignments.length === 0 ? (
                    <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">尚無作業或評量</div>
                        <div className="insetGroupRowMeta">
                          點「＋ 新增作業」建立後，學生會自動收到通知。
                        </div>
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
                    <div
                      key={session.id}
                      className="insetGroupRow"
                      style={{ borderTop: index === 0 ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">
                          {session.active ? '進行中課堂' : '已結束課堂'}
                        </div>
                        <div className="insetGroupRowMeta">
                          {session.attendanceMode ?? '一般簽到'} · {session.attendeeCount} 人
                        </div>
                      </div>
                      <span className={`pill ${session.active ? '' : 'subtle'}`}>
                        {session.source}
                      </span>
                    </div>
                  ))}
                  {workspace.attendance.length === 0 ? (
                    <div className="insetGroupRow" style={{ borderTop: 'none' }}>
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
                  <span className="homeSectionNote">
                    {loading ? '載入中' : `${summary.totalStudents} 位學生`}
                  </span>
                </div>
                <div className="insetGroup">
                  <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">已發布成績</div>
                      <div className="insetGroupRowMeta">
                        目前可在 mobile 課內成績簿查看完整明細。
                      </div>
                    </div>
                    <span className="pill">{summary.publishedGrades}</span>
                  </div>
                  <div className="insetGroupRow">
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">尚未發布</div>
                      <div className="insetGroupRowMeta">包含未評分或未公開的作業項目。</div>
                    </div>
                    <span className="pill subtle">
                      {Math.max(summary.totalStudents - summary.publishedGrades, 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── AI 教學助理入口 ── */}
            <div
            className="card"
            style={{
              padding: '14px 18px',
              background: isTaView
                ? 'linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(167,139,250,0.06) 100%)'
                : 'linear-gradient(135deg, rgba(15,139,141,0.10) 0%, rgba(0,200,200,0.06) 100%)',
              border: `1px solid ${isTaView ? 'rgba(124,58,237,0.28)' : 'rgba(15,139,141,0.28)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: isTaView ? '#7C3AED' : '#0F8B8D', marginBottom: 3 }}>
                🤖 {isTaView ? 'AI 批改助理' : 'AI 教學助理'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {isTaView
                  ? '讓 AI 幫你生成批改評語範本、評分說明，或草擬回覆學生問題的標準答案。'
                  : '讓 AI 幫你分析班級成績分布、生成考題、或起草課程公告。'}
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(
                isTaView
                  ? `幫我針對「${workspace.course?.name ?? '資料結構'}」作業二生成評分說明和常見錯誤的批改評語範本`
                  : `幫我分析「${workspace.course?.name ?? '資料結構'}」班級的成績分布，找出需要特別關注的學生，並給出教學建議`
              )}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
          </>
        ) : (
          <div className="toolbarPanel" style={{ justifyContent: 'flex-end' }}>
            <Link href={`/course/${props.params.courseId}${q}`} className="btn">
              返回學生視角
            </Link>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
