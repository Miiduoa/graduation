'use client';
import { assignmentLifecycle } from './assignmentLifecycle';
import {
  startAssignmentLive,
  assignmentSyncLabel,
  type AssignmentSync,
} from '@campus/shared/src/assignmentLive';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniUnit,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  formatTaipeiDateTime,
  parseTaipeiInstant,
  taipeiParts,
  taipeiWallTimeToIso,
} from '@campus/shared/src/taipeiTime';
import { landOnCourseWork, parseCourseWorkHash } from '@/lib/courseWorkLanding';
import { AppHeader } from '@/components/AppHeader';
import { NuniSignIn } from '@/components/NuniSignIn';
import { SiteShell } from '@/components/SiteShell';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { useClientNow } from '@/lib/useMaterialClientState';
import { useLocationHash } from '@/lib/useLocationHash';
import { useNuniSession } from './Session';
import { CourseAccessBoundary, MutationForm, useClasses } from './CourseUI';
import { CourseAssignments } from './CourseAssignments';
import { WorkspaceList } from './WorkspaceList';
import { courseRoleLabels } from './courseTasks';
import { CourseMaterials } from './CourseMaterials';
import { CourseQuizzes } from './CourseQuizzes';
import { CourseLearningPath } from './CourseLearningPath';
import { CourseMembers } from './CourseMembers';
import { ClassroomSessions } from '@/features/platform/ClassroomSessions';
import { CourseUnitSelect } from './CourseUnitSelect';
import { selectCourseUnit } from './courseOutline';
import styles from './NuniApp.module.css';
import workspaceStyles from './CourseWorkspace.module.css';
import { useCoursePanel, type CoursePanel } from './useCoursePanel';
import {
  assignmentReferenceTiming,
  prioritizeCourseAssignments,
} from './courseAssignmentDiscovery';

export function NuniHeader() {
  return <AppHeader />;
}

function weekStartTaipei(now: Date): number | null {
  const parts = taipeiParts(now);
  if (!parts) return null;
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = shifted.getUTCDay() || 7;
  return Date.UTC(parts.year, parts.month - 1, parts.day) - (weekday - 1) * 24 * 60 * 60 * 1000;
}

function weekAssignments(assignments: NuniAssignment[], now = new Date()): NuniAssignment[] {
  const start = weekStartTaipei(now);
  if (start === null) return [];
  const end = start + 7 * 24 * 60 * 60 * 1000;
  return assignments.filter((item) => {
    if (!item.dueAt) return false;
    const due = parseTaipeiInstant(item.dueAt);
    if (due === null) return false;
    const dueDay = taipeiParts(due);
    if (!dueDay) return false;
    return (
      Date.UTC(dueDay.year, dueDay.month - 1, dueDay.day) >= start &&
      Date.UTC(dueDay.year, dueDay.month - 1, dueDay.day) < end
    );
  });
}

function Login() {
  const params = useSearchParams();
  const pathname = usePathname();
  const hash = useLocationHash();
  const query = params.toString();
  const currentPath = `${pathname || '/classroom'}${query ? `?${query}` : ''}${hash}`;
  return (
    <NuniSignIn returnUrl={params.get('returnUrl') || currentPath} issue={params.has('issue')} />
  );
}

function Workspace({ id }: { id: string }) {
  const hash = useLocationHash();
  const params = useSearchParams();
  const classes = useClasses(beginCourseRequest);
  const { refresh, session, pendingLogout } = useNuniSession();
  const [data, setData] = useState<{
    workspace: NuniWorkspace;
    assignments: NuniAssignment[];
  } | null>(null);
  const [error, setError] = useState('');
  const { panel: requestedTab, navigate: setTab, courseListHref } = useCoursePanel();
  const assignmentRevision = useRef(0);
  const liveClasses = useRef(classes);
  useEffect(() => {
    liveClasses.current = classes;
  });
  const [assignmentSync, setAssignmentSync] = useState<AssignmentSync>({
    state: 'updating',
    updatedAt: null,
  });
  useEffect(() => {
    if (!session || pendingLogout) {
      setData(null);
      return;
    }
    if (requestedTab !== 'assignments') return;
    return startAssignmentLive({
      read: () => liveClasses.current.assignments(id),
      revision: () => assignmentRevision.current,
      receive: (assignments) =>
        setData((current) => (current ? { ...current, assignments } : current)),
      clear: () => {
        setData(null);
        setError('目前無法存取這門課程，請重新確認登入與課程權限。');
      },
      status: setAssignmentSync,
      ...assignmentLifecycle(),
    });
    // 清單服務每次繪製會重建，透過 ref 讀取當前授權實例。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.context, pendingLogout, requestedTab]);
  const [epoch, setEpoch] = useState(0);
  const [code, setCode] = useState(params.get('invite') || '');
  const now = useClientNow();
  const [units, setUnits] = useState<NuniUnit[] | null>(null);
  const [unitsError, setUnitsError] = useState('');
  const [unitsEpoch, setUnitsEpoch] = useState(0);
  const [outlineVersion, setOutlineVersion] = useState(0);
  const refreshOutline = () => setOutlineVersion((value) => value + 1);
  const weekHash = hash.replace(/^#/, '').split('#')[0] === 'week';
  useEffect(() => {
    if (!weekHash || !data) return;
    const frame = window.requestAnimationFrame(() => {
      landOnCourseWork('week');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [weekHash, data]);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const unitGeneration = useRef(0);
  const reload = () => {
    refreshOutline();
    setEpoch(++generation.current);
  };
  const reloadUnits = () => setUnitsEpoch((value) => value + 1);
  function beginCourseRequest() {
    const started = generation.current;
    return () => {
      if (generation.current !== started) return;
      ++generation.current;
      if (parseCourseWorkHash(window.location.hash)?.kind === 'material') {
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search,
        );
      }
      setData(null);
      setCode('');
      setRefreshing(false);
      setError('目前無法存取這門課程，請重新確認課程權限。');
    };
  }
  useEffect(() => {
    let active = true;
    setRefreshing(true);
    setError('');
    void Promise.all([classes.get(id), classes.assignments(id)])
      .then(([workspace, assignments]) => {
        if (active && generation.current === epoch) setData({ workspace, assignments });
      })
      .catch((failure) => {
        if (!active || generation.current !== epoch) return;
        setError(nuniErrorMessage(failure));
        if (failure instanceof NuniError && [401, 403, 404].includes(failure.status)) {
          setData(null);
          setCode('');
        }
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refresh();
      })
      .finally(() => {
        if (active && generation.current === epoch) setRefreshing(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, epoch]);
  useEffect(() => {
    let active = true;
    const requestId = ++unitGeneration.current;
    setUnits(null);
    setUnitsError('');
    void classes
      .units(id)
      .then((result) => {
        if (active && unitGeneration.current === requestId && generation.current === epoch) {
          setUnits(result);
        }
      })
      .catch((failure) => {
        if (active && unitGeneration.current === requestId && generation.current === epoch) {
          setUnitsError(nuniErrorMessage(failure));
        }
      });
    return () => {
      active = false;
    };
    // The parent owns the account-scoped course client and remounts on session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, epoch, unitsEpoch]);
  const acceptUnit = (unit: NuniUnit) => {
    if (unit.workspaceId !== id) return;
    ++unitGeneration.current;
    setUnits((current) =>
      current ? [...current.filter((entry) => entry.id !== unit.id), unit] : current,
    );
  };
  if (error && !data)
    return (
      <div role="alert" className={styles.notice}>
        {error}{' '}
        <button className={styles.button} onClick={reload}>
          重試
        </button>
      </div>
    );
  if (!data) return <p role="status">正在讀取課程內容…</p>;
  const teacher = data.workspace.memberRole !== 'student';
  const tab = requestedTab === 'members' && !teacher ? 'assignments' : requestedTab;
  const tabs: Array<[CoursePanel, string]> = [
    ['outline', '學習路徑'],
    ['materials', '教材'],
    ['assignments', '作業'],
    ['quizzes', '測驗'],
    ['attendance', '點名'],
    ...(teacher ? [['members', '名冊'] as [CoursePanel, string]] : []),
  ];
  const pending =
    data.workspace.state === 'active'
      ? data.assignments.filter((item) => item.state === 'open' && !item.mySubmission)
      : [];
  const nextAssignment = prioritizeCourseAssignments(pending, data.workspace)[0];
  const submitted = data.assignments.filter((item) => !!item.mySubmission).length;
  const weekCount = weekAssignments(data.assignments).length;
  const weekPendingCount = weekAssignments(pending).length;
  const overdueCount = pending.filter(
    (item) => assignmentReferenceTiming(item, data.workspace, now) === 'overdue',
  ).length;
  const nextAssignmentTiming = nextAssignment
    ? assignmentReferenceTiming(nextAssignment, data.workspace, now)
    : 'none';
  const acceptAssignment = (assignment: NuniAssignment) => {
    assignmentRevision.current += 1;
    refreshOutline();
    setData((current) =>
      current && current.workspace.id === assignment.workspaceId
        ? {
            ...current,
            assignments: current.assignments.map((item) =>
              item.id === assignment.id ? assignment : item,
            ),
          }
        : current,
    );
  };
  return (
    <>
      <Link href={courseListHref} className={workspaceStyles.backLink}>
        <span aria-hidden>←</span> 我的課程
      </Link>
      <div className={`${styles.heading} ${workspaceStyles.courseHeading}`}>
        <div>
          <div className={workspaceStyles.context}>
            <span className={workspaceStyles.role}>
              {courseRoleLabels[data.workspace.memberRole]}
            </span>
            {data.workspace.state === 'archived' && (
              <span className={workspaceStyles.archived}>已封存</span>
            )}
          </div>
          <h1>{data.workspace.title}</h1>
          <p className={styles.muted}>
            {data.workspace.memberRole === 'owner-teacher'
              ? '你負責這門課，可以邀請學生、發布內容與回覆繳交。'
              : data.workspace.memberRole === 'co-teacher'
                ? '你可以發布內容與回覆繳交；邀請學生由課程負責老師處理。'
                : '教材、作業、測驗與簽到，都在這門課。'}
          </p>
        </div>
        <button
          className={`${styles.button} ${styles.secondary}`}
          onClick={reload}
          disabled={refreshing}
        >
          {refreshing ? '更新中…' : '更新內容'}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.notice}>
          {error} 已保留目前內容，可再次更新。
        </p>
      )}
      {data.assignments.length >= 100 && (
        <p className={styles.note}>
          目前已載入 {data.assignments.length} 份作業，較早的內容可能未包含在清單與筆數中。
        </p>
      )}
      <section
        className={workspaceStyles.overview}
        id="week"
        tabIndex={-1}
        aria-labelledby="nuni-week-title"
      >
        <div className={workspaceStyles.overviewTop}>
          <h2 id="nuni-week-title">作業概況</h2>
          <button
            type="button"
            className={workspaceStyles.textButton}
            onClick={() => setTab('assignments')}
          >
            查看全部作業 <span aria-hidden>↗</span>
          </button>
        </div>
        <dl className={workspaceStyles.metrics} data-role={teacher ? 'teacher' : 'student'}>
          <div>
            <dt>{teacher ? '已發布作業' : '待繳作業'}</dt>
            <dd>{teacher ? data.assignments.length : pending.length}</dd>
          </div>
          <div>
            <dt>{teacher ? '已收到繳交' : '已繳作業'}</dt>
            <dd>
              {teacher
                ? data.assignments.reduce((total, item) => total + item.submissionCount, 0)
                : submitted}
            </dd>
          </div>
          {!teacher && (
            <div data-urgent={overdueCount > 0}>
              <dt>已過參考時間</dt>
              <dd>{overdueCount}</dd>
            </div>
          )}
          <div>
            <dt>{teacher ? '本週參考期限' : '本週待繳'}</dt>
            <dd>{teacher ? weekCount : weekPendingCount}</dd>
          </div>
        </dl>
        {data.workspace.state === 'archived' ? (
          <p className={workspaceStyles.overviewNote}>課程已封存，內容與紀錄仍可查看。</p>
        ) : !teacher && nextAssignment ? (
          <a
            className={workspaceStyles.nextTask}
            data-urgency={nextAssignmentTiming}
            href={`#assignment-${encodeURIComponent(nextAssignment.id)}`}
            onClick={() => setTab('assignments')}
          >
            <span className={workspaceStyles.nextLabel}>
              {nextAssignmentTiming === 'overdue' ? '參考時間已過 · 優先補交' : '接著處理'}
            </span>
            <strong>{nextAssignment.title}</strong>
            <span className={workspaceStyles.nextTime}>
              {nextAssignment.dueAt
                ? `${nextAssignmentTiming === 'overdue' ? '仍在收件 · 原參考時間' : '參考時間'} ${formatTaipeiDateTime(nextAssignment.dueAt, { seconds: false })}`
                : '未設定參考期限'}
            </span>
            <span className={workspaceStyles.nextArrow} aria-hidden>
              →
            </span>
          </a>
        ) : !teacher ? (
          <p className={workspaceStyles.overviewNote}>
            目前沒有可繳交的待辦作業。測驗進度請到「測驗」查看。
          </p>
        ) : null}
      </section>
      <div
        className={`${styles.courseTabs} ${workspaceStyles.tabs}`}
        role="tablist"
        aria-label="課程內容"
      >
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const keys = tabs.map(([key]) => key);
              const index = keys.indexOf(value);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % keys.length
                  : event.key === 'ArrowLeft'
                    ? (index + keys.length - 1) % keys.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? keys.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setTab(keys[next]);
                document.getElementById(`tab-${keys[next]}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <CourseAccessBoundary beginRequest={beginCourseRequest}>
        {tab === 'attendance' && session && (
          <section role="tabpanel" id="panel-attendance" aria-labelledby="tab-attendance">
            <ClassroomSessions
              workspaceId={id}
              context={session.context}
              isTeacher={teacher}
              readOnly={data.workspace.state !== 'active'}
              units={(units ?? []).map(({ id: unitId, title }) => ({ id: unitId, title }))}
              beginRequest={beginCourseRequest}
              refreshVersion={epoch}
            />
          </section>
        )}
        {tab === 'members' && teacher && session && (
          <section role="tabpanel" id="panel-members" aria-labelledby="tab-members">
            <CourseMembers
              workspace={data.workspace}
              context={session.context}
              beginRequest={beginCourseRequest}
              refreshVersion={epoch}
            />
          </section>
        )}
        <section
          role="tabpanel"
          id="panel-outline"
          aria-labelledby="tab-outline"
          hidden={tab !== 'outline'}
        >
          <CourseLearningPath
            workspace={data.workspace}
            assignments={data.assignments}
            assignmentsError={error}
            assignmentsLoading={refreshing}
            units={units}
            unitsError={unitsError}
            refreshVersion={outlineVersion}
            reloadUnits={reloadUnits}
            onUnitCreated={acceptUnit}
            onNavigate={setTab}
          />
        </section>
        <section
          role="tabpanel"
          id="panel-materials"
          aria-labelledby="tab-materials"
          hidden={tab !== 'materials'}
        >
          <CourseMaterials workspace={data.workspace} units={units} onChanged={refreshOutline} />
        </section>
        <section
          role="tabpanel"
          id="panel-quizzes"
          aria-labelledby="tab-quizzes"
          hidden={tab !== 'quizzes'}
        >
          <CourseQuizzes workspace={data.workspace} units={units} onChanged={refreshOutline} />
        </section>
        <section
          role="tabpanel"
          id="panel-assignments"
          aria-labelledby="tab-assignments"
          hidden={tab !== 'assignments'}
        >
          <div className={teacher ? styles.grid : workspaceStyles.studentWork}>
            <p role="status">
              {assignmentSyncLabel(assignmentSync)}
              {assignmentSync.updatedAt
                ? ` · 最後更新 ${formatTaipeiDateTime(assignmentSync.updatedAt, { seconds: true })}`
                : ' · 尚未確認最新狀態'}
            </p>
            <CourseAssignments
              liveActive={tab === 'assignments'}
              key={`${data.workspace.memberRole}:${data.workspace.state}`}
              assignments={data.assignments}
              syncVersion={assignmentSync.updatedAt}
              workspace={data.workspace}
              reload={reload}
              onConfirmed={acceptAssignment}
            />
            <p className={styles.muted}>作業約每分鐘自動更新；回到畫面、切回分頁、網路恢復、自己送出或重新整理時立即更新。校方 LMS 等未串接來源請到原系統確認。</p>
            <aside className={!teacher ? workspaceStyles.studentAside : undefined}>
              {teacher && data.workspace.state === 'active' && (
                <>
                  <details className={`${styles.panel} ${styles.compose}`}>
                    <summary>發布作業</summary>
                    <MutationForm
                      label="發布作業"
                      success="作業已發布，學生可以從這門課查看並繳交。"
                      submit={async (form, key) => {
                        const due = String(form.get('dueAt') || '');
                        await classes.createAssignment(id, {
                          title: String(form.get('title')),
                          instructions: String(form.get('instructions')),
                          dueAt: taipeiWallTimeToIso(due),
                          unitId: selectCourseUnit(form, units),
                          idempotencyKey: key,
                        });
                        reload();
                      }}
                    >
                      <label>
                        作業名稱
                        <input name="title" required maxLength={160} />
                      </label>
                      <label>
                        作業說明
                        <textarea name="instructions" required maxLength={8000} />
                      </label>
                      <CourseUnitSelect units={units} />
                      <label>
                        參考期限（選填）
                        <input name="dueAt" type="datetime-local" />
                      </label>
                      <p className={styles.muted}>
                        參考期限不會自動停止收件。需要結束繳交時，請在作業內選擇「停止收件」。
                      </p>
                    </MutationForm>
                  </details>
                  {data.workspace.memberRole === 'owner-teacher' && (
                    <section className={styles.panel}>
                      <h2>邀請學生</h2>
                      <p className={styles.muted}>產生可供 30 人使用的邀請碼。</p>
                      <MutationForm
                        label="產生邀請碼"
                        submit={async (_, key) => {
                          const started = generation.current;
                          const invite = await classes.invite(id, key);
                          if (started !== generation.current)
                            throw new NuniError(409, 'SESSION_CHANGED');
                          setCode(invite.code);
                        }}
                      >
                        {null}
                      </MutationForm>
                      {code && (
                        <p className={styles.code} role="status">
                          {code}
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}
              <p className={styles.note}>這裡保留課程內的作業與回饋，正式成績請以學校紀錄為準。</p>
            </aside>
          </div>
        </section>
      </CourseAccessBoundary>
    </>
  );
}

function NuniContent() {
  const pathname = usePathname() || '/';
  const hydrated = useClientHydrated();
  const { session, loading, error, refresh, pendingLogout, logout } = useNuniSession();
  let content: ReactNode;
  if (!hydrated || (loading && !session)) content = <p role="status">正在確認登入狀態…</p>;
  else if (!session || pathname === '/classroom/login') content = <Login />;
  else if (pathname === '/classroom/account')
    content = (
      <section className={styles.panel}>
        <h1>Google 帳號</h1>
        <p className={styles.muted}>你目前使用 Google 帳號登入課程空間。</p>
        <p>校園個人資料與設定仍可從「所有服務」開啟，可在帳號設定查看各項登入狀態。</p>
        <p>課程身分由各課程管理；學校權限由學校核發。</p>
        <Link className={styles.button} href="/classroom">
          前往我的課程
        </Link>
      </section>
    );
  else if (pathname === '/classroom') content = <WorkspaceList key={session.context} />;
  else if (/^\/classroom\/course\/cw_[0-9a-f-]{36}$/.test(pathname))
    content = <Workspace key={`${session.context}:${pathname}`} id={pathname.split('/')[3]} />;
  else
    content = (
      <section className={styles.panel}>
        <h1>找不到這個課程空間</h1>
        <p className={styles.muted}>請回到課程空間確認網址，或從「所有服務」前往其他校園功能。</p>
        <Link className={styles.button} href="/classroom">
          回到我的課程
        </Link>
      </section>
    );
  return (
    <SiteShell header={<NuniHeader />}>
      {error && (
        <div role="alert" className={styles.notice}>
          {error}
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => void (pendingLogout ? logout() : refresh())}
          >
            重試
          </button>
        </div>
      )}
      {loading && session && <p role="status">正在確認登入狀態…</p>}
      <div hidden={loading && !!session} inert={loading && !!session}>
        {content}
      </div>
    </SiteShell>
  );
}

export function NuniApp() {
  return (
    <Suspense fallback={<p role="status">載入中…</p>}>
      <NuniContent />
    </Suspense>
  );
}
