'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { AdminPeople } from './AdminPeople';
import { parseProxy, parseSchools } from './api';
import { createPeopleParser } from './oversightApi';
import { useAdminMutation, useAdminResource } from './hooks';
import { adminLoginHref, currentPageReturnPath, OPS_PATH } from '@/features/platform/constants';
import { adminFetch } from '@/features/platform/platformFetch';
import { useActiveRequest } from '@/features/platform/useActiveRequest';
import styles from '@/features/platform/Platform.module.css';

export type AdminPeopleManagementProps = {
  context: string;
  suspended: boolean;
  selectedSchool: string | null;
  onSchool: (id: string | null) => void;
  onManageSchool: (tenantId: string) => void;
  onDraftChange?: (dirty: boolean) => void;
};

export function AdminPeopleManagement(props: AdminPeopleManagementProps) {
  if (props.suspended) return <p role="status">正在確認管理權限…</p>;
  return <PeopleManagementContent key={props.context} {...props} />;
}

function PeopleManagementContent({
  context,
  suspended,
  selectedSchool,
  onSchool,
  onManageSchool,
  onDraftChange,
}: AdminPeopleManagementProps) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
  const [peopleRevision, setPeopleRevision] = useState(0);
  const eligible = useMemo(
    () =>
      (schools.value ?? []).filter((school) =>
        ['provisioned', 'open', 'suspended'].includes(school.lifecycle),
      ),
    [schools.value],
  );
  const tenantId = eligible.some((school) => school.tenantId === selectedSchool)
    ? selectedSchool
    : null;
  const selected = eligible.find((school) => school.tenantId === tenantId);
  return (
    <div className={styles.stack}>
      <AdminPeople
        key={peopleRevision}
        context={context}
        suspended={suspended}
        selectedSchool={tenantId}
        onSchool={onSchool}
        onManageSchool={onManageSchool}
        embedded
        schoolResource={schools}
      />
      <section className={styles.panel}>
        <h2>新增校方授權</h2>
        <p className={styles.muted}>
          先指定負責管理員，再依工作需要授權校方職員。已有管理員時預設新增職員；授課與業務承辦資格由校方另外指派。
        </p>
        {suspended ? (
          <p role="status">正在確認管理權限…</p>
        ) : tenantId && selected ? (
          <PeopleAddForm
            key={tenantId}
            context={context}
            tenantId={tenantId}
            schoolName={selected.displayName}
            requiresProxy={selected.lifecycle === 'open'}
            suspended={schools.loading || !!schools.error}
            onAdded={() => setPeopleRevision((value) => value + 1)}
            onDraftChange={onDraftChange}
          />
        ) : (
          <p className={styles.muted}>先選擇學校，再指定要授權的帳號。</p>
        )}
      </section>
    </div>
  );
}

function PeopleAddForm({
  context,
  tenantId,
  schoolName,
  requiresProxy,
  suspended,
  onAdded,
  onDraftChange,
}: {
  context: string;
  tenantId: string;
  schoolName: string;
  requiresProxy: boolean;
  suspended: boolean;
  onAdded: () => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const parsePeople = useMemo(() => createPeopleParser(tenantId), [tenantId]);
  const people = useAdminResource(
    `people?tenantId=${encodeURIComponent(tenantId)}`,
    context,
    parsePeople,
  );
  const parseSession = useCallback((value: unknown) => parseProxy(value, tenantId), [tenantId]);
  const proxy = useAdminResource(
    `schools/${encodeURIComponent(tenantId)}/proxy`,
    context,
    parseSession,
    requiresProxy,
  );
  const [now, setNow] = useState(() => Date.now());
  const [boundHasRoleAdmin, setBoundHasRoleAdmin] = useState<boolean | null>(null);
  const [account, setAccount] = useState('');
  const [role, setRole] = useState<'school_admin' | 'school_staff'>('school_staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const proxyMutation = useAdminMutation(context);
  useEffect(() => {
    onDraftChange?.(Boolean(account.trim()) || busy || proxyMutation.busy);
  }, [account, busy, proxyMutation.busy, onDraftChange]);
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);
  const [hasRetriedAuthorization, setHasRetriedAuthorization] = useState(false);
  const authorizationRetryPending = useRef(false);
  const authorizationRetryButton = useRef<HTMLButtonElement>(null);
  const authorizationFocusPending = useRef(false);
  const accountInput = useRef<HTMLInputElement>(null);
  const addPersonForm = useRef<HTMLFormElement>(null);
  const attachAuthorizationRetryButton = useCallback((button: HTMLButtonElement | null) => {
    authorizationFocusPending.current =
      !button && authorizationRetryButton.current === document.activeElement;
    authorizationRetryButton.current = button;
  }, []);
  useEffect(() => {
    if (!requiresProxy || !proxy.value || proxy.value.ended) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [requiresProxy, proxy.value]);
  const proxyActive =
    !!proxy.value && !proxy.value.ended && Date.parse(proxy.value.expiresAt) > now;
  const canBindStaff = boundHasRoleAdmin ?? people.value?.hasRoleAdmin ?? false;
  const ready =
    !suspended &&
    !proxyMutation.busy &&
    !people.loading &&
    !people.error &&
    !!people.value &&
    tenantId !== 'campus-demo' &&
    (!requiresProxy || (!proxy.loading && !proxy.error && proxyActive));
  const authorizationLoading = people.loading || (requiresProxy && proxy.loading);
  const authorizationError = people.error || (requiresProxy ? proxy.error : undefined);
  useLayoutEffect(() => {
    if (authorizationLoading) return;
    authorizationRetryPending.current = false;
    const restoreFocus = authorizationFocusPending.current;
    authorizationFocusPending.current = false;
    const isCurrent = captureRequest();
    if (!authorizationError && restoreFocus && isCurrent()) {
      const target = ready ? accountInput.current : addPersonForm.current;
      if (target?.isConnected && document.activeElement === document.body) target.focus();
    }
  }, [authorizationError, authorizationLoading, captureRequest, ready]);

  async function changeProxy(action: 'start' | 'end') {
    const isCurrent = captureRequest();
    if (!isCurrent() || suspended || busy || proxyMutation.busy || tenantId === 'campus-demo')
      return;
    setError('');
    setNotice('');
    const result = await proxyMutation.run(
      `schools/${encodeURIComponent(tenantId)}/proxy/${action}`,
      {},
      false,
    );
    if (!isCurrent() || result === undefined) return;
    try {
      const updated = parseSession(result);
      if (
        (action === 'start' && (updated.ended || Date.parse(updated.expiresAt) <= Date.now())) ||
        (action === 'end' && !updated.ended)
      )
        throw new Error('Unexpected proxy state');
      proxy.reload();
      setNotice(action === 'start' ? '已開始代操作，正在重新確認授權。' : '已結束代操作。');
    } catch {
      setError('無法確認代操作狀態，請重新讀取校方授權後再試。');
      proxy.reload();
    }
  }

  return (
    <form
      ref={addPersonForm}
      aria-label="新增校方授權"
      tabIndex={-1}
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const isCurrent = captureRequest();
        const trimmed = account.trim();
        if (
          !isCurrent() ||
          mutationPending.current ||
          !ready ||
          !trimmed ||
          trimmed.length > 200 ||
          (requiresProxy &&
            (!proxy.value || proxy.value.ended || Date.parse(proxy.value.expiresAt) <= Date.now()))
        )
          return;
        mutationPending.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        const signature = JSON.stringify([tenantId, trimmed, canBindStaff ? role : 'school_admin']);
        const idempotencyKey =
          retryKeys.current.get(signature) ?? `web-people-${crypto.randomUUID()}`;
        retryKeys.current.set(signature, idempotencyKey);
        const body: Record<string, unknown> = {
          tenantId,
          role: canBindStaff ? role : 'school_admin',
          idempotencyKey,
        };
        if (trimmed.includes('@')) body.email = trimmed;
        else body.personId = trimmed;
        void adminFetch('people/bind', 'POST', body, context)
          .then((result) => {
            if (!isCurrent()) return;
            if (result.status === 401) {
              window.location.replace(
                adminLoginHref(currentPageReturnPath(`${OPS_PATH}?tab=people`)),
              );
              return;
            }
            if (!result.ok) throw new Error('新增授權沒有完成，請稍後再試。');
            try {
              const updated = parsePeople(result.body);
              setBoundHasRoleAdmin(updated.hasRoleAdmin);
            } catch {
              throw new Error('無法確認新增授權的結果，請重新讀取授權名單。');
            }
            retryKeys.current.delete(signature);
            setAccount('');
            setNotice(`已為${schoolName}新增校方授權。`);
            onAdded();
          })
          .catch((failure: Error) => {
            if (isCurrent()) setError(failure.message);
          })
          .finally(() => {
            if (isCurrent()) {
              mutationPending.current = false;
              setBusy(false);
            }
          });
      }}
    >
      {authorizationLoading ? <p role="status">正在確認校方授權…</p> : null}
      {authorizationError ? (
        <p role="alert" className={styles.alert}>
          {authorizationError}
        </p>
      ) : null}
      {authorizationError || (hasRetriedAuthorization && authorizationLoading) ? (
        <Button
          ref={attachAuthorizationRetryButton}
          type="button"
          aria-disabled={authorizationLoading || busy}
          onClick={() => {
            const isCurrent = captureRequest();
            if (!isCurrent() || authorizationRetryPending.current || authorizationLoading || busy)
              return;
            authorizationRetryPending.current = true;
            setHasRetriedAuthorization(true);
            if (people.error) people.reload();
            if (requiresProxy && proxy.error) proxy.reload();
          }}
        >
          重新確認校方授權
        </Button>
      ) : null}
      {tenantId === 'campus-demo' ? (
        <p className={styles.notice}>示範學校不開放調整校方授權。</p>
      ) : null}
      {requiresProxy && !proxy.loading && !proxy.error && !proxyActive ? (
        <div className={styles.notice}>
          <p>已開通學校須先啟用代操作，才能新增授權。代操作有效 15 分鐘，異動會留下紀錄。</p>
          <div className={styles.actions}>
            <Button
              type="button"
              disabled={suspended || busy || proxyMutation.busy || tenantId === 'campus-demo'}
              onClick={() => void changeProxy('start')}
            >
              {proxyMutation.busy ? '處理中…' : '開始 15 分鐘代操作'}
            </Button>
          </div>
        </div>
      ) : null}
      {requiresProxy && !proxy.loading && !proxy.error && proxyActive ? (
        <div className={styles.notice}>
          <p>
            正在為{schoolName}代操作，將於{' '}
            {new Date(proxy.value!.expiresAt).toLocaleTimeString('zh-TW', { hour12: false })} 結束。
          </p>
          <Button
            type="button"
            disabled={suspended || busy || proxyMutation.busy}
            onClick={() => void changeProxy('end')}
          >
            結束代操作
          </Button>
        </div>
      ) : null}
      {proxyMutation.error ? (
        <p role="alert" className={styles.alert}>
          {proxyMutation.error}
        </p>
      ) : null}
      <Input
        ref={accountInput}
        label="Google 登入信箱或人員代號"
        value={account}
        onChange={(event) => setAccount(event.target.value)}
        required
        maxLength={200}
        disabled={busy || !ready}
        hint="填對方的 Google 登入信箱，或這所學校既有的人員代號。"
      />
      <Select
        label="角色"
        value={canBindStaff ? role : 'school_admin'}
        disabled={busy || !ready}
        onChange={(event) => setRole(event.target.value as 'school_admin' | 'school_staff')}
        options={[
          { value: 'school_admin', label: '學校管理員' },
          ...(canBindStaff ? [{ value: 'school_staff', label: '學校職員' }] : []),
        ]}
      />
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !ready || !account.trim()}>
        {busy ? '處理中…' : '新增授權'}
      </Button>
    </form>
  );
}
