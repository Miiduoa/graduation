'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { NuniSignIn } from '@/components/NuniSignIn';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { NuniError } from '@campus/shared/src/nuni';
import {
  loadMerchantOverview,
  merchantApplicationStateLabel,
  merchantWorkspaceStateLabel,
  parseMerchantApplication,
  validateMerchantApplicationInput,
  type MerchantOverviewView,
  type NuniMerchantApplicationInput,
} from '@campus/shared/src/nuniMerchant';
import styles from './MerchantWorkspace.module.css';
import { MerchantOperations, type MerchantOperationDrafts } from './MerchantOperations';
import { clearAllFoodPendingForAccount } from '@/features/food/foodPersistence';
import type { FoodDraftCache } from '@/features/food/foodState';

type Overview = Awaited<ReturnType<typeof loadMerchantOverview>>;
type Draft = Omit<NuniMerchantApplicationInput, 'idempotencyKey'>;
const emptyDraft = (): Draft => ({
  tenantId: '',
  campusId: '',
  businessKind: 'company',
  legalName: '',
  brandName: '',
  businessRegistrationNumber: '',
  foodBusinessRegistrationNumber: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  locationName: '',
  operatingAddress: '',
  serviceModes: ['pickup'],
});
const requirementLabel: Record<string, string> = {
  settings: '確認營運設定與條款',
  menu: '建立菜單',
  'online-payment': '完成線上付款資格',
};
function expired(error: unknown) {
  return error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
}

const merchantEntry = {
  overview: {
    path: '/merchant',
    title: '店家合作',
    subtitle: '申請校園門市、查看審核進度或管理自己的門市。',
  },
  apply: {
    path: '/merchant/apply',
    title: '店家進駐申請',
    subtitle: '請由負責人使用自己的 Google 帳號提出申請，日後用同一個帳號管理門市。',
  },
  workspace: {
    path: '/merchant/workspace',
    title: '我的門市與申請',
    subtitle: '使用送出進駐申請的 Google 帳號，查看審核進度與已核准的門市。',
  },
} as const;

export function MerchantWorkspace({ view = 'overview' }: { view?: MerchantOverviewView }) {
  const entry = merchantEntry[view];
  const auth = useNuniSession();
  const [cleanupError, setCleanupError] = useState('');
  const [operationScope, setOperationScope] = useState<{
    accountId: string | null;
    locations: MerchantOperationDrafts;
    food: FoodDraftCache;
  }>(() => ({ accountId: null, locations: new Map(), food: new Map() }));
  const confirmedAccount = auth.pendingLogout
    ? null
    : (auth.session?.platformAccountId ??
      (!auth.loading && !auth.error ? null : operationScope.accountId));
  if (confirmedAccount !== operationScope.accountId) {
    // An unavailable session is not proof of logout. Keep uncertain write intent
    // hidden until this account returns, or discard it for a confirmed identity change.
    // Confirmed logout clears only food's durable pending keys for this account.
    if (operationScope.accountId && !confirmedAccount) {
      try {
        clearAllFoodPendingForAccount(operationScope.accountId);
      } catch {
        setCleanupError('未能清除這個分頁的訂餐重試紀錄，關閉分頁即可清除。');
      }
    }
    setOperationScope({ accountId: confirmedAccount, locations: new Map(), food: new Map() });
    return null;
  }
  return (
    <SiteShell title={entry.title} subtitle={entry.subtitle}>
      {cleanupError ? <p role="alert">{cleanupError}</p> : null}
      {auth.session && !auth.pendingLogout && !auth.error ? (
        <AccountWorkspace
          key={`${auth.session.platformAccountId}:${auth.session.context}`}
          view={view}
          context={auth.session.context}
          operationDrafts={operationScope.locations}
          foodDrafts={operationScope.food}
          suspended={auth.loading}
          onSwitchAccount={auth.logout}
          onExpired={auth.refresh}
        />
      ) : (
        <NuniSignIn returnUrl={entry.path} />
      )}
    </SiteShell>
  );
}

function AccountWorkspace({
  view,
  context,
  operationDrafts,
  foodDrafts,
  suspended,
  onExpired,
  onSwitchAccount,
}: {
  view: MerchantOverviewView;
  context: string;
  operationDrafts: MerchantOperationDrafts;
  foodDrafts: FoodDraftCache;
  suspended: boolean;
  onExpired: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [invalidSession, setInvalidSession] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [pending, setPending] = useState<NuniMerchantApplicationInput | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{
    tenantId: string;
    locationId: string;
  } | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const enabled = useRef(false);
  useLayoutEffect(() => {
    enabled.current = !suspended && !invalidSession;
    return () => {
      enabled.current = false;
    };
  }, [suspended, invalidSession]);
  const invalidate = useCallback(() => {
    ++generation.current;
  }, []);
  const expire = useCallback(() => {
    setInvalidSession(true);
    setOverview(null);
    setDraft(emptyDraft());
    setPending(null);
    void onExpired();
  }, [onExpired]);
  const load = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setLoadError('');
    try {
      const data = await loadMerchantOverview(
        (path, input) => browserRequest(path, context, input),
        view,
      );
      if (mounted.current && enabled.current && run === generation.current) setOverview(data);
    } catch (error) {
      if (mounted.current && enabled.current && run === generation.current) {
        if (expired(error)) expire();
        else setLoadError('目前無法確認店家資料，請重新載入。');
      }
    } finally {
      if (mounted.current && run === generation.current) setLoading(false);
    }
  }, [context, expire, view]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    if (!suspended && !invalidSession) void load();
    return invalidate;
  }, [load, suspended, invalidSession, invalidate]);

  const selected = overview?.programs.find((item) => item.tenantId === draft.tenantId);
  const update = (field: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled.current || busyRef.current || !overview || loading || loadError) return;
    setSubmitError('');
    setNotice('');
    let payload: NuniMerchantApplicationInput;
    try {
      payload =
        pending ??
        validateMerchantApplicationInput({
          ...draft,
          businessRegistrationNumber: draft.businessRegistrationNumber?.trim() || undefined,
          foodBusinessRegistrationNumber: draft.foodBusinessRegistrationNumber?.trim() || undefined,
          idempotencyKey: `merchant-apply-${crypto.randomUUID()}`,
        });
      if (
        !overview.programs.some(
          (program) =>
            program.tenantId === payload.tenantId &&
            program.campuses.some((campus) => campus.id === payload.campusId),
        )
      ) {
        setSubmitError('請選擇目前開放的場域與營運區域。');
        return;
      }
    } catch {
      setSubmitError('請確認必填資料、聯絡方式，並至少選擇一種服務方式。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setPending(payload);
    try {
      const application = parseMerchantApplication(
        await browserRequest('merchant-applications', context, payload),
      );
      if (!mounted.current || !enabled.current) return;
      setOverview((current) =>
        current
          ? {
              ...current,
              applications: [
                application,
                ...current.applications.filter(
                  (item) => item.applicationId !== application.applicationId,
                ),
              ],
            }
          : current,
      );
      setPending(null);
      setDraft(emptyDraft());
      setNotice('申請已收件。審核通過後仍需完成營運設定，才會開放店家服務。');
    } catch (error) {
      if (!mounted.current || !enabled.current) return;
      if (expired(error)) expire();
      else if (
        !pending &&
        error instanceof NuniError &&
        [400, 403, 404, 409, 422].includes(error.status)
      ) {
        setPending(null);
        setSubmitError(
          error.status === 409
            ? '申請資料已有紀錄或狀態已變更，請先重新載入查看申請。'
            : '申請未被接受，請確認資料與場域是否仍開放後再試。',
        );
      } else {
        setSubmitError('尚未確認是否收件。資料已保留，請重試同一份申請；重試不會另建一筆。');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (selectedLocation && !invalidSession)
    return (
      <MerchantOperations
        key={`${context}:${selectedLocation.tenantId}:${selectedLocation.locationId}`}
        context={context}
        drafts={operationDrafts}
        foodDrafts={foodDrafts}
        {...selectedLocation}
        suspended={suspended}
        onBack={() => setSelectedLocation(null)}
        onExpired={expire}
        onChanged={(detail) => {
          if (!mounted.current || !enabled.current) return;
          setOverview((current) =>
            current
              ? {
                  ...current,
                  workspaces: current.workspaces.map((workspace) =>
                    workspace.tenantId === detail.tenantId &&
                    workspace.locationId === detail.locationId
                      ? detail
                      : workspace,
                  ),
                }
              : current,
          );
        }}
      />
    );
  if (suspended) return <p role="status">正在重新確認帳號，店家資料暫時隱藏。</p>;
  if (invalidSession)
    return (
      <section className={styles.panel}>
        <p role="alert">登入或帳號已變更，這次店家資料與草稿已清除。</p>
        <Button onClick={() => setInvalidSession(false)}>重新載入店家資料</Button>
      </section>
    );
  if (view === 'apply' && notice) {
    return (
      <section className={styles.panel}>
        <h2>已收到進駐申請</h2>
        <p role="status">{notice}</p>
        <Link href="/merchant/workspace">查看收件進度</Link>
      </section>
    );
  }
  return (
    <div className={styles.stack}>
      {view !== 'workspace' && (
        <section className={styles.intro}>
          <h2>店家如何進駐</h2>
          <p>請準備店名、營業地點及聯絡方式。已經申請過的店家可以直接查看審核進度。</p>
          <ol>
            <li>送出營業與聯絡資料</li>
            <li>查看審核結果或補件說明</li>
            <li>核准後完成菜單及營運設定</li>
          </ol>
          <Link href="/merchant/workspace">查看申請進度與門市</Link>
        </section>
      )}
      <div className={styles.toolbar}>
        <h2>{view === 'apply' ? '填寫進駐資料' : '我的店家與申請'}</h2>
        <Button onClick={() => void load()} disabled={loading || busy}>
          重新載入
        </Button>
      </div>
      {loading && <p role="status">正在載入店家資料…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {overview && (
        <div className={styles.stack} hidden={loading || !!loadError}>
          {view !== 'apply' && (
            <section className={styles.panel} aria-labelledby="merchant-locations-title">
              <h3 id="merchant-locations-title">已授權門市</h3>
              {overview.workspaces.length === 0 ? (
                <>
                  <p>
                    這個帳號目前沒有已核准的門市。如果你是店員，請向門市負責人確認工作帳號與接單方式。
                  </p>
                  {view === 'workspace' && (
                    <Button onClick={() => void onSwitchAccount()}>登出並切換店家帳號</Button>
                  )}
                </>
              ) : (
                <ul className={styles.list}>
                  {overview.workspaces.map((item) => (
                    <li key={`${item.tenantId}:${item.locationId}`}>
                      <h4>
                        {item.merchantName}／{item.locationName}
                      </h4>
                      <p>
                        {item.tenantName} · {item.campusName}
                      </p>
                      <p>{merchantWorkspaceStateLabel(item)}</p>
                      <p>{item.publicAccess ? '允許公開瀏覽' : '尚未公開'}</p>
                      {item.missingRequirements.length > 0 && (
                        <p>
                          待完成：
                          {item.missingRequirements
                            .map(
                              (requirement) => requirementLabel[requirement] ?? '確認其他營運條件',
                            )
                            .join('、')}
                        </p>
                      )}
                      <Button
                        onClick={() =>
                          setSelectedLocation({
                            tenantId: item.tenantId,
                            locationId: item.locationId,
                          })
                        }
                      >
                        管理門市：{item.locationName}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {view !== 'apply' && (
            <section className={styles.panel} aria-labelledby="merchant-applications-title">
              <h3 id="merchant-applications-title">申請進度</h3>
              {overview.applications.length === 0 ? (
                <p>你還沒有送出進駐申請。</p>
              ) : (
                <ul className={styles.list}>
                  {overview.applications.map((item) => (
                    <li key={item.applicationId}>
                      <h4>
                        {item.brandName}／{item.locationName}
                      </h4>
                      <p>
                        {merchantApplicationStateLabel(item.state)} ·{' '}
                        {new Date(item.submittedAt).toLocaleDateString('zh-TW', {
                          timeZone: 'Asia/Taipei',
                        })}
                      </p>
                      {item.reviewerNote && <p>審核說明：{item.reviewerNote}</p>}
                      {item.state === 'needs-information' && (
                        <p>請依審核說明向受理單位提供資料，不必重複建立申請。</p>
                      )}
                      {item.state === 'approved' && (
                        <p>店家已核准。請查看已授權門市，確認尚待完成的營運條件。</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {view === 'workspace' ? (
            <Link href="/merchant/apply">申請新門市</Link>
          ) : (
            <section className={styles.panel} aria-labelledby="merchant-apply-title">
              <h3 id="merchant-apply-title">申請進駐</h3>
              {overview.programs.length === 0 ? (
                <p>目前沒有場域開放進駐申請。</p>
              ) : (
                <form
                  onSubmit={(event) => void submit(event)}
                  className={styles.form}
                  aria-busy={busy}
                >
                  <p>請填營業主體與聯絡資料；這裡不收身分證影本、存摺或銀行帳號。</p>
                  <fieldset disabled={busy || !!pending}>
                    <legend>申請地點</legend>
                    <Select
                      label="申請場域"
                      value={draft.tenantId}
                      required
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          tenantId: event.target.value,
                          campusId: '',
                        }))
                      }
                      placeholder="請選擇場域"
                      options={overview.programs.map((item) => ({
                        value: item.tenantId,
                        label: item.name,
                      }))}
                    />
                    {selected?.note && <p>{selected.note}</p>}
                    <Select
                      label="校區／營運區域"
                      value={draft.campusId}
                      required
                      onChange={(event) => update('campusId', event.target.value)}
                      disabled={!selected}
                      placeholder="請選擇營運區域"
                      options={
                        selected?.campuses.map((item) => ({ value: item.id, label: item.name })) ??
                        []
                      }
                    />
                  </fieldset>
                  <fieldset disabled={busy || !!pending}>
                    <legend>營業資料</legend>
                    <Select
                      label="營業型態"
                      value={draft.businessKind}
                      onChange={(event) => update('businessKind', event.target.value)}
                      options={[
                        { value: 'company', label: '公司' },
                        { value: 'sole-proprietor', label: '商號／行號' },
                        { value: 'campus-stall', label: '校園攤商或餐廳櫃位' },
                        { value: 'other', label: '其他合作單位' },
                      ]}
                    />
                    <div className={styles.fields}>
                      <Input
                        label="登記名稱／負責單位"
                        value={draft.legalName}
                        required
                        maxLength={200}
                        onChange={(event) => update('legalName', event.target.value)}
                      />
                      <Input
                        label="對外品牌名稱"
                        value={draft.brandName}
                        required
                        maxLength={200}
                        onChange={(event) => update('brandName', event.target.value)}
                      />
                      <Input
                        label="統一編號或商業登記號"
                        hint="無則留白"
                        value={draft.businessRegistrationNumber ?? ''}
                        minLength={3}
                        maxLength={40}
                        onChange={(event) =>
                          update('businessRegistrationNumber', event.target.value)
                        }
                      />
                      <Input
                        label="食品業者登錄字號"
                        hint="不適用時留白，由審核員確認"
                        value={draft.foodBusinessRegistrationNumber ?? ''}
                        minLength={3}
                        maxLength={60}
                        onChange={(event) =>
                          update('foodBusinessRegistrationNumber', event.target.value)
                        }
                      />
                      <Input
                        label="門市／櫃位名稱"
                        value={draft.locationName}
                        required
                        maxLength={200}
                        onChange={(event) => update('locationName', event.target.value)}
                      />
                      <Input
                        label="實際營業地址或校內位置"
                        value={draft.operatingAddress}
                        required
                        minLength={3}
                        maxLength={300}
                        onChange={(event) => update('operatingAddress', event.target.value)}
                      />
                    </div>
                  </fieldset>
                  <fieldset disabled={busy || !!pending}>
                    <legend>聯絡方式</legend>
                    <div className={styles.fields}>
                      <Input
                        label="聯絡人"
                        value={draft.contactName}
                        required
                        maxLength={120}
                        onChange={(event) => update('contactName', event.target.value)}
                        autoComplete="name"
                      />
                      <Input
                        label="聯絡信箱"
                        type="email"
                        value={draft.contactEmail}
                        required
                        maxLength={254}
                        onChange={(event) => update('contactEmail', event.target.value)}
                        autoComplete="email"
                      />
                      <Input
                        label="聯絡電話"
                        type="tel"
                        value={draft.contactPhone}
                        required
                        minLength={6}
                        maxLength={30}
                        onChange={(event) => update('contactPhone', event.target.value)}
                        autoComplete="tel"
                      />
                    </div>
                  </fieldset>
                  <fieldset disabled={busy || !!pending}>
                    <legend>預計服務方式（至少選一項）</legend>
                    <div className={styles.checks}>
                      {(['pickup', 'dine-in', 'delivery'] as const).map((mode) => (
                        <label key={mode}>
                          <input
                            type="checkbox"
                            checked={draft.serviceModes.includes(mode)}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                serviceModes: event.target.checked
                                  ? [...current.serviceModes, mode]
                                  : current.serviceModes.filter((item) => item !== mode),
                              }))
                            }
                          />
                          {{ pickup: '外帶自取', 'dine-in': '內用', delivery: '外送' }[mode]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {submitError && <p role="alert">{submitError}</p>}
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={loading || !!loadError}
                  >
                    {busy ? '正在確認收件…' : pending ? '重試同一份申請' : '送出進駐申請'}
                  </Button>
                </form>
              )}
              {notice && <p role="status">{notice}</p>}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
