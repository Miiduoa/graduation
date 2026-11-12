'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ACCOUNT_DEMO_ACTION_LABELS,
  applyAccountDemoAction,
  type AccountDemoAction,
  type AccountDemoPermissions,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { NuniError } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import { parseOwnedAccountDemo, readAccountDemo } from '@/lib/accountDemoClient';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

type Change = { permissions: AccountDemoPermissions } | { action: AccountDemoAction };
export type AccountDemoController = {
  demo: AccountDemoSnapshot;
  context: string;
  blocked: boolean;
  busy: boolean;
  error: string;
  notice: string;
  mutate: (change: Change) => Promise<boolean>;
  reload: () => Promise<void>;
};
type Props = {
  children: (controller: AccountDemoController) => ReactNode;
  fallback?: ReactNode;
  campusScoped?: boolean;
};

function ScopedContent({ controller, children }: { controller: AccountDemoController; children: Props['children'] }) {
  return children(controller);
}

function failureMessage(error: unknown) {
  if (error instanceof NuniError) {
    if (error.status === 409) return '資料已在其他畫面更新，請重新讀取後再操作。';
    if (error.status === 401) return '登入已失效，請重新登入。';
    if (error.code === 'DEMO_FEATURE_DISABLED') return '這項功能已關閉，請到設定開啟展示權限。';
    if (error.status === 403) return '目前帳號的權限已變更，請重新讀取。';
  }
  return '暫時無法確認帳號資料，請重新讀取後再操作。';
}

function Scope({ accountId, context, schoolId, children, fallback }: Props & {
  accountId: string;
  context: string;
  schoolId: string | null;
}) {
  const [demo, setDemo] = useState<AccountDemoSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const matchingSchool = useCallback((value: AccountDemoSnapshot | null) =>
    value && (!schoolId || toPublicSchoolId(value.profile.schoolId) === toPublicSchoolId(schoolId)) ? value : null,
  [schoolId]);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setNotice('');
    try {
      const next = matchingSchool(await readAccountDemo(context, accountId));
      if (!active.current || request !== generation.current) return;
      setDemo(next);
      setError('');
    } catch (failure) {
      if (!active.current || request !== generation.current) return;
      setDemo(null);
      setError(failureMessage(failure));
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [accountId, context, matchingSchool]);

  useEffect(() => {
    active.current = true;
    void reload();
    const refresh = () => { if (!document.hidden) void reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active.current = false;
      generation.current += 1;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);

  useEffect(() => {
    if (!demo) return;
    const deadline = setTimeout(() => {
      generation.current += 1;
      setDemo(null);
      setNotice('');
      setBusy(false);
    }, Math.min(2_147_483_647, Math.max(0, Date.parse(demo.expiresAt) - Date.now())));
    return () => clearTimeout(deadline);
  }, [demo]);

  const mutate = useCallback(async (change: Change) => {
    if (!active.current || !demo || busy || loading || error || inFlight.current || Date.parse(demo.expiresAt) <= Date.now()) return false;
    inFlight.current = true;
    const current = ++generation.current;
    const isCurrent = () => active.current && current === generation.current && Date.parse(demo.expiresAt) > Date.now();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Validate the intended transition before writing, then require its exact server receipt.
      const expectedState = 'action' in change ? applyAccountDemoAction(demo, change.action) : demo.state;
      const expectedPermissions = 'permissions' in change ? change.permissions : demo.permissions;
      const result = await browserRequest('account-demo', context, { expectedRevision: demo.revision, ...change });
      if (!isCurrent()) return false;
      const next = matchingSchool(parseOwnedAccountDemo(result, accountId));
      if (!next || next.revision !== demo.revision + 1 ||
          JSON.stringify(next.profile) !== JSON.stringify(demo.profile) || next.expiresAt !== demo.expiresAt ||
          JSON.stringify(next.permissions) !== JSON.stringify(expectedPermissions) ||
          JSON.stringify(next.state) !== JSON.stringify(expectedState)) throw new Error('回執不相符');
      const verified = matchingSchool(await readAccountDemo(context, accountId));
      if (!isCurrent()) return false;
      if (!verified || JSON.stringify(verified) !== JSON.stringify(next)) throw new Error('儲存後資料已變更');
      setDemo(verified);
      setNotice('permissions' in change ? '展示權限已儲存。' : change.action === 'reset'
        ? '展示進度已重設，權限設定保留。' : `${ACCOUNT_DEMO_ACTION_LABELS[change.action]}：展示紀錄已儲存。`);
      return true;
    } catch (failure) {
      if (isCurrent()) {
        setError(failureMessage(failure));
        if (failure instanceof NuniError && [401, 403].includes(failure.status)) setDemo(null);
      }
      return false;
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }, [accountId, busy, context, demo, error, loading, matchingSchool]);

  if (loading) return fallback ? <p role="status">正在核對帳號資料…</p> : null;
  const problem = error ? <div role="alert">
    <p>{error}</p>
    <button type="button" disabled={busy} onClick={() => void reload()}>重新讀取帳號資料</button>
  </div> : null;
  if (!demo) return <>{problem}{fallback}</>;
  return <>
    {problem}
    {notice ? <p role="status">{notice}</p> : null}
    <ScopedContent controller={{ demo, context, blocked: busy || Boolean(error), busy, error, notice, mutate, reload }}>
      {children}
    </ScopedContent>
  </>;
}

/** Scoped data inside existing features; it never grants a school or merchant role. */
export function AccountDemoScope({ children, fallback = null, campusScoped = true }: Props) {
  const auth = useOptionalNuniSession();
  const campus = useCampusBrowseContext();
  if (auth?.loading || auth?.pendingLogout || (campusScoped && campus.status === 'loading'))
    return fallback ? <p role="status">正在核對帳號資料…</p> : null;
  if (!auth?.session || auth.error || (campusScoped && (campus.status !== 'ready' || !campus.schoolId))) return fallback;
  const { platformAccountId, context } = auth.session;
  const schoolId = campusScoped ? campus.schoolId : null;
  return <Scope key={`${platformAccountId}:${context}:${schoolId ?? 'account'}`} accountId={platformAccountId}
    context={context} schoolId={schoolId} fallback={fallback}>{children}</Scope>;
}
