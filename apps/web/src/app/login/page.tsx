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

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const reconnect = params.get('reconnect') === 'school';
  const destination = sanitizeInternalPath(
    params.get('redirect') || params.get('returnUrl') || '/',
  );
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (user && !reconnect) router.replace(destination);
  }, [user, router, destination, reconnect]);
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
      title={reconnect ? '重新連線學校帳號' : '登入你的校園帳號'}
      subtitle="使用 e 校園學號與密碼，繼續查看課程與待辦。"
      schoolName="靜宜大學"
    >
      <div className={styles.loginLayout}>
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
            {busy ? '登入中…' : '登入'}
          </Button>
        </form>
        <aside className={styles.loginHelp} aria-label="帳號與資料說明">
          <h2>使用學校原有的帳號</h2>
          <p>請輸入你登入 e 校園時使用的資料。若忘記密碼，請透過學校的帳號服務處理。</p>
          <div className={styles.helpLinks}>
            <Link href="/privacy">
              了解資料使用方式 <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/terms">
              閱讀使用條款 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <Link href="/" className={styles.backLink}>
            ← 返回首頁
          </Link>
        </aside>
      </div>
    </SiteShell>
  );
}
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <SiteShell title="登入校園帳號">
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
