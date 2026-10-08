'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  createNuniClasses,
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { GuestAuthProvider } from '@/components/AuthGuard';
import { browserRequest, NuniSessionProvider, useNuniSession } from './Session';
import home from '@/app/home.module.css';
import styles from './NuniApp.module.css';

function useClasses() {
  const { session } = useNuniSession();
  return createNuniClasses((path, input) => {
    if (!session) return Promise.reject(new NuniError(401, 'SIGN_IN_REQUIRED'));
    return browserRequest(path, session.context, input);
  });
}

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
          href="/groups"
          aria-current={
            pathname === '/groups' || pathname?.startsWith('/course/') ? 'page' : undefined
          }
        >
          課程
        </Link>
        <Link href="/profile" aria-current={pathname === '/profile' ? 'page' : undefined}>
          帳號
        </Link>
      </nav>
      <div className={home.account}>
        {session || pendingLogout ? (
          <button disabled={loading} onClick={() => void logout()}>
            {pendingLogout ? '重試登出' : '登出'}
          </button>
        ) : (
          <Link href="/login">登入</Link>
        )}
      </div>
    </header>
  );
}

function MutationForm({
  label,
  children,
  submit,
  success,
}: {
  label: string;
  children: ReactNode;
  submit: (data: FormData, key: string) => Promise<void>;
  success?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ data: FormData; key: string } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget;
    if (!attempt.current) attempt.current = { data: new FormData(form), key: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await submit(attempt.current.data, attempt.current.key);
      if (!mounted.current) return;
      attempt.current = null;
      setUncertain(false);
      setDone(true);
      form.reset();
    } catch (failure) {
      if (!mounted.current) return;
      const unknown = !(failure instanceof NuniError) || failure.status >= 500;
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(nuniErrorMessage(failure));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <fieldset disabled={busy || uncertain}>{children}</fieldset>
      {error && (
        <p role="alert">
          {error}
          {uncertain && ' 重試會確認同一筆送出結果，不會另建一筆。'}
        </p>
      )}
      {done && success && (
        <p role="status" className={styles.receipt}>
          {success}
        </p>
      )}
      <button className={styles.button} disabled={busy} type="submit">
        {busy ? '處理中…' : uncertain ? '確認送出結果' : label}
      </button>
    </form>
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
        <Link className={styles.button} href="/groups">
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
  const open = (workspace: NuniWorkspace) => router.push(`/course/${workspace.id}`);
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
                    <Link className={styles.row} href={`/course/${item.id}`}>
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

function Assignment({
  item,
  workspace,
  reload,
}: {
  item: NuniAssignment;
  workspace: NuniWorkspace;
  reload: () => void;
}) {
  const classes = useClasses();
  const [submissions, setSubmissions] = useState<NuniSubmission[] | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  const student = workspace.memberRole === 'student';
  return (
    <article className={styles.panel} id={`assignment-${item.id}`}>
      <h3>{item.title}</h3>
      <p className={styles.muted}>
        {item.state === 'closed' ? '已停止收件' : '開放繳交'} ·{' '}
        {item.dueAt ? `截止：${new Date(item.dueAt).toLocaleString('zh-TW')}` : '未設定截止時間'}
      </p>
      <p className={styles.prose}>{item.instructions}</p>
      {item.mySubmission && (
        <div className={styles.receipt}>
          <strong>已繳交</strong>
          <p>{new Date(item.mySubmission.submittedAt).toLocaleString('zh-TW')}</p>
          <p className={styles.prose}>{item.mySubmission.body}</p>
          {item.mySubmission.teacherFeedback && (
            <p className={styles.prose}>老師回饋：{item.mySubmission.teacherFeedback}</p>
          )}
        </div>
      )}
      {student && workspace.state === 'active' && item.state === 'open' && !item.mySubmission && (
        <MutationForm
          label="繳交作業"
          submit={async (data, key) => {
            await classes.submit(workspace.id, item.id, String(data.get('body')), key);
            reload();
          }}
        >
          <label>
            作業內容
            <textarea
              name="body"
              required
              maxLength={8000}
              placeholder="填寫內容，或附上作品連結。"
            />
          </label>
        </MutationForm>
      )}
      {!student && (
        <>
          <div className={styles.actions}>
            <span className={styles.muted}>{item.submissionCount} 份繳交</span>
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={reading}
              onClick={async () => {
                const run = ++request.current;
                setError('');
                setReading(true);
                setSubmissions(null);
                try {
                  const result = await classes.submissions(workspace.id, item.id);
                  if (run === request.current) setSubmissions(result);
                } catch (failure) {
                  if (run === request.current) setError(nuniErrorMessage(failure));
                } finally {
                  if (run === request.current) setReading(false);
                }
              }}
            >
              {reading ? '讀取中…' : '查看繳交內容'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {submissions &&
            (submissions.length ? (
              <ul className={styles.list}>
                {submissions.map((entry) => (
                  <li key={entry.platformAccountId}>
                    <p>
                      <strong>{entry.displayName || '課程成員'}</strong> ·{' '}
                      {new Date(entry.submittedAt).toLocaleString('zh-TW')}
                    </p>
                    <p className={styles.prose}>{entry.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>尚未收到作業。</p>
            ))}
        </>
      )}
    </article>
  );
}

function Workspace({ id }: { id: string }) {
  const classes = useClasses();
  const { refresh } = useNuniSession();
  const [data, setData] = useState<{
    workspace: NuniWorkspace;
    assignments: NuniAssignment[];
  } | null>(null);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [code, setCode] = useState('');
  const reload = () => setEpoch((value) => value + 1);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void Promise.all([classes.get(id), classes.assignments(id)])
      .then(([workspace, assignments]) => {
        if (active) setData({ workspace, assignments });
      })
      .catch((failure) => {
        if (!active) return;
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refresh();
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, epoch]);
  if (error)
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
      <Link href="/groups" className={styles.muted}>
        ← 我的課程
      </Link>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{teacher ? '授課老師' : '學生'}</p>
          <h1>{data.workspace.title}</h1>
          <p className={styles.muted}>課程作業與繳交紀錄</p>
        </div>
        <button className={`${styles.button} ${styles.secondary}`} onClick={reload}>
          更新內容
        </button>
      </div>
      <div className={styles.grid}>
        <section aria-label="課程作業">
          {data.assignments.length ? (
            data.assignments.map((item) => (
              <Assignment key={item.id} item={item} workspace={data.workspace} reload={reload} />
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
                    截止時間（選填）
                    <input name="dueAt" type="datetime-local" />
                  </label>
                </MutationForm>
              </details>
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
            </>
          )}
          <p className={styles.note}>這裡保留課程內的作業與回饋，正式成績請以學校紀錄為準。</p>
        </aside>
      </div>
    </>
  );
}

function NuniContent({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const { session, loading, error, refresh, pendingLogout, logout } = useNuniSession();
  if (['/privacy', '/terms'].includes(pathname))
    return <GuestAuthProvider>{children}</GuestAuthProvider>;
  let content: ReactNode;
  if (loading && !session) content = <p role="status">正在確認登入狀態…</p>;
  else if (!session || pathname === '/login') content = <Login />;
  else if (pathname === '/profile')
    content = (
      <section className={styles.panel}>
        <h1>我的帳號</h1>
        <p className={styles.muted}>你目前使用 Nuni 帳號登入。</p>
        <p>課程身分由各課程管理；學校權限由學校核發。</p>
        <Link className={styles.button} href="/groups">
          前往我的課程
        </Link>
      </section>
    );
  else if (pathname === '/' || pathname === '/groups' || pathname === '/join')
    content = <WorkspaceList key={session.context} />;
  else if (/^\/course\/cw_[0-9a-f-]{36}$/.test(pathname))
    content = <Workspace key={`${session.context}:${pathname}`} id={pathname.split('/')[2]} />;
  else
    content = (
      <section className={styles.panel}>
        <h1>這項服務尚未開放</h1>
        <p className={styles.muted}>你仍可以使用課程空間、發布與繳交作業。</p>
        <Link className={styles.button} href="/groups">
          回到我的課程
        </Link>
      </section>
    );
  return (
    <div className={styles.page}>
      <a className={home.skip} href="#nuni-content">
        跳到主要內容
      </a>
      <NuniHeader />
      <main className={styles.main} id="nuni-content">
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
      </main>
      <footer className={styles.footer}>
        <span>Campus One</span>
        <Link href="/privacy">隱私權政策</Link>
        <Link href="/terms">服務條款</Link>
      </footer>
    </div>
  );
}

export function NuniApp({ children }: { children: ReactNode }) {
  return (
    <NuniSessionProvider>
      <Suspense fallback={<p role="status">載入中…</p>}>
        <NuniContent>{children}</NuniContent>
      </Suspense>
    </NuniSessionProvider>
  );
}
