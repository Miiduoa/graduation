'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useClasses } from '@/features/nuni/CourseUI';
import { useNuniSession } from '@/features/nuni/Session';
import { ClassHonestyBanner } from './ClassHonestyBanner';
import { accountReturnHref, CREATE_PATH, JOIN_PATH, workspacePath } from './constants';
import styles from './Platform.module.css';
import nuni from '@/features/nuni/NuniApp.module.css';
import common from '@/app/servicePages.module.css';
import { useActiveRequest } from './useActiveRequest';

export function ClassJoin() {
  const auth = useNuniSession();
  if (auth.loading || auth.pendingLogout)
    return (
      <SiteShell header={<AppHeader />} title="加入課班">
        <p role="status">正在確認課班帳號…</p>
      </SiteShell>
    );
  return <ClassJoinContent key={`${auth.session?.platformAccountId}:${auth.session?.context}`} />;
}

function ClassJoinContent() {
  const auth = useNuniSession();
  const classes = useClasses();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const key = useRef(crypto.randomUUID());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    if (!auth.session) {
      window.location.replace(accountReturnHref(JOIN_PATH));
      return;
    }
    mutationPending.current = true;
    setBusy(true);
    setError('');
    try {
      const workspace = await classes.join(
        code
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, ''),
        `web-join-${key.current}`,
      );
      if (!isCurrent()) return;
      router.replace(workspacePath(workspace.id));
    } catch (failure) {
      if (!isCurrent()) return;
      mutationPending.current = false;
      if (failure instanceof NuniError && failure.status === 401) {
        window.location.replace(accountReturnHref(JOIN_PATH));
        return;
      }
      setError(nuniErrorMessage(failure) || '沒有加入成功，請確認邀請碼後再試。');
      if (!(failure instanceof NuniError) || failure.status >= 500) {
        /* keep the same idempotency key so retry confirms the same join */
      } else {
        key.current = crypto.randomUUID();
      }
      setBusy(false);
    }
  }

  return (
    <SiteShell header={<AppHeader />} title={undefined}>
      <div className={styles.page}>
        <ClassHonestyBanner />
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>課班工作區</p>
            <h1>加入課班</h1>
            <p className={styles.muted}>
              輸入老師提供的邀請碼。加入後只取得這一門課的學生身分，不是學校學籍。
            </p>
          </div>
          <div className={styles.links}>
            <Link href="/auth/account">回登入進門</Link>
            <Link href={CREATE_PATH}>開課班</Link>
          </div>
        </header>
        {!auth.session && !auth.loading ? (
          <section className={`${common.stateCard} ${styles.panel}`}>
            <h2>請先登入</h2>
            <p>加入課班需要已登入的平台帳號。登入後會回到這一頁。</p>
            <div className={common.actions}>
              <Link className={nuni.button} href={accountReturnHref(JOIN_PATH)}>
                前往登入
              </Link>
            </div>
          </section>
        ) : null}
        <section className={styles.panel}>
          <h2>邀請碼</h2>
          <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
            <Input
              label="邀請碼"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              minLength={6}
              maxLength={24}
              required
              disabled={busy || auth.loading}
              autoComplete="off"
              placeholder="輸入老師提供的代碼"
            />
            {error ? (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || auth.loading || code.trim().length < 6}>
              {busy ? '加入中…' : '加入並進入課班'}
            </Button>
          </form>
        </section>
      </div>
    </SiteShell>
  );
}
