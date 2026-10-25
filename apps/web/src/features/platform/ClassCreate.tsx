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

export function ClassCreate() {
  const auth = useNuniSession();
  if (auth.loading || auth.pendingLogout)
    return (
      <SiteShell header={<AppHeader />} title="開課班">
        <p role="status">正在確認課班帳號…</p>
      </SiteShell>
    );
  return <ClassCreateContent key={`${auth.session?.platformAccountId}:${auth.session?.context}`} />;
}

function ClassCreateContent() {
  const auth = useNuniSession();
  const classes = useClasses();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const createKey = useRef(crypto.randomUUID());
  const inviteKey = useRef(crypto.randomUUID());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    if (!auth.session) {
      window.location.replace(accountReturnHref(CREATE_PATH));
      return;
    }
    mutationPending.current = true;
    setBusy(true);
    setError('');
    try {
      const workspace = await classes.create(title.trim(), `web-create-${createKey.current}`);
      if (!isCurrent()) return;
      const invite = await classes.invite(workspace.id, `web-invite-${inviteKey.current}`, 100);
      if (!isCurrent()) return;
      const dest = workspacePath(workspace.id);
      router.replace(invite.code ? `${dest}?invite=${encodeURIComponent(invite.code)}` : dest);
    } catch (failure) {
      if (!isCurrent()) return;
      mutationPending.current = false;
      if (failure instanceof NuniError && failure.status === 401) {
        window.location.replace(accountReturnHref(CREATE_PATH));
        return;
      }
      setError(nuniErrorMessage(failure) || '課班沒有建立成功，請稍後再試。');
      setBusy(false);
    }
  }

  return (
    <SiteShell header={<AppHeader />}>
      <div className={styles.page}>
        <ClassHonestyBanner />
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>課班工作區</p>
            <h1>開課班</h1>
            <p className={styles.muted}>
              建立成功後會直接進入課班工作台，並產生邀請碼給學生加入。這不是正式開課，也不會寫進學校名冊。
            </p>
          </div>
          <div className={styles.links}>
            <Link href={JOIN_PATH}>改為加入課班</Link>
            <Link href="/auth/account">回登入進門</Link>
          </div>
        </header>
        {!auth.session && !auth.loading ? (
          <section className={`${common.stateCard} ${styles.panel}`}>
            <h2>請先登入</h2>
            <p>開課班需要已登入的平台帳號。登入後會回到這一頁。</p>
            <div className={common.actions}>
              <Link className={nuni.button} href={accountReturnHref(CREATE_PATH)}>
                前往登入
              </Link>
            </div>
          </section>
        ) : null}
        <section className={styles.panel}>
          <h2>課班</h2>
          <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
            <Input
              label="課班名稱"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={2}
              maxLength={120}
              disabled={busy || auth.loading}
              placeholder="例如：設計專題"
            />
            {error ? (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || auth.loading || title.trim().length < 2}>
              {busy ? '建立中…' : '建立並進入課班'}
            </Button>
          </form>
        </section>
      </div>
    </SiteShell>
  );
}
