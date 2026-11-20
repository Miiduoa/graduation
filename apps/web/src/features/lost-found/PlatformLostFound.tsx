'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createNuniLostFound,
  validateNuniLostFoundRequest,
} from '@campus/shared/src/nuniLostFound';
import { newLostFoundFields } from '@campus/shared/src/lostFoundFields';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { Button } from '@/components/ui/Button';
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import { todayTaipeiCalendarDate } from '@/lib/lostFound';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';
import {
  clearPlatformLostFoundPending,
  discardPlatformLostFoundPending,
  PlatformLostFoundStorageError,
  readPlatformLostFoundPending,
  savePlatformLostFoundPending,
  type PlatformLostFoundPending,
} from './platformLostFoundPending';
import {
  filtersFrom,
  errorMessage,
  isExpired,
  platformLostFoundHref,
  type Mode,
  type Scope,
  type Write,
  type Receipt,
} from './platformLostFoundUi';
import { PlatformLostFoundEditor } from './PlatformLostFoundEditor';
import { PlatformLostFoundList } from './PlatformLostFoundList';
import { PlatformLostFoundDetail } from './PlatformLostFoundDetail';
export { platformLostFoundHref } from './platformLostFoundUi';
import styles from '@/components/lost-found/LostFound.module.css';

export function PlatformLostFound({
  mode = 'list',
  id,
  search,
}: {
  mode?: Mode;
  id?: string;
  search?: ServiceListSearchParams;
}) {
  const auth = useOptionalNuniSession();
  const context = useBrowsingSchoolPageContext(search);
  const filters = filtersFrom(search);
  const destination = platformLostFoundHref(context.schoolId, mode, id, filters);
  const loginHref = '/classroom/login?returnUrl=' + encodeURIComponent(destination);
  const ready = !!auth?.session && !auth.loading && !auth.error && !auth.pendingLogout;
  return (
    <SiteShell
      title="失物招領"
      subtitle="找回遺失的物品，或替拾獲物尋找主人。"
      schoolName={context.schoolName}
    >
      {!context.ready ? (
        <SchoolScopePlaceholder />
      ) : (
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.toolbar}>
              <div>
                <h2>Google 帳號刊登</h2>
                <p className={styles.scopeNote}>{context.schoolName} · 不需要先連線學校帳號</p>
              </div>
              <Link
                className={styles.link}
                href={
                  '/lost-found?' +
                  new URLSearchParams({ schoolId: context.schoolId, source: 'school' })
                }
              >
                學校帳號的舊刊登
              </Link>
            </div>
          </section>
          {!ready ? (
            <section className={styles.panel}>
              {auth?.loading ? (
                <p role="status">正在確認 Google 帳號…</p>
              ) : (
                <>
                  <h2>登入後查看與刊登</h2>
                  <p>
                    {auth?.pendingLogout
                      ? '請先完成上一次登出，再繼續使用。'
                      : auth?.error || '使用 Google 帳號查看失物、刊登物品與管理自己的紀錄。'}
                  </p>
                  <Link className="btn primary" href={loginHref}>
                    使用 Google 帳號繼續
                  </Link>
                  {auth?.error && <Button onClick={() => void auth.refresh()}>重新確認帳號</Button>}
                  {auth?.pendingLogout && (
                    <Button onClick={() => void auth.logout()}>重試登出</Button>
                  )}
                </>
              )}
            </section>
          ) : (
            <Workspace
              key={[
                auth!.session!.platformAccountId,
                auth!.session!.context,
                context.schoolId,
                mode,
                id,
                JSON.stringify(filters),
              ].join(':')}
              accountId={auth!.session!.platformAccountId}
              context={auth!.session!.context}
              schoolId={context.schoolId}
              schoolName={context.schoolName}
              filters={filters}
              mode={mode}
              id={id}
              loginHref={loginHref}
              onExpired={() => void auth!.refresh()}
            />
          )}
        </div>
      )}
    </SiteShell>
  );
}

function Workspace({
  accountId,
  context,
  schoolId,
  schoolName,
  filters,
  mode,
  id,
  loginHref,
  onExpired,
}: Scope & {
  accountId: string;
  context: string;
  mode: Mode;
  id?: string;
  loginHref: string;
  onExpired: () => void;
}) {
  const router = useRouter();
  const client = useMemo(
    () => createNuniLostFound((path, input) => browserRequest(path, context, input)),
    [context],
  );
  const alive = useRef(false);
  const busyLock = useRef(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<PlatformLostFoundPending | null>(null);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the account-scoped receipt before enabling writes
      setPending(readPlatformLostFoundPending(accountId, schoolId));
    } catch {
      setStorageError('這個瀏覽器的待確認紀錄無法讀取。請先核對「我的刊登」，再清除本機紀錄。');
    }
    setReady(true);
  }, [accountId, schoolId]);

  const expire = () => {
    if (alive.current) {
      setExpired(true);
      onExpired();
    }
  };
  const write: Write = async (operation, success) => {
    if (!alive.current || busyLock.current || !ready || storageError || expired) return;
    busyLock.current = true;
    setBusy(true);
    setError('');
    try {
      validateNuniLostFoundRequest(operation.action, operation.input);
      const intent = savePlatformLostFoundPending(accountId, schoolId, operation);
      setPending(intent);
      let result: Receipt;
      switch (intent.action) {
        case 'create':
          result = await client.create(intent.input);
          break;
        case 'update':
          result = await client.update(intent.input);
          break;
        case 'resolve':
          result = await client.resolve(intent.input);
          break;
        case 'remove':
          result = await client.remove(intent.input);
          break;
      }
      if (!alive.current) return;
      // A confirmed close/remove must hide contact even if local receipt cleanup is unavailable.
      success?.(result);
      try {
        clearPlatformLostFoundPending(accountId, schoolId, intent.input.mutationId);
      } catch {
        setError('伺服器已確認完成，但本機待確認紀錄尚未清除。請重試同一筆操作以完成確認。');
        return;
      }
      setPending(null);
    } catch (reason) {
      if (!alive.current) return;
      if (isExpired(reason)) expire();
      else if (reason instanceof PlatformLostFoundStorageError)
        setStorageError(errorMessage(reason) + ' 請先核對自己的刊登，再清除本機待確認紀錄。');
      else setError(errorMessage(reason));
    } finally {
      busyLock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  function discard() {
    if (
      busyLock.current ||
      !window.confirm(
        '請先核對「我的刊登」。清除本機待確認紀錄不會撤銷已送出的刊登或操作，確定繼續？',
      )
    )
      return;
    try {
      discardPlatformLostFoundPending(accountId, schoolId);
      setPending(null);
      setStorageError('');
      setError('');
    } catch {
      setStorageError('仍無法清除本機紀錄，請確認瀏覽器儲存設定後重試。');
    }
  }
  const scope = { schoolId, schoolName, filters };
  if (expired)
    return (
      <section className={styles.panel}>
        <p role="alert">登入已失效或帳號已變更，資料已清除。</p>
        <Link href={loginHref}>重新登入</Link>
      </section>
    );
  if (!ready) return <p role="status">正在讀取待確認紀錄…</p>;
  const targetMode = pending?.action === 'create' ? 'create' : 'detail';
  const pendingHere =
    pending &&
    (mode === 'create'
      ? pending.action === 'create'
      : mode === 'detail' && pending.input.id === id);
  return (
    <>
      {(pending || storageError) && (
        <section className={styles.panel} aria-label="待確認操作">
          <h2>先確認上一筆操作</h2>
          <p role={storageError ? 'alert' : 'status'}>
            {storageError || '有一筆操作尚未完成確認。重試會沿用同一筆紀錄，請勿重新刊登。'}
          </p>
          <div className={styles.actions}>
            {pending && !pendingHere && (
              <Link
                className="btn"
                href={platformLostFoundHref(schoolId, targetMode, pending.input.id, filters)}
              >
                回到待確認操作
              </Link>
            )}
            <Link
              className={styles.link}
              href={platformLostFoundHref(schoolId, 'list', undefined, {
                mine: true,
                status: 'all',
              })}
            >
              核對我的刊登
            </Link>
            <Button disabled={busy} onClick={discard}>
              已核對，清除本機紀錄
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {mode === 'list' ? (
        <PlatformLostFoundList {...scope} client={client} expire={expire} />
      ) : mode === 'create' ? (
        <section className={styles.panel}>
          <Link
            className={styles.link}
            href={platformLostFoundHref(schoolId, 'list', undefined, filters)}
          >
            返回刊登列表
          </Link>
          <h2>刊登物品</h2>
          <PlatformLostFoundEditor
            key={pending?.input.id ?? 'new'}
            initial={
              pending?.action === 'create'
                ? pending.input.fields
                : newLostFoundFields(todayTaipeiCalendarDate())
            }
            pending={pending?.action === 'create'}
            busy={busy}
            disabled={!!storageError || (!!pending && pending.action !== 'create')}
            submitLabel="確認刊登"
            onSubmit={(fields) => {
              const operation =
                pending?.action === 'create'
                  ? pending
                  : {
                      action: 'create' as const,
                      input: {
                        schoolId,
                        fields,
                        id: 'plf_' + crypto.randomUUID(),
                        mutationId: crypto.randomUUID(),
                      },
                    };
              void write(operation, (receipt) =>
                router.replace(platformLostFoundHref(schoolId, 'detail', receipt.id, filters)),
              );
            }}
          />
        </section>
      ) : (
        <PlatformLostFoundDetail
          {...scope}
          id={id ?? ''}
          client={client}
          expire={expire}
          pending={pending}
          write={write}
          busy={busy}
          disabled={!!storageError}
        />
      )}
    </>
  );
}
