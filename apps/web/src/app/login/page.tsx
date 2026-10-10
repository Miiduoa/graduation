'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthGuard';
import { isFirebaseConfigured, signInWithPuStudentId } from '@/features/auth/client';
import { sanitizeInternalPath } from '@/lib/navigation';
import styles from '../servicePages.module.css';
import { NuniSignIn } from '@/components/NuniSignIn';
import { platformDestination } from '@/lib/accountDestination';

function loginDestination(value: string | null): string {
  const safe = sanitizeInternalPath(value && value.length <= 1200 ? value : null);
  try {
    const path = decodeURIComponent(new URL(safe, 'https://campus.local').pathname).replace(
      /\/+$/,
      '',
    );
    if (
      ['/login', '/classroom/login', '/admin/login', '/sso-callback'].includes(path) ||
      /^\/(?:auth|api|_next)(?:\/|$)/.test(path)
    )
      return '/';
    return safe;
  } catch {
    return '/';
  }
}

function LoginForm({
  destination,
  reconnect,
  issue,
}: {
  destination: string;
  reconnect: boolean;
  issue: boolean;
}) {
  const router = useRouter();
  const { user, loading: schoolLoading } = useAuth();
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef<'school' | 'platform' | null>(null);
  const returning = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformBusy, setPlatformBusy] = useState(false);
  const [error, setError] = useState('');
  const schoolRequired = reconnect || platformDestination(destination) !== destination;
  const schoolAvailable = isFirebaseConfigured();
  useEffect(() => {
    const restore = () => {
      if (busyRef.current === 'platform') {
        busyRef.current = null;
        setPlatformBusy(false);
      }
    };
    window.addEventListener('pageshow', restore);
    return () => {
      request.current?.abort();
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  useEffect(() => {
    if (
      !schoolLoading &&
      !busyRef.current &&
      !returning.current &&
      user &&
      schoolRequired &&
      !reconnect
    ) {
      returning.current = true;
      router.replace(destination);
    }
  }, [user, schoolLoading, router, destination, reconnect, schoolRequired]);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || returning.current || schoolLoading) return;
    setError('');
    if (!isFirebaseConfigured()) {
      setError('登入服務尚未連線，請稍後再試。');
      return;
    }
    busyRef.current = 'school';
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const authenticated = await signInWithPuStudentId(
        studentId.trim().toUpperCase(),
        password,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!authenticated) throw new Error('登入服務尚未連線。');
      setPassword('');
      returning.current = true;
      router.replace(destination);
    } catch {
      if (controller.signal.aborted) return;
      setError('登入失敗。請確認學號與密碼，或稍後再試。');
    } finally {
      if (!controller.signal.aborted) {
        busyRef.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <SiteShell
      title={reconnect ? '重新連線學校帳號' : schoolRequired ? '連線學校帳號' : '登入 Campus One'}
      subtitle={
        schoolRequired
          ? '驗證學校帳號後，返回你原本的頁面。'
          : '課程交流與校務資料使用各自的帳號驗證。'
      }
    >
      <div className={styles.loginLayout}>
        {!schoolRequired && (
          <NuniSignIn
            returnUrl={destination}
            issue={issue}
            disabled={busy}
            onStart={() => {
              if (busyRef.current) return false;
              busyRef.current = 'platform';
              setPlatformBusy(true);
              return true;
            }}
          />
        )}
        <section className={styles.loginHelp} aria-label="學校校務登入">
          <h2>學校校務資料</h2>
          <p>查看學校提供的課表、成績與個人校務紀錄。目前支援靜宜大學 e 校園帳號。</p>
          {schoolRequired && <p>你要開啟的頁面需要學校帳號，Google 登入不會自動取得校務權限。</p>}
          {schoolAvailable ? (
            <details open={schoolRequired}>
              <summary>使用靜宜大學學號登入</summary>
              <form className={styles.loginForm} onSubmit={login} aria-busy={busy}>
                <Input
                  id="student-id"
                  name="studentId"
                  label="學號"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  required
                  autoComplete="username"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={busy || platformBusy || schoolLoading}
                />
                <Input
                  id="password"
                  name="password"
                  label="密碼"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={busy || platformBusy || schoolLoading}
                />
                {error && (
                  <p role="alert" className={styles.errorNotice}>
                    {error}
                  </p>
                )}
                <Button
                  variant="primary"
                  type="submit"
                  fullWidth
                  loading={busy}
                  disabled={busy || platformBusy || schoolLoading || !studentId.trim() || !password}
                >
                  {schoolLoading ? '正在確認學校帳號…' : busy ? '連線中…' : '連線學校帳號'}
                </Button>
              </form>
            </details>
          ) : (
            <p role="status">
              學校登入服務尚未開通。你仍可使用課程空間與公開交流；校務資料請先由學校原有服務查詢。
            </p>
          )}
          {schoolAvailable && (
            <p>請輸入你登入 e 校園時使用的資料。若忘記密碼，請透過學校的帳號服務處理。</p>
          )}
          <div className={styles.helpLinks}>
            <Link href="/privacy">
              了解資料使用方式 <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/terms">
              閱讀使用條款 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          {schoolRequired && (
            <Link href="/login" className={styles.backLink}>
              改用課程與跨校交流
            </Link>
          )}
          <Link href="/" className={styles.backLink}>
            ← 返回首頁
          </Link>
        </section>
      </div>
    </SiteShell>
  );
}
function LoginRoute() {
  const params = useSearchParams();
  const destination = loginDestination(params.get('redirect') || params.get('returnUrl'));
  const reconnect = params.get('reconnect') === 'school';
  return (
    <LoginForm
      key={`${destination}:${reconnect}`}
      destination={destination}
      reconnect={reconnect}
      issue={params.has('issue')}
    />
  );
}
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <SiteShell title="登入 Campus One">
          <p role="status" className={styles.loading}>
            正在載入登入表單…
          </p>
        </SiteShell>
      }
    >
      <LoginRoute />
    </Suspense>
  );
}
