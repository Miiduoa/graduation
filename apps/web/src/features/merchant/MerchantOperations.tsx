'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { NuniError } from '@campus/shared/src/nuni';
import { merchantWorkspaceStateLabel, type NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
import { isMerchantWorkspaceOperational } from '@campus/shared/src/merchantJourney';
import {
  createMerchantOperations,
  type NuniMerchantWorkspaceDetail,
  type NuniMerchantSettingsInput,
} from '@campus/shared/src/nuniMerchantOperations';
import { browserRequest } from '@/features/nuni/Session';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import styles from './MerchantWorkspace.module.css';
import { MerchantOrderDesk } from './MerchantOrderDesk';
import type { FoodDraftCache } from '@/features/food/foodState';
import {
  merchantWorkspaceHref,
  type MerchantWorkspaceSection,
  type MerchantWorkspaceQueue,
} from '@/lib/merchantWorkspaceNavigation';

import {
  createMerchantConfirmations,
  workspaceKey,
  type DetailConfirmation,
} from './merchantConfirmation';

type Detail = NuniMerchantWorkspaceDetail;
type SettingDraft = Omit<NuniMerchantSettingsInput, 'termsVersion' | 'expectedVersion'> & {
  agreed: boolean;
  baseVersion: number;
};
type MenuDraft = {
  name: string;
  description: string;
  price: string;
  stock: string;
  allergens: string;
};
type Action = 'settings' | 'menu' | 'activate' | 'availability';
type OperationDraft = {
  settings: SettingDraft | null;
  menu: MenuDraft[];
  menuReceipt: number | null;
  menuBlocked: boolean;
  uncertain: Action | null;
};
export type MerchantOperationDrafts = Map<string, OperationDraft>;
const newItem = (): MenuDraft => ({
  name: '',
  description: '',
  price: '',
  stock: '',
  allergens: '',
});
const modes = [
  ['pickup', '自取'],
  ['dine-in', '內用'],
  ['delivery', '外送'],
] as const;
const requirements: Record<string, string> = {
  settings: '確認營運設定與條款',
  menu: '建立有庫存的首次菜單',
  'online-payment': '確認線上付款資格或改用櫃檯付款',
};
const settingsOf = (detail: Detail): SettingDraft => ({
  serviceModes: detail.serviceModes,
  paymentMode: detail.paymentMode,
  agreed: detail.managerConfirmed && detail.termsVersion === 'merchant-terms-v1',
  baseVersion: detail.readinessVersion,
});
const isUnknown = (failure: unknown) =>
  !(failure instanceof NuniError) ||
  failure.status === 0 ||
  failure.status === 408 ||
  failure.status >= 500;

const detailReadError = '無法確認門市目前的資料。草稿已保留，請重新讀取。';

export function MerchantOperations({
  context,
  tenantId,
  locationId,
  suspended,
  visible = true,
  drafts,
  foodDrafts,
  navigation,
  onBack,
  onExpired,
  confirmedDetail,
  confirmedListRow,
  receiptFloorFor,
  accessRevocation = 0,
  beginRequest,
  onChanged,
  onDenied,
  onMenuConfirmed,
}: {
  context: string;
  tenantId: string;
  locationId: string;
  suspended: boolean;
  visible?: boolean;
  drafts: MerchantOperationDrafts;
  foodDrafts?: FoodDraftCache;
  navigation?: {
    section: MerchantWorkspaceSection;
    queue: MerchantWorkspaceQueue;
    backHref: string;
    onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  };
  onBack?(): void;
  onExpired(): void;
  confirmedDetail?: Detail | null;
  confirmedListRow?: NuniMerchantWorkspace;
  receiptFloorFor?(readinessVersion?: number): number;
  accessRevocation?: number;
  beginRequest?(): number;
  onChanged(detail: Detail, verifiedAccess: boolean, revision: number): DetailConfirmation | null | void;
  onMenuConfirmed?(detail: Detail, revision: number, createdItems: number): boolean;
  onDenied?(tenantId: string, locationId: string, revision: number): number | undefined;
}) {
  const draftKey = workspaceKey({ tenantId, locationId });
  const saved = drafts.get(draftKey);
  const operations = useMemo(
    () =>
      createMerchantOperations((path, input, method) =>
        browserRequest(path, context, input, method),
      ),
    [context],
  );
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const [entryVerified, setEntryVerified] = useState(false);
  const detail = entryVerified ? (confirmedDetail === undefined ? loadedDetail : confirmedDetail) : null;
  const [loading, setLoading] = useState(true);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{
    value: string | number;
    revision: number;
    readinessVersion?: number;
    statusChange?: true;
  } | null>(null);
  const [uncertain, setUncertain] = useState<Action | null>(saved?.uncertain ?? null);
  const [settings, setSettings] = useState<SettingDraft | null>(saved?.settings ?? null);
  const [menu, setMenu] = useState<MenuDraft[]>(saved?.menu ?? [newItem()]);
  const [menuConfirmed, setMenuConfirmed] = useState(false);
  const menuReceipt = saved?.menuReceipt ?? null;
  const [localConfirmations] = useState(() => createMerchantConfirmations(drafts));
  const nextRevision = beginRequest ?? localConfirmations.beginRequest;
  const statusReceiptVersion = notice?.statusChange ? notice.readinessVersion : undefined;
  const noticeFloor = receiptFloorFor
    ? receiptFloorFor(statusReceiptVersion)
    : localConfirmations.workspaceReceiptFloor(draftKey, statusReceiptVersion);
  const visibleNotice =
    detail &&
    notice &&
    notice.revision > noticeFloor &&
    (notice.readinessVersion === undefined || notice.readinessVersion === detail.readinessVersion)
      ? notice.value
      : null;
  const [menuBlocked, setMenuBlocked] = useState(saved?.menuBlocked ?? false);
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const ordersOpen = navigation ? navigation.section === 'orders' : showOrders;
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const hasDetail = !!detail;
  useEffect(() => {
    if (hasDetail && document.activeElement === document.body) workspaceHeading.current?.focus();
  }, [hasDetail, navigation?.section]);
  const [localFoodDrafts] = useState<FoodDraftCache>(() => new Map());
  const active = useRef(false);
  const lock = useRef(false);
  const run = useRef(0);
  const accessRevision = useRef(0);
  const failedReadRevision = useRef(0);
  const entryAccessRevision = useRef(0);
  const pendingAccessRead = useRef(0);
  const observedRevocation = useRef(accessRevocation);
  useLayoutEffect(() => {
    observedRevocation.current = accessRevocation;
  }, [accessRevocation]);
  const sessionRun = useRef(0);
  const opened = useRef(false);
  const visibleRef = useRef(visible);
  const readAfterWrite = useRef(false);
  const mutationRun = useRef(0);
  const changed = useRef(onChanged);
  const expire = useRef(onExpired);
  useLayoutEffect(() => {
    changed.current = onChanged;
    expire.current = onExpired;
  }, [onChanged, onExpired]);
  const invalidate = useCallback(() => {
    ++sessionRun.current;
    ++run.current;
    ++mutationRun.current;
    pendingAccessRead.current = 0;
    entryAccessRevision.current = 0;
    failedReadRevision.current = 0;
  }, []);
  useLayoutEffect(() => {
    drafts.set(draftKey, {
      settings,
      menu,
      menuReceipt: drafts.get(draftKey)?.menuReceipt ?? null,
      menuBlocked,
      uncertain: busy ?? uncertain,
    });
  }, [drafts, draftKey, settings, menu, menuBlocked, busy, uncertain]);
  useLayoutEffect(() => {
    active.current = !suspended;
    return () => {
      active.current = false;
      invalidate();
    };
  }, [context, suspended, invalidate]);

  const confirmDetail = useCallback(
    (next: Detail, verifiedAccess: boolean, revision: number) =>
      changed.current(next, verifiedAccess, revision) ??
      (beginRequest ? null : localConfirmations.confirmDetail(next, revision, verifiedAccess)),
    [beginRequest, localConfirmations],
  );

  const showDetail = useCallback(
    (merged: Detail) => {
      if (!beginRequest) setDetail(merged);
      setMenuConfirmed(false);
      setActivationConfirmed(false);
    },
    [beginRequest],
  );

  const accept = (next: Detail, revision: number) => {
    const confirmation = confirmDetail(next, false, revision);
    // Receipts update the detail and notices. Only a GET can establish entry freshness.
    if (!confirmation?.won) return null;
    showDetail(confirmation.detail);
    return confirmation.detail;
  };

  const revokeDetail = useCallback(
    (revision: number, updateView: boolean) => {
      const revoked = beginRequest
        ? onDenied?.(tenantId, locationId, revision)
        : localConfirmations.revoke(draftKey, revision);
      if (revoked === undefined) return;
      if (!beginRequest) {
        setDetail(null);
        setNotice((current) => current && current.revision > revoked ? current : null);
      }
      if (updateView) {
        accessRevision.current = Math.max(accessRevision.current, revoked);
        entryAccessRevision.current = 0;
        setFresh(false);
        setError('目前無法取得這間門市的管理權限。請重新讀取，或返回我的門市。');
      }
    },
    [beginRequest, draftKey, localConfirmations, locationId, onDenied, tenantId],
  );

  const expireSession = useCallback(
    (failure: unknown) => {
      if (
        !(failure instanceof NuniError) ||
        (failure.status !== 401 && failure.code !== 'SESSION_CHANGED')
      )
        return false;
      // Session invalidation applies even after navigation retires the request's view.
      entryAccessRevision.current = 0;
      localConfirmations.clear();
      setNotice(null);
      setDetail(null);
      setFresh(false);
      expire.current();
      return true;
    },
    [localConfirmations],
  );

  const confirmEntry = useCallback(
    (detail: Detail, revision: number, reveal: boolean) => {
      if (
        revision < accessRevision.current ||
        revision <= failedReadRevision.current ||
        revision <= observedRevocation.current
      ) return;
      accessRevision.current = revision;
      entryAccessRevision.current = revision;
      showDetail(detail);
      if (reveal) {
        setFresh(true);
        setEntryVerified(true);
        setReadUnavailable(false);
        setError((current) => current === detailReadError ? '' : current);
      }
    },
    [showDetail],
  );

  const checkAccess = useCallback(
    async (current: () => boolean, verifiesEntry = false) => {
      const session = sessionRun.current;
      const revision = nextRevision();
      if (verifiesEntry) {
        accessRevision.current = Math.max(accessRevision.current, observedRevocation.current);
      }
      try {
        const next = await operations.get(tenantId, locationId);
        if (!active.current || session !== sessionRun.current) return;
        const merged = confirmDetail(next, true, revision)?.detail ?? null;
        if (merged && verifiesEntry && current()) {
          // Keep the confirmed revision for a stale refresh fallback, while
          // the write or its pending refresh still controls entry access.
          confirmEntry(merged, revision, !readAfterWrite.current && !pendingAccessRead.current);
        }
      } catch (failure) {
        if (!active.current || session !== sessionRun.current || !(failure instanceof NuniError)) return;
        if (expireSession(failure)) return;
        if ([403, 404].includes(failure.status)) {
          revokeDetail(revision, current() && revision >= accessRevision.current);
        }
      }
    },
    [confirmDetail, confirmEntry, expireSession, nextRevision, locationId, operations, revokeDetail, tenantId],
  );

  const read = useCallback(
    async (reconcile = true, afterWrite = false) => {
      readAfterWrite.current = false;
      const session = sessionRun.current;
      const version = ++run.current;
      const current = () => active.current && version === run.current;
      const revision = nextRevision();
      // A pending read may reconcile an intervening denial. Only an accepted
      // response can advance access past the revocation already being handled.
      pendingAccessRead.current = revision;
      accessRevision.current = Math.max(accessRevision.current, observedRevocation.current);
      setReadUnavailable(false);
      setLoading(true);
      setFresh(false);
      try {
        const next = await operations.get(tenantId, locationId);
        if (!active.current || session !== sessionRun.current) return;
        const merged = confirmDetail(next, true, revision)?.detail ?? null;
        if (!current()) return;
        if (!merged) {
          // A rejected refresh cannot replace a successful GET for this entry.
          if (afterWrite && entryAccessRevision.current > observedRevocation.current) {
            setEntryVerified(true);
            setFresh(true);
            return;
          }
          setReadUnavailable(true);
          setError(detailReadError);
          return;
        }
        confirmEntry(merged, revision, !readAfterWrite.current);
        // A count of zero cannot prove a non-idempotent menu request failed:
        // an existing menu may have no remaining sellable stock.
        if (reconcile) {
          setUncertain((current) =>
            current === 'menu' && merged.publishedMenuItems === 0 ? current : null,
          );
        }
        if (reconcile || !drafts.get(draftKey)?.uncertain) setError('');
      } catch (failure) {
        // Navigation retires view updates while the request still belongs to this session.
        if (!active.current || session !== sessionRun.current) return;
        if (expireSession(failure)) return;
        if (failure instanceof NuniError && [403, 404].includes(failure.status)) {
          revokeDetail(revision, current());
        } else if (current()) {
          // Earlier reads may still update shared detail, but cannot verify
          // entry access after this read failed.
          failedReadRevision.current = revision;
          entryAccessRevision.current = 0;
          if (afterWrite) setEntryVerified(false);
          setFresh(false);
          setReadUnavailable(true);
          setError(detailReadError);
        }
      } finally {
        if (pendingAccessRead.current === revision) pendingAccessRead.current = 0;
        if (current()) setLoading(false);
      }
    },
    [
      operations, tenantId, locationId, confirmDetail, confirmEntry, drafts, draftKey,
      expireSession, revokeDetail, nextRevision,
    ],
  );
  useLayoutEffect(() => {
    if (!suspended) {
      setUncertain(drafts.get(draftKey)?.uncertain ?? null);
      setBusy(null);
      lock.current = false;
      opened.current = false;
    }
  }, [suspended, drafts, draftKey]);
  const verifyEntry = useCallback(() => {
    entryAccessRevision.current = 0;
    setEntryVerified(false);
    setReadUnavailable(false);
    let checkingAccess = true;
    if (lock.current) {
      // Verify access now, and refresh controls again after the write settles.
      readAfterWrite.current = true;
      void checkAccess(() => checkingAccess && active.current, true);
    } else {
      // Returning through history does not acknowledge an unknown write.
      void read(!opened.current);
      opened.current = true;
    }
    return () => {
      checkingAccess = false;
    };
  }, [checkAccess, read]);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    if (!visible || suspended) {
      setEntryVerified(false);
      setReadUnavailable(false);
      return;
    }
    const retire = verifyEntry();
    return () => {
      retire();
      readAfterWrite.current = false;
      if (!lock.current) ++run.current;
    };
  }, [suspended, visible, verifyEntry]);

  // A retired read or the list can revoke data after the visible entry started verifying.
  // The entry's own denial already displays an error and allows a manual retry.
  useLayoutEffect(() => {
    if (
      visible && !suspended &&
      accessRevocation > Math.max(accessRevision.current, pendingAccessRead.current)
    ) {
      return verifyEntry();
    }
  }, [accessRevocation, loading, readUnavailable, suspended, visible, verifyEntry]);

  async function mutate(
    action: Action,
    task: (current: () => boolean, revision: number) => Promise<void>,
  ) {
    if (!active.current || lock.current || loading || uncertain || !fresh || !detail) return;
    lock.current = true;
    const session = sessionRun.current;
    const mutation = ++mutationRun.current;
    const version = ++run.current;
    const current = () => active.current && version === run.current;
    // Record the intent before issuing the request. Returning to the list or
    // renewing this account's session must not turn an unknown write into a retry.
    drafts.set(draftKey, {
      settings,
      menu,
      menuReceipt: drafts.get(draftKey)?.menuReceipt ?? null,
      menuBlocked: action === 'menu' || menuBlocked,
      uncertain: action,
    });
    if (action === 'menu') setMenuBlocked(true);
    setBusy(action);
    setError('');
    setNotice(null);
    const revision = nextRevision();
    try {
      await task(current, revision);
      if (current() && !visibleRef.current) await checkAccess(current);
    } catch (failure) {
      if (!active.current || session !== sessionRun.current) return;
      if (expireSession(failure) || !current()) return;
      if (failure instanceof NuniError && [403, 404].includes(failure.status)) {
        revokeDetail(revision, true);
      } else if (failure instanceof NuniError && failure.status === 409) {
        if (action === 'menu') setMenuBlocked(true);
        await read();
        if (active.current)
          setError('門市資料已變更。請確認重新讀取的狀態，再決定下一步；草稿仍保留。');
      } else if (isUnknown(failure)) {
        setUncertain(action);
        if (action === 'menu') setMenuBlocked(true);
        setError('尚未確認這次操作的結果。請先重新讀取門市狀態，不要重複送出。');
        await checkAccess(current);
      } else {
        if (action === 'menu') setMenuBlocked(false);
        setError('這次操作未被接受。請確認資料與門市的營運條件後再試。');
      }
    } finally {
      if (mutation === mutationRun.current) {
        lock.current = false;
        if (active.current) {
          setBusy(null);
          if (readAfterWrite.current) void read(false, true);
        }
      }
    }
  }

  if (!visible) return null;
  if (suspended) return <p role="status">正在重新確認帳號，門市資料暫時隱藏。</p>;
  const summary = detail ?? (!loading && (entryVerified || readUnavailable) ? confirmedListRow : null);
  const missingRequirements = summary?.missingRequirements
    .map((item) => requirements[item] ?? '請向場域管理者確認')
    .join('、');
  const draft = settings ?? (detail ? settingsOf(detail) : null);
  const settingsChanged =
    !!settings && !!detail && settings.baseVersion !== detail.readinessVersion;
  const locked = !!busy || loading || !!uncertain || !fresh;
  const menuExists = menuReceipt !== null || (!!detail && !detail.missingRequirements.includes('menu'));
  const operational = !!detail && isMerchantWorkspaceOperational(detail);
  const canActivate =
    detail &&
    !detail.activated &&
    detail.managerConfirmed &&
    detail.publishedMenuItems > 0 &&
    detail.missingRequirements.length === 0 &&
    detail.merchantStatus === 'suspended' &&
    detail.locationStatus === 'suspended' &&
    !detail.publicAccess;
  const canDowngrade =
    detail?.activated &&
    !detail.onlinePaymentAvailable &&
    detail.paymentMode === 'online-and-counter' &&
    detail.termsVersion === 'merchant-terms-v1';
  const sectionHref = (section: MerchantWorkspaceSection) =>
    merchantWorkspaceHref({
      tenantId,
      locationId,
      section,
      queue: navigation?.queue,
    });

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        {navigation ? (
          <Link
            className="btn"
            href={navigation.backHref}
            aria-disabled={!!busy || undefined}
            onClick={(event) => {
              if (busy) event.preventDefault();
              else navigation.onNavigate(event);
            }}
          >
            返回我的門市
          </Link>
        ) : (
          <Button onClick={onBack} disabled={!!busy}>
            返回我的門市
          </Button>
        )}
        <Button disabled={!!busy || loading} onClick={() => void read()}>
          重新讀取門市狀態
        </Button>
      </div>
      {(loading || (!entryVerified && busy)) && <p role="status">正在確認門市資料…</p>}
      {error && <p role="alert">{error}</p>}
      {!detail && summary && (
        <div role="status">
          <p>{merchantWorkspaceStateLabel(summary)}</p>
          {missingRequirements && <p>待完成：{missingRequirements}</p>}
        </div>
      )}
      {typeof visibleNotice === 'number'
        ? menuReceipt !== null && (
            <p role="status">已建立 {visibleNotice} 項首次菜單。啟用前請再確認門市資料。</p>
          )
        : visibleNotice && <p role="status">{visibleNotice}</p>}
      {detail && draft && (
        <>
          <section className={styles.intro} aria-label="門市現況">
            <h2 ref={workspaceHeading} tabIndex={-1}>
              {detail.merchantName}／{detail.locationName}
            </h2>
            <p>
              {detail.tenantName} · {detail.campusName}
            </p>
            <p>{merchantWorkspaceStateLabel(detail)}</p>
            {missingRequirements && <p>待完成：{missingRequirements}</p>}
          </section>

          {navigation && (
            <nav className={styles.workspaceNav} aria-label="門市工作">
              <Link
                href={sectionHref('overview')}
                aria-current={!ordersOpen ? 'page' : undefined}
                onClick={navigation.onNavigate}
              >
                門市概況
              </Link>
              {locked ? (
                <span aria-disabled="true" aria-current={ordersOpen ? 'page' : undefined}>
                  訂單與收銀
                </span>
              ) : (
                <Link
                  href={sectionHref('orders')}
                  aria-current={ordersOpen ? 'page' : undefined}
                  onClick={navigation.onNavigate}
                >
                  訂單與收銀
                </Link>
              )}
            </nav>
          )}

          {operational && (!navigation || !ordersOpen) && (
            <section className={styles.panel} aria-labelledby="merchant-daily-work-title">
              <h3 id="merchant-daily-work-title">門市工作台</h3>
              <p>開班、確認收款、準備餐點與核對取餐憑證。暫停新訂單時，仍可處理已收到的訂單。</p>
              {navigation && !locked ? (
                <Link
                  className="btn primary"
                  href={sectionHref('orders')}
                  onClick={navigation.onNavigate}
                >
                  處理訂單與收銀
                </Link>
              ) : (
                <Button
                  variant="primary"
                  disabled={locked}
                  aria-expanded={showOrders}
                  aria-controls="merchant-order-workspace"
                  onClick={() => setShowOrders((value) => !value)}
                >
                  {showOrders ? '收起訂單工作台' : '處理訂單與收銀'}
                </Button>
              )}
              <div id="merchant-order-workspace">
                {!navigation && showOrders && !locked && (
                  <MerchantOrderDesk
                    key={`${context}:${tenantId}:${locationId}`}
                    context={context}
                    tenantId={tenantId}
                    locationId={locationId}
                    cache={foodDrafts ?? localFoodDrafts}
                  />
                )}
              </div>
            </section>
          )}

          {navigation &&
            ordersOpen &&
            (operational ? (
              locked ? (
                <p role="status">
                  {loading || busy
                    ? '正在重新確認門市，確認後會接回訂單工作台。'
                    : '請重新讀取門市狀態，再開啟訂單工作台。'}
                </p>
              ) : (
                <MerchantOrderDesk
                  key={`${context}:${tenantId}:${locationId}`}
                  context={context}
                  tenantId={tenantId}
                  locationId={locationId}
                  cache={foodDrafts ?? localFoodDrafts}
                  queue={navigation.queue}
                  queueHref={(queue) =>
                    merchantWorkspaceHref({ tenantId, locationId, section: 'orders', queue })
                  }
                  onQueueChange={(event) => navigation.onNavigate(event)}
                />
              )
            ) : (
              <section className={styles.panel} aria-labelledby="merchant-orders-unavailable-title">
                <h3 id="merchant-orders-unavailable-title">這間門市尚未開放訂單工作台</h3>
                <p>
                  {detail.activated
                    ? '目前的門市狀態需要由場域管理者確認，請聯絡管理者恢復營運權限。'
                    : '請先確認門市狀態與營運條件。完成設定並啟用後，就能在這裡接單與收銀。'}
                </p>
                <Link
                  className="btn primary"
                  href={sectionHref('overview')}
                  onClick={navigation.onNavigate}
                >
                  查看門市概況
                </Link>
              </section>
            ))}

          {!ordersOpen && !detail.activated && (
            <section className={styles.panel} aria-labelledby="merchant-settings-title">
              <h3 id="merchant-settings-title">1. 確認營運方式</h3>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.agreed || !draft.serviceModes.length || settingsChanged) return;
                  void mutate('settings', async (current, revision) => {
                    const next = await operations.updateSettings(tenantId, locationId, {
                      serviceModes: draft.serviceModes,
                      paymentMode: draft.paymentMode,
                      termsVersion: 'merchant-terms-v1',
                      expectedVersion: draft.baseVersion,
                    });
                    if (!current() || !accept(next, revision)) return;
                    setSettings(null);
                    setNotice({
                      value: '營運設定已儲存。',
                      revision,
                      readinessVersion: next.readinessVersion,
                    });
                  });
                }}
              >
                {settingsChanged && (
                  <div role="alert">
                    <p>營運設定已有新版。你的草稿尚未儲存，請先選擇使用哪一份。</p>
                    <div className={styles.checks}>
                      <Button type="button" disabled={locked} onClick={() => setSettings(null)}>
                        改用目前設定
                      </Button>
                      <Button
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          setSettings({ ...draft, baseVersion: detail.readinessVersion })
                        }
                      >
                        保留草稿，儲存時取代
                      </Button>
                    </div>
                  </div>
                )}
                <fieldset disabled={locked}>
                  <legend>提供哪些服務</legend>
                  <div className={styles.checks}>
                    {modes.map(([mode, label]) => (
                      <label key={mode}>
                        <input
                          type="checkbox"
                          checked={draft.serviceModes.includes(mode)}
                          onChange={(event) =>
                            setSettings({
                              ...draft,
                              serviceModes: event.target.checked
                                ? [...draft.serviceModes, mode]
                                : draft.serviceModes.filter((value) => value !== mode),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Select
                    label="付款方式"
                    value={draft.paymentMode}
                    options={[
                      { value: 'counter-only', label: '現場櫃檯付款' },
                      {
                        value: 'online-and-counter',
                        label: '線上及櫃檯付款',
                        disabled: !detail.onlinePaymentAvailable,
                      },
                    ]}
                    onChange={(event) =>
                      setSettings({
                        ...draft,
                        paymentMode: event.target.value as SettingDraft['paymentMode'],
                      })
                    }
                  />
                  {!detail.onlinePaymentAvailable && (
                    <p>目前開放現場櫃檯付款，線上付款尚未開放。</p>
                  )}
                  <label className={styles.confirmation}>
                    <input
                      type="checkbox"
                      checked={draft.agreed}
                      onChange={(event) => setSettings({ ...draft, agreed: event.target.checked })}
                    />
                    我確認營運資訊正確，並同意現行店家營運條款
                  </label>
                </fieldset>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    locked || settingsChanged || !draft.agreed || !draft.serviceModes.length
                  }
                >
                  儲存營運設定
                </Button>
              </form>
            </section>
          )}

          {!ordersOpen && canDowngrade && (
            <section className={styles.panel}>
              <h3>改用現場付款</h3>
              <p>
                這間門市先前啟用了線上付款，目前尚未提供該服務。可保留原服務方式，改為現場櫃檯付款。
              </p>
              <Button
                disabled={locked}
                onClick={() =>
                  void mutate('settings', async (current, revision) => {
                    const next = await operations.updateSettings(tenantId, locationId, {
                      serviceModes: detail.serviceModes,
                      paymentMode: 'counter-only',
                      termsVersion: 'merchant-terms-v1',
                      expectedVersion: detail.readinessVersion,
                    });
                    if (!current() || !accept(next, revision)) return;
                    setNotice({
                      value: '已改為現場櫃檯付款。',
                      revision,
                      readinessVersion: next.readinessVersion,
                    });
                  })
                }
              >
                確認改為櫃檯付款
              </Button>
            </section>
          )}

          {!ordersOpen && !detail.activated && (
            <section className={styles.panel} aria-labelledby="merchant-menu-title">
              <h3 id="merchant-menu-title">2. 建立首次菜單</h3>
              {menuExists ? (
                <p>目前有 {detail.publishedMenuItems} 項有庫存的上架品項。首次菜單只能建立一次。</p>
              ) : (
                <>
                  <p>
                    填入品項、整數元售價、庫存與過敏原。送出後會建立並上架，無法在這裡修改既有菜單。
                  </p>
                  {menuBlocked && (
                    <p role="status">
                      這次菜單不能再次送出。若重新讀取後仍無法確認，請向場域管理者確認既有菜單；零個可販售品項不代表尚未建立。
                    </p>
                  )}
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!menuConfirmed || menuBlocked) return;
                      void mutate('menu', async (current, revision) => {
                        const receipt = await operations.createInitialMenu(tenantId, locationId, {
                          items: menu.map((item) => ({
                            name: item.name.trim(),
                            description: item.description.trim(),
                            priceMinor: Number(item.price),
                            initialStock: Number(item.stock),
                            allergens: item.allergens
                              .split(/[、,，]/)
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })),
                        });
                        if (!current()) return;
                        const accepted = onMenuConfirmed
                          ? onMenuConfirmed(detail, revision, receipt.createdItems)
                          : localConfirmations.confirmMenu(draftKey, revision, receipt.createdItems);
                        setMenuConfirmed(false);
                        if (accepted) setNotice({ value: receipt.createdItems, revision });
                        await read();
                      });
                    }}
                  >
                    <fieldset disabled={locked || menuBlocked}>
                      {menu.map((item, index) => {
                        const change = (field: keyof MenuDraft, value: string) => {
                          setMenu((items) =>
                            items.map((current, i) =>
                              i === index ? { ...current, [field]: value } : current,
                            ),
                          );
                          setMenuConfirmed(false);
                        };
                        return (
                          <div className={styles.menuItem} key={index}>
                            <h4>品項 {index + 1}</h4>
                            <div className={styles.fields}>
                              <Input
                                label={`品項 ${index + 1} 名稱`}
                                required
                                maxLength={200}
                                value={item.name}
                                onChange={(e) => change('name', e.target.value)}
                              />
                              <Input
                                label={`品項 ${index + 1} 售價（元）`}
                                required
                                type="number"
                                min={1}
                                max={10000000}
                                step={1}
                                value={item.price}
                                onChange={(e) => change('price', e.target.value)}
                              />
                              <Input
                                label={`品項 ${index + 1} 初始庫存`}
                                required
                                type="number"
                                min={1}
                                max={100000}
                                step={1}
                                value={item.stock}
                                onChange={(e) => change('stock', e.target.value)}
                              />
                              <Input
                                label={`品項 ${index + 1} 過敏原`}
                                hint="多項請以逗號分隔；沒有可留空"
                                value={item.allergens}
                                onChange={(e) => change('allergens', e.target.value)}
                              />
                            </div>
                            <Textarea
                              label={`品項 ${index + 1} 說明`}
                              maxLength={1000}
                              value={item.description}
                              onChange={(e) => change('description', e.target.value)}
                            />
                            {menu.length > 1 && (
                              <Button
                                type="button"
                                onClick={() => {
                                  setMenu((items) => items.filter((_, i) => i !== index));
                                  setMenuConfirmed(false);
                                }}
                              >
                                移除品項 {index + 1}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        disabled={menu.length >= 100}
                        onClick={() => {
                          setMenu((items) => [...items, newItem()]);
                          setMenuConfirmed(false);
                        }}
                      >
                        新增一個品項
                      </Button>
                      <label className={styles.confirmation}>
                        <input
                          type="checkbox"
                          checked={menuConfirmed}
                          onChange={(event) => setMenuConfirmed(event.target.checked)}
                        />
                        我已確認品項、元售價、庫存與過敏原，知道首次菜單只能建立一次
                      </label>
                    </fieldset>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={locked || menuBlocked || !menuConfirmed}
                    >
                      確認建立並上架菜單
                    </Button>
                  </form>
                </>
              )}
            </section>
          )}

          {!ordersOpen && (
            <section className={styles.panel} aria-labelledby="merchant-activate-title">
              <h3 id="merchant-activate-title">
                {detail.activated ? '接單狀態' : '3. 確認後啟用門市'}
              </h3>
              <dl className={styles.summary}>
                <div>
                  <dt>服務方式</dt>
                  <dd>
                    {detail.serviceModes
                      .map((mode) => modes.find(([value]) => value === mode)?.[1] ?? mode)
                      .join('、')}
                  </dd>
                </div>
                <div>
                  <dt>付款方式</dt>
                  <dd>
                    {detail.paymentMode === 'counter-only' ? '現場櫃檯付款' : '線上及櫃檯付款'}
                  </dd>
                </div>
                <div>
                  <dt>有庫存的上架品項</dt>
                  <dd>{detail.publishedMenuItems} 項</dd>
                </div>
              </dl>
              {!detail.activated ? (
                <>
                  <p>啟用後，門市會公開並開始接單。以上是目前已儲存的資料。</p>
                  {settings && <p>營運設定還有未儲存的草稿，請先儲存或改用目前設定。</p>}
                  <label className={styles.confirmation}>
                    <input
                      type="checkbox"
                      disabled={locked || !canActivate || !!settings}
                      checked={activationConfirmed}
                      onChange={(event) => setActivationConfirmed(event.target.checked)}
                    />
                    我已確認門市、營運方式及菜單，現在開放接單
                  </label>
                  <Button
                    disabled={locked || !canActivate || !!settings || !activationConfirmed}
                    variant="primary"
                    onClick={() =>
                      void mutate('activate', async (current, revision) => {
                        const next = await operations.activate(tenantId, locationId);
                        if (!current()) return;
                        const confirmed = accept(next, revision);
                        if (confirmed)
                          setNotice({
                            value: `門市狀態已更新：${merchantWorkspaceStateLabel(confirmed)}。`,
                            revision,
                            readinessVersion: confirmed.readinessVersion,
                            statusChange: true,
                          });
                      })
                    }
                  >
                    確認啟用門市
                  </Button>
                </>
              ) : operational ? (
                <>
                  <p>
                    {detail.locationStatus === 'open'
                      ? '目前開放接單。暫停後，已收到的訂單仍需處理。'
                      : '目前暫停接單。恢復前會重新確認菜單與付款設定。'}
                  </p>
                  <Button
                    disabled={locked}
                    onClick={() =>
                      void mutate('availability', async (current, revision) => {
                        const next = await operations.setAvailability(
                          tenantId,
                          locationId,
                          detail.locationStatus === 'closed',
                        );
                        if (!current()) return;
                        const confirmed = accept(next, revision);
                        if (confirmed)
                          setNotice({
                            value: `門市狀態已更新：${merchantWorkspaceStateLabel(confirmed)}。`,
                            revision,
                            readinessVersion: confirmed.readinessVersion,
                            statusChange: true,
                          });
                      })
                    }
                  >
                    {detail.locationStatus === 'open' ? '暫停接單' : '恢復接單'}
                  </Button>
                </>
              ) : (
                <p>門市的營運狀態需要由場域管理者確認，這裡無法自行恢復接單。</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
