'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { CampusServiceMenu } from '@/components/CampusServiceMenu';
import { SchoolSelector } from '@/components/SchoolSelector';
import { SiteShell } from '@/components/SiteShell';
import { browserRequest, useNuniSession } from './Session';
import { CourseAccessBoundary, MutationForm, useClasses } from './CourseUI';
import { AssignmentCard } from './AssignmentCard';
import { CourseMaterials } from './CourseMaterials';
import { CourseQuizzes } from './CourseQuizzes';
import home from '@/app/home.module.css';
import styles from './NuniApp.module.css';

export function NuniHeader() {
  const { session, loading, logout, pendingLogout } = useNuniSession();
  const pathname = usePathname();
  return (
    <header className={home.header}>
      <Link href="/" className={home.brand}>
        <span className={home.mark} aria-hidden>
          C<span>1</span>
        </span>
        Campus One
      </Link>
      <nav aria-label="主要導覽" className={home.nav}>
        <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
          今日
        </Link>
        <Link
          href="/classroom"
          aria-current={
            pathname === '/classroom' || pathname?.startsWith('/classroom/course/')
              ? 'page'
              : undefined
          }
        >
          課程空間
        </Link>
        <Link
          href="/classroom/account"
          aria-current={pathname === '/classroom/account' ? 'page' : undefined}
        >
          課程帳號
        </Link>
        <CampusServiceMenu />
      </nav>
      <div className={home.account}>
        <SchoolSelector compact />
        {session?.isPlatformOperator && <Link href="/admin">平台管理</Link>}
        {session || pendingLogout ? (
          <button disabled={loading} onClick={() => void logout()}>
            {pendingLogout ? '重試登出' : '登出課程空間'}
          </button>
        ) : (
          <Link href="/classroom/login">登入課程空間</Link>
        )}
      </div>
    </header>
  );
}

function Login() {
  const params = useSearchParams();
  const { session, pendingLogout } = useNuniSession();
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void browserRequest('sign-in-options')
      .then((value) => {
        if (active)
          setGoogleAvailable(
            !!value && typeof value === 'object' && 'google' in value && value.google === true,
          );
      })
      .catch(() => {
        if (active) setGoogleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  return (
    <section className={`${styles.panel} ${styles.login}`}>
      <p className={styles.eyebrow}>CAMPUS ONE</p>
      <h1>回到你的課程</h1>
      <p className={styles.muted}>使用原有的 Nuni 帳號登入，課程與作業接著走。</p>
      {params.has('issue') && (
        <p role="alert" className={styles.notice}>
          這次登入沒有完成。請確認連線後，再試一次。
        </p>
      )}
      {session ? (
        <Link className={styles.button} href="/classroom">
          查看我的課程
        </Link>
      ) : googleAvailable ? (
        <form action="/auth/platform/start" method="post">
          <button className={styles.button} disabled={pendingLogout}>
            使用 Google 帳號繼續 <span aria-hidden>↗</span>
          </button>
        </form>
      ) : googleAvailable === null ? (
        <p role="status">正在確認登入服務…</p>
      ) : (
        <p role="status">
          登入服務目前無法使用。
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => {
              setGoogleAvailable(null);
              setRetry((value) => value + 1);
            }}
          >
            重新確認
          </button>
        </p>
      )}
      <p className={styles.muted}>
        課程空間可供老師開課、學生加入與繳交作業。學校核發的身分與校務權限另行確認。
      </p>
      <p className={styles.muted}>
        繼續前，請閱讀 <Link href="/privacy">隱私權政策</Link>與<Link href="/terms">服務條款</Link>
        。
      </p>
    </section>
  );
}

function WorkspaceList() {
  const classes = useClasses();
  const { refresh: refreshSession } = useNuniSession();
  const router = useRouter();
  const [items, setItems] = useState<NuniWorkspace[] | null>(null);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setItems(null);
    void classes
      .list()
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((failure) => {
        if (!active) return;
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refreshSession();
      });
    return () => {
      active = false;
    };
    // This view is keyed by the authenticated session in NuniContent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  const open = (workspace: NuniWorkspace) => router.push(`/classroom/course/${workspace.id}`);
  return (
    <>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>學習日常</p>
          <h1>我的課程</h1>
          <p className={styles.muted}>教材與作業，從每一門課開始。</p>
        </div>
        <button
          className={`${styles.button} ${styles.secondary}`}
          onClick={() => setEpoch((value) => value + 1)}
        >
          更新課程
        </button>
      </div>
      <div className={styles.grid}>
        <div>
          <section className={styles.focus}>
            <p>Campus One · Nuni 帳號</p>
            <h2>接著上次，繼續學習。</h2>
            <p>輸入老師提供的邀請碼，就能加入課程。你也可以建立自己的課程空間，安排作業與收件。</p>
          </section>
          <section className={styles.panel} aria-labelledby="courses-title">
            <h2 id="courses-title">課程一覽</h2>
            {error ? (
              <p role="alert">{error}</p>
            ) : !items ? (
              <p role="status">正在讀取課程…</p>
            ) : items.length ? (
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.id}>
                    <Link className={styles.row} href={`/classroom/course/${item.id}`}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.memberRole === 'student' ? '學生' : '授課老師'} ·{' '}
                          {item.state === 'active' ? '進行中' : '已封存'}
                        </small>
                      </span>
                      <span aria-hidden>↗</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>還沒有加入課程。取得邀請碼後，在右方輸入即可。</p>
            )}
          </section>
        </div>
        <aside>
          <section className={styles.panel}>
            <h2>加入課程</h2>
            <MutationForm
              label="加入課程"
              submit={async (data, key) =>
                open(
                  await classes.join(
                    String(data.get('code'))
                      .trim()
                      .toUpperCase()
                      .replace(/[\s-]+/g, ''),
                    key,
                  ),
                )
              }
            >
              <label>
                邀請碼
                <input
                  name="code"
                  required
                  minLength={6}
                  maxLength={24}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="輸入老師提供的代碼"
                />
              </label>
            </MutationForm>
          </section>
          <section className={styles.panel}>
            <h2>建立課程</h2>
            <MutationForm
              label="建立課程"
              submit={async (data, key) =>
                open(await classes.create(String(data.get('title')), key))
              }
            >
              <label>
                課程名稱
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="例如：設計專題"
                />
              </label>
            </MutationForm>
          </section>
          <p className={styles.note}>建立或加入課程不會取得學校的正式學籍、成績或管理權限。</p>
        </aside>
      </div>
    </>
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
  return (
    <>
      <Link href="/classroom" className={styles.muted}>
        ← 我的課程
      </Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{teacher ? '授課老師' : '學生'}</p>
          <h1>{data.workspace.title}</h1>
          <p className={styles.muted}>教材、作業與課堂測驗</p>
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
            <section aria-label="課程作業">
              {data.assignments.length ? (
                data.assignments.map((item) => (
                  <AssignmentCard
                    key={item.id}
                    item={item}
                    workspace={data.workspace}
                    reload={reload}
                  />
                ))
              ) : (
                <div className={styles.panel}>
                  <h2>作業</h2>
                  <p className={styles.muted}>老師還沒有發布作業。</p>
                </div>
              )}
            </section>
            <aside>
              {teacher && data.workspace.state === 'active' && (
                <>
                  <details className={`${styles.panel} ${styles.compose}`}>
                    <summary>發布作業</summary>
                    <MutationForm
                      label="發布作業"
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
                    </MutationForm>
                  </details>
                  {data.workspace.memberRole === 'owner-teacher' && (
                    <section className={styles.panel}>
                      <h2>邀請學生</h2>
                      <p className={styles.muted}>產生可供 30 人使用的邀請碼。</p>
                      <MutationForm
                        label="產生邀請碼"
                        submit={async (_, key) => setCode((await classes.invite(id, key)).code)}
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
        <p>校園個人資料與設定仍可從「所有服務」開啟，這裡的登出只會結束課程空間登入。</p>
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
