'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { AdminAudit } from '@/features/admin/AdminAudit';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { AdminMerchants } from '@/features/admin/AdminMerchants';
import { AdminPeople } from '@/features/admin/AdminPeople';
import { AdminSchools } from '@/features/admin/AdminSchools';
import { parseSchools } from '@/features/admin/api';
import type { SchoolLifecycleFilter } from '@/features/admin/adminNav';
import { useAdminResource } from '@/features/admin/hooks';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import { accountReturnHref, isOpsTab, OPS_PATH, SCHOOL_REVIEW_PATH, type OpsTab } from './constants';
import { adminFetch, asRecords } from './platformFetch';
import { parseOversightMerchants } from '@/features/admin/oversightApi';
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
  const params = new URLSearchParams(window.location.search);
  if (isOpsTab(params.get('tab'))) return params.get('tab') as OpsTab;
  const hash = window.location.hash.replace(/^#/, '');
  return isOpsTab(hash) ? hash : 'schools';
}

export function OpsConsole() {
  const auth = useNuniSession();
  const operator = !!auth.session?.isPlatformOperator;
  const [tab, setTab] = useState<OpsTab>('schools');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolLifecycle, setSchoolLifecycle] = useState<SchoolLifecycleFilter>('all');
  const [auditQuery, setAuditQuery] = useState('');

  useEffect(() => {
    setTab(readTab());
    const sync = () => setTab(readTab());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  function go(next: OpsTab) {
    setTab(next);
    window.history.replaceState(null, '', `${OPS_PATH}?tab=${next}`);
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
                審核接入、開放或關閉學校、全站店家留資與稽核。已開通學校的日常設定預設只看，需要時再代操作。核准申請還不會讓學生找得到學校。
              </p>
            </div>
            <nav className={styles.links} aria-label="營運作業">
              <Link href={SCHOOL_REVIEW_PATH}>審核</Link>
              <Link href={OPS_PATH} aria-current="page">
                開通
              </Link>
              <Link href={`${OPS_PATH}?tab=affiliation`}>掛靠</Link>
            </nav>
          </header>
          <div className={styles.tabs} role="tablist" aria-label="管理項目">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'schools' ? (
            <AdminSchools
              context={auth.session!.context}
              suspended={auth.loading}
              selectedId={schoolId}
              search={schoolQuery}
              lifecycle={schoolLifecycle}
              onSelect={setSchoolId}
              onSearch={setSchoolQuery}
              onLifecycle={setSchoolLifecycle}
            />
          ) : null}
          {tab === 'people' ? (
            <PeopleTab
              context={auth.session!.context}
              suspended={auth.loading}
              selectedSchool={schoolId}
              onSchool={setSchoolId}
            />
          ) : null}
          {tab === 'merchants' ? (
            <MerchantsTab context={auth.session!.context} suspended={auth.loading} />
          ) : null}
          {tab === 'affiliation' ? (
            <AffiliationTab context={auth.session!.context} />
          ) : null}
          {tab === 'audit' ? (
            <AdminAudit
              context={auth.session!.context}
              suspended={auth.loading}
              query={auditQuery}
              onQuery={setAuditQuery}
            />
          ) : null}
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
            <Link className={admin.link} href="/admin/login">
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
}: {
  context: string;
  suspended: boolean;
  selectedSchool: string | null;
  onSchool: (id: string | null) => void;
}) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
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
        {tenantId && selected ? (
          <PeopleAddForm
            tenantId={tenantId}
            schoolName={selected.displayName}
            context={context}
          />
        ) : (
          <p className={styles.muted}>先選一所學校，再加人。</p>
        )}
      </section>
    </div>
  );
}

function PeopleAddForm({
  tenantId,
  schoolName,
  context,
}: {
  tenantId: string;
  schoolName: string;
  context: string;
}) {
  const [account, setAccount] = useState('');
  const [role, setRole] = useState<'school_admin' | 'school_staff'>('school_admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        setNotice('');
        const trimmed = account.trim();
        const body: Record<string, unknown> = {
          role,
          idempotencyKey: `web-people-${crypto.randomUUID()}`,
        };
        if (trimmed.includes('@')) body.email = trimmed;
        else body.personId = trimmed;
        void adminFetch(`schools/${encodeURIComponent(tenantId)}/people`, 'POST', body, context)
          .then((result) => {
            if (result.status === 401) {
              window.location.replace(accountReturnHref(`${OPS_PATH}?tab=people`));
              return;
            }
            if (!result.ok) throw new Error('加人沒有完成，請稍後再試。');
            setAccount('');
            setNotice(`已為${schoolName}送出加人。`);
          })
          .catch((failure: Error) => setError(failure.message))
          .finally(() => setBusy(false));
      }}
    >
      <Input
        label="Google 登入信箱或人員代號"
        value={account}
        onChange={(event) => setAccount(event.target.value)}
        required
        disabled={busy}
        hint="填對方的 Google 登入信箱，或這所學校既有的人員代號。"
      />
      <Select
        label="角色"
        value={role}
        onChange={(event) => setRole(event.target.value as 'school_admin' | 'school_staff')}
        options={[
          { value: 'school_admin', label: '學校管理員' },
          { value: 'school_staff', label: '學校職員' },
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
      <Button type="submit" disabled={busy || !account.trim()}>
        {busy ? '處理中…' : '加人'}
      </Button>
    </form>
  );
}

function MerchantsTab({ context, suspended }: { context: string; suspended: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function decide(path: string, id: string, decision: 'approve' | 'reject') {
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
          idempotencyKey: `web-merchant-decide-${crypto.randomUUID()}`,
        },
        context,
      );
      if (result.status === 401) {
        window.location.replace(accountReturnHref(`${OPS_PATH}?tab=merchants`));
        return;
      }
      if (!result.ok) throw new Error('店家審核沒有完成，請稍後再試。');
      setNotice(decision === 'approve' ? '已核准這筆店家申請。' : '已拒絕這筆店家申請。');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '店家審核沒有完成，請稍後再試。');
    } finally {
      setBusyId(null);
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
      <MerchantDecisions context={context} busyId={busyId} onDecide={decide} />
      <AdminMerchants context={context} suspended={suspended} />
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
  onDecide: (path: string, id: string, decision: 'approve' | 'reject') => Promise<void>;
}) {
  const [interest, setInterest] = useState<ReturnType<typeof parseOversightMerchants>['interest']>([]);
  const [applications, setApplications] = useState<
    ReturnType<typeof parseOversightMerchants>['applications']
  >([]);
  useEffect(() => {
    let active = true;
    void adminFetch('merchants', 'GET', undefined, context).then((result) => {
      if (!active || result.status === 401) {
        if (result.status === 401) window.location.replace(accountReturnHref(`${OPS_PATH}?tab=merchants`));
        return;
      }
      if (!result.ok) return;
      try {
        const parsed = parseOversightMerchants(result.body);
        setInterest(parsed.interest.filter((row) => row.state === 'submitted'));
        setApplications(parsed.applications.filter((row) => row.state === 'submitted'));
      } catch {
        setInterest([]);
        setApplications([]);
      }
    });
    return () => {
      active = false;
    };
  }, [context]);
  if (!interest.length && !applications.length) return null;
  return (
    <section className={styles.panel}>
      <h2>待審店家</h2>
      {interest.map((row) => {
        const id = String(row.id || '');
        return (
          <article key={id} className={styles.item}>
            <strong>
              {String(row.brandName || '意向')} · {String(row.schoolName || '')}
            </strong>
            <div className={styles.actions}>
              <Button
                disabled={busyId === id}
                onClick={() =>
                  void onDecide(
                    `merchant-interest/${encodeURIComponent(id)}/decision`,
                    id,
                    'approve',
                  )
                }
              >
                核准意向
              </Button>
              <Button
                disabled={busyId === id}
                onClick={() =>
                  void onDecide(
                    `merchant-interest/${encodeURIComponent(id)}/decision`,
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
              {row.brandName || '進件'}／{row.locationName || ''}
            </strong>
            <div className={styles.actions}>
              <Button
                disabled={busyId === id}
                onClick={() =>
                  void onDecide(
                    `merchant-applications/${encodeURIComponent(id)}/decision`,
                    id,
                    'approve',
                  )
                }
              >
                核准進件
              </Button>
              <Button
                disabled={busyId === id}
                onClick={() =>
                  void onDecide(
                    `merchant-applications/${encodeURIComponent(id)}/decision`,
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
    </section>
  );
}

function AffiliationTab({ context }: { context: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState('資料已核對，准予掛靠。');
  async function load() {
    const result = await adminFetch(
      'class-workspace-affiliation-applications',
      'GET',
      undefined,
      context,
    );
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
    setRows(asRecords(result.body.applications));
  }
  useEffect(() => {
    void load().catch((failure: Error) => setError(failure.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);
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
        const id = typeof row.id === 'string' ? row.id : '';
        return (
          <article key={id || `affiliation-${index}`} className={styles.item}>
            <strong>
              {typeof row.workspaceTitle === 'string'
                ? row.workspaceTitle
                : typeof row.workspaceId === 'string'
                  ? row.workspaceId
                  : '課班'}
            </strong>
            <p className={styles.muted}>
              {typeof row.tenantName === 'string'
                ? row.tenantName
                : typeof row.tenantId === 'string'
                  ? row.tenantId
                  : ''}
              {typeof row.sectionId === 'string' ? ` · ${row.sectionId}` : ''}
              {typeof row.state === 'string' ? ` · ${row.state}` : ''}
            </p>
            {typeof row.justification === 'string' ? <p>{row.justification}</p> : null}
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                setBusyId(id);
                setError('');
                void adminFetch(
                  `class-workspace-affiliation-applications/${encodeURIComponent(id)}/decision`,
                  'POST',
                  {
                    decision: 'approve',
                    reason: reason.trim(),
                    idempotencyKey: `web-affiliate-decide-${crypto.randomUUID()}`,
                  },
                  context,
                )
                  .then(async (result) => {
                    if (!result.ok) throw new Error('掛靠審核沒有完成，請稍後再試。');
                    await load();
                  })
                  .catch((failure: Error) => setError(failure.message))
                  .finally(() => setBusyId(null));
              }}
            >
              <Textarea
                label="核准原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
              <div className={styles.actions}>
                <Button type="submit" disabled={busyId === id || !id}>
                  核准掛靠
                </Button>
                <Button
                  type="button"
                  disabled={busyId === id || !id}
                  onClick={() => {
                    setBusyId(id);
                    setError('');
                    void adminFetch(
                      `class-workspace-affiliation-applications/${encodeURIComponent(id)}/decision`,
                      'POST',
                      {
                        decision: 'reject',
                        reason: '資料不足，請補件後再申請。',
                        idempotencyKey: `web-affiliate-decide-${crypto.randomUUID()}`,
                      },
                      context,
                    )
                      .then(async (result) => {
                        if (!result.ok) throw new Error('掛靠審核沒有完成，請稍後再試。');
                        await load();
                      })
                      .catch((failure: Error) => setError(failure.message))
                      .finally(() => setBusyId(null));
                  }}
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
