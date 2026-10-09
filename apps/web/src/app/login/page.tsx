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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const reconnect = params.get('reconnect') === 'school';
  const destination = loginDestination(params.get('redirect') || params.get('returnUrl'));
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const schoolRequired = reconnect || platformDestination(destination) !== destination;
  const schoolAvailable = isFirebaseConfigured();
  useEffect(() => {
    if (user && schoolRequired && !reconnect) router.replace(destination);
  }, [user, router, destination, reconnect, schoolRequired]);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    setError('');
    if (!isFirebaseConfigured()) {
      setError('登入服務尚未連線，請稍後再試。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const authenticated = await signInWithPuStudentId(studentId.trim().toUpperCase(), password);
      if (!authenticated) throw new Error('登入服務尚未連線。');
      setPassword('');
      router.replace(destination);
    } catch {
      setError('登入失敗。請確認學號與密碼，或稍後再試。');
    } finally {
      busyRef.current = false;
      setBusy(false);
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
        {!schoolRequired && <NuniSignIn returnUrl={destination} issue={params.has('issue')} />}
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
                  disabled={busy}
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
                  disabled={busy}
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
                  disabled={busy || !studentId.trim() || !password}
                >
                  {busy ? '連線中…' : '連線學校帳號'}
                </Button>
              </form>
            </details>
          ) : (
            <p role="status">
              學校登入服務尚未開通。你仍可使用課程空間與公開交流；校務資料請先由學校原有服務查詢。
            </p>
          )}
          <p>請輸入你登入 e 校園時使用的資料。若忘記密碼，請透過學校的帳號服務處理。</p>
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
      <LoginForm />
    </Suspense>
  );
}
