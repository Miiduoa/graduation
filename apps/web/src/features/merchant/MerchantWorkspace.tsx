'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
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
  type NuniMerchantApplicationInput,
} from '@campus/shared/src/nuniMerchant';
import styles from './MerchantWorkspace.module.css';

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

export function MerchantWorkspace() {
  const auth = useNuniSession();
  return (
    <SiteShell title="店家合作" subtitle="使用同一個 Campus One 帳號，申請進駐並查看審核進度。">
      {auth.session && !auth.pendingLogout && !auth.error ? (
        <AccountWorkspace
          key={`${auth.session.platformAccountId}:${auth.session.context}`}
          context={auth.session.context}
          suspended={auth.loading}
          onExpired={auth.refresh}
        />
      ) : (
        <NuniSignIn returnUrl="/merchant" />
      )}
    </SiteShell>
  );
}

function AccountWorkspace({
  context,
  suspended,
  onExpired,
}: {
  context: string;
  suspended: boolean;
  onExpired: () => Promise<void>;
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
      const data = await loadMerchantOverview((path, input) =>
        browserRequest(path, context, input),
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
  }, [context, expire]);
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

  if (suspended) return <p role="status">正在重新確認帳號，店家資料暫時隱藏。</p>;
  if (invalidSession)
    return (
      <section className={styles.panel}>
        <p role="alert">登入或帳號已變更，這次店家資料與草稿已清除。</p>
        <Button onClick={() => setInvalidSession(false)}>重新載入店家資料</Button>
      </section>
    );
  return (
    <div className={styles.stack}>
      <section className={styles.intro}>
        <h2>先申請，再開店</h2>
        <p>
          一般帳號即可申請。場域管理者查核營業資料後，才會核發對應店家的權限；核准不等於已上線。
        </p>
        <ol>
          <li>送出營業與聯絡資料</li>
          <li>查看審核結果或補件說明</li>
          <li>核准後完成菜單及營運設定</li>
        </ol>
      </section>
      <div className={styles.toolbar}>
        <h2>我的店家與申請</h2>
        <Button onClick={() => void load()} disabled={loading || busy}>
          重新載入
        </Button>
      </div>
      {loading && <p role="status">正在載入店家資料…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {overview && (
        <div className={styles.stack} hidden={loading || !!loadError}>
          <section className={styles.panel} aria-labelledby="merchant-locations-title">
            <h3 id="merchant-locations-title">已授權門市</h3>
            {overview.workspaces.length === 0 ? (
              <p>目前沒有授權給這個帳號的門市。申請通過後會顯示在這裡。</p>
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
                          .map((requirement) => requirementLabel[requirement] ?? '確認其他營運條件')
                          .join('、')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
          <section className={styles.panel} aria-labelledby="merchant-apply-title">
            <h3 id="merchant-apply-title">申請進駐</h3>
            {overview.programs.length === 0 ? (
              <p>目前沒有場域開放進駐申請。既有申請仍可在上方查看進度。</p>
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
                      selected?.campuses.map((item) => ({ value: item.id, label: item.name })) ?? []
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
                      onChange={(event) => update('businessRegistrationNumber', event.target.value)}
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
        </div>
      )}
    </div>
  );
}
