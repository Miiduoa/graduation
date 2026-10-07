'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthGuard';
import { isFirebaseConfigured, signInWithPuStudentId } from '@/features/auth/client';
import { sanitizeInternalPath } from '@/lib/navigation';
import styles from '../home.module.css';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const destination = sanitizeInternalPath(
    params.get('redirect') || params.get('returnUrl') || '/',
  );
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (user) router.replace(destination);
  }, [user, router, destination]);
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
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Campus One
        </Link>
      </header>
      <main className={styles.main} style={{ maxWidth: 550 }}>
        <p className={styles.eyebrow}>靜宜大學</p>
        <div className={styles.heading}>
          <h1>登入你的校園帳號。</h1>
        </div>
        <p className={styles.intro}>使用 e 校園學號與密碼，繼續查看課程與待辦。</p>
        <form onSubmit={login} style={{ display: 'grid', gap: 18, marginTop: 30 }}>
          <label>
            學號
            <input
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="characters"
              disabled={busy}
              style={{
                display: 'block',
                width: '100%',
                padding: 14,
                marginTop: 6,
                border: '1px solid #b2bcb1',
                borderRadius: 4,
                font: 'inherit',
              }}
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={busy}
              style={{
                display: 'block',
                width: '100%',
                padding: 14,
                marginTop: 6,
                border: '1px solid #b2bcb1',
                borderRadius: 4,
                font: 'inherit',
              }}
            />
          </label>
          {error && (
            <p role="alert" className={styles.notice}>
              {error}
            </p>
          )}
          <button
            className={styles.primary}
            type="submit"
            disabled={busy || !studentId.trim() || !password}
          >
            {busy ? '登入中…' : '登入'}
          </button>
        </form>
        <p style={{ marginTop: 26 }}>
          <Link href="/">← 返回首頁</Link>
        </p>
      </main>
    </div>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={<p>載入中…</p>}>
      <LoginForm />
    </Suspense>
  );
}
