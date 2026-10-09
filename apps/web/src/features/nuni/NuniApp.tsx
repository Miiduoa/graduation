'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { NuniSignIn } from '@/components/NuniSignIn';
import { SiteShell } from '@/components/SiteShell';
import { useNuniSession } from './Session';
import { CourseAccessBoundary, MutationForm, useClasses } from './CourseUI';
import { CourseAssignments } from './CourseAssignments';
import { WorkspaceList } from './WorkspaceList';
import { courseRoleLabels } from './courseTasks';
import { CourseMaterials } from './CourseMaterials';
import { CourseQuizzes } from './CourseQuizzes';
import styles from './NuniApp.module.css';

export function NuniHeader() {
  return <AppHeader />;
}

function Login() {
  const params = useSearchParams();
  const pathname = usePathname();
  return (
    <NuniSignIn
      returnUrl={params.get('returnUrl') || pathname || '/classroom'}
      issue={params.has('issue')}
    />
  );
}

function Workspace({ id }: { id: string }) {
  const classes = useClasses(beginCourseRequest);
  const { refresh } = useNuniSession();
  const [data, setData] = useState<{
    workspace: NuniWorkspace;
    assignments: NuniAssignment[];
  } | null>(null);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'materials' | 'assignments' | 'quizzes'>('assignments');
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const reload = () => setEpoch(++generation.current);
  function beginCourseRequest() {
    const started = generation.current;
    return () => {
      if (generation.current !== started) return;
      ++generation.current;
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
  const acceptAssignment = (assignment: NuniAssignment) => {
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
      <Link href="/classroom" className={styles.muted}>
        ← 我的課程
      </Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{courseRoleLabels[data.workspace.memberRole]}</p>
          <h1>{data.workspace.title}</h1>
          <p className={styles.muted}>
            {data.workspace.memberRole === 'owner-teacher'
              ? '你負責這門課，可以邀請學生、發布內容與回覆繳交。'
              : data.workspace.memberRole === 'co-teacher'
                ? '你可以發布內容與回覆繳交；邀請學生由課程負責老師處理。'
                : '查看老師發布的內容、繳交作業，並確認每一次繳交紀錄。'}
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
      <div className={styles.courseTabs} role="tablist" aria-label="課程內容">
        {(
          [
            ['materials', '教材'],
            ['assignments', '作業'],
            ['quizzes', '測驗'],
          ] as const
        ).map(([value, label]) => (
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
              const keys = ['materials', 'assignments', 'quizzes'] as const;
              const index = keys.indexOf(value);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % 3
                  : event.key === 'ArrowLeft'
                    ? (index + 2) % 3
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 2
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
        <section
          role="tabpanel"
          id="panel-materials"
          aria-labelledby="tab-materials"
          hidden={tab !== 'materials'}
        >
          <CourseMaterials workspace={data.workspace} />
        </section>
        <section
          role="tabpanel"
          id="panel-quizzes"
          aria-labelledby="tab-quizzes"
          hidden={tab !== 'quizzes'}
        >
          <CourseQuizzes workspace={data.workspace} />
        </section>
        <section
          role="tabpanel"
          id="panel-assignments"
          aria-labelledby="tab-assignments"
          hidden={tab !== 'assignments'}
        >
          <div className={styles.grid}>
            <CourseAssignments
              key={`${data.workspace.memberRole}:${data.workspace.state}`}
              assignments={data.assignments}
              workspace={data.workspace}
              reload={reload}
              onConfirmed={acceptAssignment}
            />
            <aside>
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
                          dueAt: due ? new Date(due).toISOString() : null,
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
  const { session, loading, error, refresh, pendingLogout, logout } = useNuniSession();
  let content: ReactNode;
  if (loading && !session) content = <p role="status">正在確認登入狀態…</p>;
  else if (!session || pathname === '/classroom/login') content = <Login />;
  else if (pathname === '/classroom/account')
    content = (
      <section className={styles.panel}>
        <h1>課程空間帳號</h1>
        <p className={styles.muted}>你目前使用 Nuni 帳號登入課程空間。</p>
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
