'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { AdminAudit } from '@/features/admin/AdminAudit';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { AdminMerchants } from '@/features/admin/AdminMerchants';
import { AdminPeople } from '@/features/admin/AdminPeople';
import { AdminSchools } from '@/features/admin/AdminSchools';
import { parseProxy, parseSchools } from '@/features/admin/api';
import {
  createPeopleParser,
  parseOversightMerchants,
  type OversightMerchantApplication,
  type OversightMerchantInterest,
} from '@/features/admin/oversightApi';
import type { SchoolLifecycleFilter } from '@/features/admin/adminNav';
import { useAdminResource } from '@/features/admin/hooks';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import {
  accountReturnHref,
  adminLoginHref,
  currentPageReturnPath,
  OPS_PATH,
  readOpsTab,
  readOpsSchool,
  SCHOOL_REVIEW_PATH,
  type OpsTab,
} from './constants';
import { adminFetch, asRecords } from './platformFetch';
import { useActiveRequest } from './useActiveRequest';
import { ReviewControls, type ReviewDecision } from './ReviewControls';
import styles from './Platform.module.css';

const tabs: Array<[OpsTab, string]> = [
  ['schools', '學校'],
  ['people', '人員'],
  ['merchants', '店家'],
  ['affiliation', '課班掛靠'],
  ['audit', '紀錄'],
];

function readTab(): OpsTab {
  if (typeof window === 'undefined') return 'schools';
  return readOpsTab(window.location.search, window.location.hash);
}

function readSchool(): string | null {
  return typeof window === 'undefined' ? null : readOpsSchool(window.location.search);
}

export function OpsConsole() {
  const auth = useNuniSession();
  const operator = !!auth.session?.isPlatformOperator;
  const suspended = auth.loading || auth.pendingLogout;
  const sessionKey = `${auth.session?.platformAccountId}:${auth.session?.context}`;
  const [tab, setTab] = useState<OpsTab>('schools');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolLifecycle, setSchoolLifecycle] = useState<SchoolLifecycleFilter>('all');
  const [auditQuery, setAuditQuery] = useState('');

  useEffect(() => {
    const sync = () => {
      setTab(readTab());
      setSchoolId(readSchool());
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  function go(next: OpsTab) {
    if (next === tab) return;
    setTab(next);
    const params = new URLSearchParams({ tab: next });
    if (schoolId) params.set('school', schoolId);
    window.history.pushState(null, '', OPS_PATH + '?' + params.toString());
  }

  function selectSchool(next: string | null) {
    setSchoolId(next);
    const params = new URLSearchParams({ tab });
    if (next) params.set('school', next);
    window.history.replaceState(null, '', OPS_PATH + '?' + params.toString());
  }

  return (
    <SiteShell header={<AdminHeader />} title={operator ? undefined : '平台管理'}>
      {operator ? (
        <div className={styles.page}>
          <header className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>平台營運</p>
              <h1>完整管理台</h1>
              <p className={styles.muted}>
                從接入審核、校方授權到店家與課班申請，集中完成營運作業。已開通學校需先取得限時代操作權限，審核通過也不代表正式開放服務。
              </p>
            </div>
            <nav className={styles.links} aria-label="營運作業">
              <Link href="/admin">管理總覽</Link>
              <Link href={SCHOOL_REVIEW_PATH}>接入審核</Link>
              <Link href={OPS_PATH} aria-current="page">營運作業</Link>
            </nav>
          </header>
          <div className={styles.tabs} role="tablist" aria-label="營運管理項目">
            {tabs.map(([id, label], index) => (
              <button
                key={id}
                id={'ops-tab-' + id}
                type="button"
                role="tab"
                tabIndex={tab === id ? 0 : -1}
                aria-controls={'ops-panel-' + id}
                aria-selected={tab === id}
                onClick={() => go(id)}
                onKeyDown={(event) => {
                  let nextIndex = index;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    nextIndex = (index + 1) % tabs.length;
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    nextIndex = (index - 1 + tabs.length) % tabs.length;
                  } else if (event.key === 'Home') {
                    nextIndex = 0;
                  } else if (event.key === 'End') {
                    nextIndex = tabs.length - 1;
                  } else {
                    return;
                  }
                  event.preventDefault();
                  const next = tabs[nextIndex][0];
                  go(next);
                  document.getElementById('ops-tab-' + next)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={styles.tabPanel}
            id={'ops-panel-' + tab}
            role="tabpanel"
            aria-labelledby={'ops-tab-' + tab}
            tabIndex={0}
          >
          {tab === 'schools' ? (
            <AdminSchools
              context={auth.session!.context}
              suspended={suspended}
              selectedId={schoolId}
              search={schoolQuery}
              lifecycle={schoolLifecycle}
              onSelect={selectSchool}
              onSearch={setSchoolQuery}
              onLifecycle={setSchoolLifecycle}
            />
          ) : null}
          {tab === 'people' ? (
            <PeopleTab
              key={sessionKey}
              context={auth.session!.context}
              suspended={suspended}
              selectedSchool={schoolId}
              onSchool={selectSchool}
              onManageSchool={() => go('schools')}
            />
          ) : null}
          {tab === 'merchants' ? (
            suspended ? (
              <p role="status">正在確認管理權限…</p>
            ) : (
              <MerchantsTab key={sessionKey} context={auth.session!.context} />
            )
          ) : null}
          {tab === 'affiliation' ? (
            suspended ? (
              <p role="status">正在確認管理權限…</p>
            ) : (
              <AffiliationTab key={sessionKey} context={auth.session!.context} />
            )
          ) : null}
          {tab === 'audit' ? (
            <AdminAudit
              context={auth.session!.context}
              suspended={suspended}
              query={auditQuery}
              onQuery={setAuditQuery}
            />
          ) : null}
          </div>
        </div>
      ) : auth.loading ? (
        <p role="status" className={common.loading}>
          正在確認管理權限…
        </p>
      ) : (
        <section className={`${common.stateCard} ${admin.gateCard}`}>
          <p className={admin.eyebrow}>平台管理員</p>
          <h2>{auth.session ? '沒有管理權限' : '請先登入管理員帳號'}</h2>
          <p>
            {auth.error ||
              (auth.session
                ? '目前帳號無法查看或修改平台管理資料。這與學校管理員身分不同。'
                : '登入後會確認你的平台管理權限。')}
          </p>
          <div className={common.actions}>
            <Link className={admin.link} href={adminLoginHref(currentPageReturnPath(OPS_PATH))}>
              前往管理員登入
            </Link>
            {auth.error ? <Button onClick={() => void auth.refresh()}>重新確認</Button> : null}
          </div>
        </section>
      )}
    </SiteShell>
  );
}

function PeopleTab({
  context,
  suspended,
  selectedSchool,
  onSchool,
  onManageSchool,
}: {
  context: string;
  suspended: boolean;
  selectedSchool: string | null;
  onSchool: (id: string | null) => void;
  onManageSchool: () => void;
}) {
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
      />
      <section className={styles.panel}>
        <h2>加人</h2>
        <p className={styles.muted}>
          可以隨時再加一位老師或職員。還沒有管理員時，第一位要先設成學校管理員。已經有管理員後，才可以再加學校職員。不會蓋掉現有的人。核准學校時仍然不會自動把申請人設成管理員。
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
            onManageSchool={onManageSchool}
            onAdded={() => setPeopleRevision((value) => value + 1)}
          />
        ) : (
          <p className={styles.muted}>先選一所學校，再加人。</p>
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
  onManageSchool,
  onAdded,
}: {
  context: string;
  tenantId: string;
  schoolName: string;
  requiresProxy: boolean;
  onManageSchool: () => void;
  onAdded: () => void;
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
  const [role, setRole] = useState<'school_admin' | 'school_staff'>('school_admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  useEffect(() => {
    if (!requiresProxy || !proxy.value || proxy.value.ended) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [requiresProxy, proxy.value]);
  const proxyActive =
    !!proxy.value && !proxy.value.ended && Date.parse(proxy.value.expiresAt) > now;
  const canBindStaff = boundHasRoleAdmin ?? people.value?.hasRoleAdmin ?? false;
  const ready =
    !people.loading &&
    !people.error &&
    !!people.value &&
    tenantId !== 'campus-demo' &&
    (!requiresProxy || (!proxy.loading && !proxy.error && proxyActive));
  return (
    <form
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
        const body: Record<string, unknown> = {
          tenantId,
          role: canBindStaff ? role : 'school_admin',
          idempotencyKey: `web-people-${crypto.randomUUID()}`,
        };
        if (trimmed.includes('@')) body.email = trimmed;
        else body.personId = trimmed;
        void adminFetch('people/bind', 'POST', body, context)
          .then((result) => {
            if (!isCurrent()) return;
            if (result.status === 401) {
              window.location.replace(accountReturnHref(`${OPS_PATH}?tab=people`));
              return;
            }
            if (!result.ok) throw new Error('加人沒有完成，請稍後再試。');
            try {
              const updated = parsePeople(result.body);
              setBoundHasRoleAdmin(updated.hasRoleAdmin);
            } catch {
              throw new Error('加人回應無法確認，請重新讀取授權名單。');
            }
            setAccount('');
            setNotice(`已為${schoolName}送出加人。`);
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
      {people.loading || (requiresProxy && proxy.loading) ? (
        <p role="status">正在確認校方授權…</p>
      ) : null}
      {people.error || (requiresProxy && proxy.error) ? (
        <p role="alert" className={styles.alert}>
          {people.error || proxy.error}
        </p>
      ) : null}
      {tenantId === 'campus-demo' ? (
        <p className={styles.notice}>示範學校不開放調整校方授權。</p>
      ) : null}
      {requiresProxy && !proxy.loading && !proxy.error && !proxyActive ? (
        <div className={styles.notice}>
          <p>已開通學校須先啟用代操作，才能加人。</p>
          <Button type="button" onClick={onManageSchool}>
            前往學校分頁啟用代操作
          </Button>
        </div>
      ) : null}
      <Input
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
        {busy ? '處理中…' : '加人'}
      </Button>
    </form>
  );
}

function MerchantsTab({ context }: { context: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  async function decide(
    path: string,
    id: string,
    decision: 'approve' | 'reject',
    expectedVersion?: number,
  ) {
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current || !id) return;
    mutationPending.current = true;
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      const result = await adminFetch(
        path,
        'POST',
        {
          decision,
          reason: decision === 'approve' ? '資料齊全，准予往下。' : '資料不足，請補件。',
          ...(expectedVersion === undefined
            ? { idempotencyKey: `web-merchant-decide-${crypto.randomUUID()}` }
            : { expectedVersion }),
        },
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(accountReturnHref(`${OPS_PATH}?tab=merchants`));
        return;
      }
      if (result.status === 409) {
        setRevision((value) => value + 1);
        throw new Error('這筆申請已更新，請確認最新資料後再審核。');
      }
      if (!result.ok) throw new Error('店家審核沒有完成，請稍後再試。');
      setNotice(decision === 'approve' ? '已核准這筆店家申請。' : '已拒絕這筆店家申請。');
      setRevision((value) => value + 1);
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : '店家審核沒有完成，請稍後再試。');
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }
  return (
    <div className={styles.stack}>
      <p className={styles.notice}>
        意向與進件都要先審過才能往下。點餐能力可以之後再改：可點餐、外連、只顯示資訊。公開與取消公開跟整校關閉無關。
      </p>
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
      <MerchantDecisions
        key={`decisions-${revision}`}
        context={context}
        busyId={busyId}
        onDecide={decide}
      />
      <AdminMerchants key={`overview-${revision}`} context={context} suspended={false} />
    </div>
  );
}

function MerchantDecisions({
  context,
  busyId,
  onDecide,
}: {
  context: string;
  busyId: string | null;
  onDecide: (
    path: string,
    id: string,
    decision: 'approve' | 'reject',
    expectedVersion?: number,
  ) => Promise<void>;
}) {
  const [interest, setInterest] = useState<OversightMerchantInterest[]>([]);
  const [applications, setApplications] = useState<OversightMerchantApplication[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void adminFetch('merchants', 'GET', undefined, context)
      .then((result) => {
        if (!active) return;
        if (!result.ok) throw new Error('目前讀不到待審店家。');
        const parsed = parseOversightMerchants(result.body);
        setInterest(parsed.interest.filter((row) => row.state === 'submitted'));
        setApplications(parsed.applications.filter((row) => row.state === 'submitted'));
      })
      .catch(() => {
        if (active) setError('目前讀不到待審店家。');
      });
    return () => {
      active = false;
    };
  }, [context]);
  if (!interest.length && !applications.length && !error) return null;
  return (
    <section className={styles.panel}>
      <h2>待審店家</h2>
      {error ? <p role="alert">{error}</p> : null}
      {interest.map((row) => {
        const id = String(row.id || '');
        return (
          <article key={id} className={styles.item}>
            <strong>
              {String(row.brandName || '意向')} · {String(row.schoolName || '')}
            </strong>
            <div className={styles.actions}>
              <Button
                disabled={busyId !== null || !id}
                onClick={() =>
                  void onDecide(
                    `merchants/interest/${encodeURIComponent(id)}/decision`,
                    id,
                    'approve',
                  )
                }
              >
                核准意向
              </Button>
              <Button
                disabled={busyId !== null || !id}
                onClick={() =>
                  void onDecide(
                    `merchants/interest/${encodeURIComponent(id)}/decision`,
                    id,
                    'reject',
                  )
                }
              >
                拒絕
              </Button>
            </div>
          </article>
        );
      })}
      {applications.map((row) => {
        const id = row.applicationId;
        return (
          <article key={id} className={styles.item}>
            <strong>
              {String(row.brandName || '進件')}／{String(row.locationName || '')}
            </strong>
            <div className={styles.actions}>
              <Button
                disabled={busyId !== null || !id}
                onClick={() =>
                  void onDecide(
                    `merchants/applications/${encodeURIComponent(row.tenantId)}/${encodeURIComponent(id)}/decision`,
                    id,
                    'approve',
                    row.version,
                  )
                }
              >
                核准進件
              </Button>
              <Button
                disabled={busyId !== null || !id}
                onClick={() =>
                  void onDecide(
                    `merchants/applications/${encodeURIComponent(row.tenantId)}/${encodeURIComponent(id)}/decision`,
                    id,
                    'reject',
                    row.version,
                  )
                }
              >
                拒絕
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function AffiliationTab({ context }: { context: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState('資料已核對，准予掛靠。');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const load = useCallback(
    async (isCurrent: () => boolean) => {
      const result = await adminFetch(
        'class-workspace-affiliation-applications',
        'GET',
        undefined,
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(accountReturnHref(`${OPS_PATH}?tab=affiliation`));
        return;
      }
      if (result.status === 403) {
        setError('這台帳號不能處理課班掛靠。');
        setRows([]);
        return;
      }
      if (!result.ok) throw new Error('目前讀不到掛靠申請。');
      setRows(asRecords(result.body.applications ?? result.body.items ?? result.body.affiliations));
    },
    [context],
  );
  useEffect(() => {
    const isCurrent = captureRequest();
    void load(isCurrent).catch((failure: Error) => {
      if (isCurrent()) setError(failure.message);
    });
  }, [captureRequest, load]);
  async function decide(id: string, decision: 'approve' | 'reject') {
    const isCurrent = captureRequest();
    if (
      !isCurrent() ||
      mutationPending.current ||
      !id ||
      (decision === 'approve' && !reason.trim())
    )
      return;
    mutationPending.current = true;
    setBusyId(id);
    setError('');
    try {
      const result = await adminFetch(
        `class-workspace-affiliation-applications/${encodeURIComponent(id)}/decision`,
        'POST',
        {
          decision,
          reason: decision === 'approve' ? reason.trim() : '資料不足，請補件後再申請。',
          idempotencyKey: `web-affiliate-decide-${crypto.randomUUID()}`,
        },
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(accountReturnHref(`${OPS_PATH}?tab=affiliation`));
        return;
      }
      if (!result.ok) throw new Error('掛靠審核沒有完成，請稍後再試。');
      await load(isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : '掛靠審核沒有完成，請稍後再試。');
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }
  return (
    <section className={styles.panel}>
      <h2>課班掛靠</h2>
      <p className={styles.muted}>核准後，課班會掛到指定學校班次。這不會改學生的正式選課。</p>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {rows.length === 0 && !error ? <p>目前沒有待處理的掛靠申請。</p> : null}
      {rows.map((row, index) => {
        const id = String(row.id || row.applicationId || '');
        return (
          <article
            key={id || String(row.workspaceId || `affiliation-${index}`)}
            className={styles.item}
          >
            <strong>{String(row.workspaceTitle || row.workspaceId || '課班')}</strong>
            <p className={styles.muted}>
              {String(row.tenantName || row.tenantId || '')}
              {row.sectionId ? ` · ${String(row.sectionId)}` : ''}
              {row.state ? ` · ${String(row.state)}` : ''}
            </p>
            {row.justification ? <p>{String(row.justification)}</p> : null}
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void decide(id, 'approve');
              }}
            >
              <Textarea
                label="核准原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                disabled={busyId !== null}
              />
              <div className={styles.actions}>
                <Button type="submit" disabled={busyId !== null || !id || !reason.trim()}>
                  核准掛靠
                </Button>
                <Button
                  type="button"
                  disabled={busyId !== null || !id}
                  onClick={() => void decide(id, 'reject')}
                >
                  拒絕
                </Button>
              </div>
            </form>
          </article>
        );
      })}
    </section>
  );
}
