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
import { platformFetch } from './platformFetch';
import styles from './Platform.module.css';
import nuni from '@/features/nuni/NuniApp.module.css';
import common from '@/app/servicePages.module.css';

export function ClassCreate() {
  const auth = useNuniSession();
  const classes = useClasses();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const createKey = useRef(crypto.randomUUID());
  const inviteKey = useRef(crypto.randomUUID());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!auth.session) {
      window.location.replace(accountReturnHref(CREATE_PATH));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const workspace = await classes.create(title.trim(), `web-create-${createKey.current}`);
      const invite = await platformFetch(`/auth/platform/class-workspaces/${encodeURIComponent(workspace.id)}/invites`, {
        maxUses: 100,
        idempotencyKey: `web-invite-${inviteKey.current}`,
      });
      if (invite.status === 401) {
        window.location.replace(accountReturnHref(CREATE_PATH));
        return;
      }
      const code = typeof invite.body.code === 'string' ? invite.body.code : '';
      const dest = workspacePath(workspace.id);
      router.replace(code ? `${dest}?invite=${encodeURIComponent(code)}` : dest);
    } catch (failure) {
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
