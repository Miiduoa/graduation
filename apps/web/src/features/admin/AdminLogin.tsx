'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NuniError, nuniRecord, parseNuniPrincipal } from '@campus/shared/src/nuni';
import { SiteShell } from '@/components/SiteShell';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useNuniSession } from '@/features/nuni/Session';
import { useAdminMutation } from './hooks';
import { adminError } from './api';
import common from '@/app/servicePages.module.css';
import styles from './Admin.module.css';

export function AdminLogin() {
  const auth = useNuniSession();
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function authenticated() {
    setCompleting(true);
    await auth.refresh();
    if (mounted.current) router.replace('/admin');
  }
  return (
    <SiteShell title="管理員登入" subtitle="使用具有平台管理權限的帳號管理學校與服務。">
      {completing || auth.loading ? (
        <p role="status" className={common.loading}>
          正在確認登入狀態…
        </p>
      ) : auth.session?.isPlatformOperator ? (
        <section className={common.stateCard}>
          <h2>管理員已登入</h2>
          <p>目前帳號已具有平台管理權限，可以直接進入管理台。</p>
          <Link className={styles.link} href="/admin">
            進入管理台
          </Link>
        </section>
      ) : auth.session || auth.pendingLogout ? (
        <section className={common.stateCard}>
          <h2>{auth.pendingLogout ? '完成登出後再登入' : '目前帳號沒有管理權限'}</h2>
          <p>請先登出目前帳號，再使用管理員帳號登入。</p>
          {auth.error && <p role="alert">{auth.error}</p>}
          <div className={common.actions}>
            <Button onClick={() => void auth.logout()}>
              {auth.pendingLogout ? '重試登出' : '登出目前帳號'}
            </Button>
          </div>
        </section>
      ) : auth.error ? (
        <section className={common.stateCard}>
          <h2>無法確認帳號</h2>
          <p role="alert">{auth.error}</p>
          <div className={common.actions}>
            <Button onClick={() => void auth.refresh()}>重新確認</Button>
          </div>
        </section>
      ) : (
        <LoginForm onAuthenticated={authenticated} />
      )}
    </SiteShell>
  );
}

function LoginForm({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [complete, setComplete] = useState(false);
  const [responseError, setResponseError] = useState('');
  const mutation = useAdminMutation(undefined, !complete);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password || complete) return;
    setResponseError('');
    const result = await mutation.run('login', { email: email.trim(), password }, false);
    if (result === undefined || !mounted.current) return;
    try {
      const principal = parseNuniPrincipal(result);
      const context = nuniRecord(result).context;
      if (
        !principal.isPlatformOperator ||
        typeof context !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(context)
      )
        throw new NuniError(502, 'INVALID_RESPONSE');
    } catch (failure) {
      setResponseError(adminError(failure));
      return;
    }
    setPassword('');
    setComplete(true);
    await onAuthenticated();
  }
  return (
    <div className={common.loginLayout}>
      <form className={common.loginForm} onSubmit={submit}>
        <Input
          label="電子郵件"
          type="email"
          autoComplete="username"
          required
          maxLength={200}
          value={email}
          disabled={mutation.busy || complete}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="密碼"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={mutation.busy || complete}
          onChange={(event) => setPassword(event.target.value)}
        />
        {(mutation.error || responseError) && (
          <p role="alert" className={common.errorNotice}>
            {mutation.error || responseError}
          </p>
        )}
        <Button type="submit" variant="primary" loading={mutation.busy || complete}>
          登入管理台
        </Button>
      </form>
      <aside className={common.loginHelp}>
        <h2>已有 Google 管理員帳號</h2>
        <p>也可以使用原有的 Google 登入；登入後仍會確認平台管理權限。</p>
        <a className={styles.link} href="/auth/platform?returnUrl=%2Fadmin">
          使用 Google 登入
        </a>
        <p>一般帳號登入不會取得管理權限。</p>
      </aside>
    </div>
  );
}
