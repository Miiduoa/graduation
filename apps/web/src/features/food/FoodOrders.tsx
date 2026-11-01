'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import type {
  NuniFoodCustomerCancelReason,
  NuniFoodPaymentSessionProjection,
  NuniFoodOrderState,
} from '@campus/shared/src/nuniFood';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import type { FoodClient } from './FoodWorkspace';
import {
  FOOD_POLL_MS,
  FOOD_TERMINAL_STATES,
  FoodMutationStatus,
  foodKey,
  foodMoney,
  foodStateLabels,
  foodTime,
  useFoodDraft,
  useFoodClock,
  useFoodMutation,
  useFoodRead,
  type FoodDraftCache,
} from './foodState';
import { foodCustomerNextStep, isFoodOrderInProgress } from './foodOrderGuidance';
import { FoodOrderReceipt } from './FoodOrderReceipt';
import styles from './Food.module.css';

export function FoodOrders({
  client,
  cache,
  accountId,
  tenantId,
  initialOrder,
}: {
  client: FoodClient;
  cache: FoodDraftCache;
  accountId: string;
  tenantId: string;
  initialOrder: string;
}) {
  const [state, setState] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useFoodDraft(
    cache,
    `food:orders:${tenantId}:selected`,
    initialOrder,
  );
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const load = useCallback(
    () =>
      client.listOrders(tenantId, {
        limit: 30,
        cursor,
        ...(state ? { state: state as NuniFoodOrderState } : {}),
      }),
    [client, tenantId, cursor, state],
  );
  const orders = useFoodRead(load, { pollMs: FOOD_POLL_MS });
  const grouped = useMemo(() => {
    const rows = orders.data?.orders ?? [];
    return {
      active: rows.filter((order) => isFoodOrderInProgress(order.state)),
      done: rows.filter((order) => !isFoodOrderInProgress(order.state)),
    };
  }, [orders.data]);
  const detailOpen = !!selected;

  function openOrder(orderId: string, trigger?: HTMLElement | null) {
    returnFocusRef.current = trigger ?? null;
    setSelected(orderId);
    window.history.replaceState(
      null,
      '',
      `/food?tenant=${encodeURIComponent(tenantId)}&order=${encodeURIComponent(orderId)}`,
    );
  }

  function closeOrder() {
    setSelected('');
    window.history.replaceState(null, '', `/food?tenant=${encodeURIComponent(tenantId)}`);
    queueMicrotask(() => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && document.contains(target)) {
        target.focus();
        return;
      }
      listHeadingRef.current?.focus();
    });
  }

  return (
    <div className={styles.stack}>
      {selected && (
        <FoodOrderDetail
          key={`${tenantId}:${selected}`}
          client={client}
          cache={cache}
          accountId={accountId}
          tenantId={tenantId}
          orderId={selected}
          onChange={orders.reload}
          onBack={closeOrder}
        />
      )}
      <section
        className={styles.panel}
        aria-label="訂單紀錄"
        hidden={detailOpen}
        inert={detailOpen || undefined}
      >
        <div className={`${styles.bar} ${styles.orderListHeader}`}>
          <div>
            <h2 ref={listHeadingRef} tabIndex={-1}>
              訂單紀錄
            </h2>
          </div>
          <Button variant="ghost" disabled={orders.loading} onClick={() => void orders.reload()}>
            更新訂單紀錄
          </Button>
        </div>
        <Select
          label="訂單狀態"
          value={state}
          options={[
            { value: '', label: '全部訂單' },
            ...Object.entries(foodStateLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(event) => {
            setState(event.target.value);
            setCursor(undefined);
          }}
        />
        {orders.loading && <p role="status">正在查詢訂單…</p>}
        {orders.error && <p role="alert">{orders.error}</p>}
        {orders.data && (
          <>
            {!orders.data.orders.length && <p>這個條件下沒有訂單。</p>}
            {grouped.active.length > 0 && (
              <div className={styles.orderGroup}>
                <h3 className={styles.orderGroupTitle}>進行中</h3>
                {grouped.active.map((order) => (
                  <OrderSummaryRow
                    key={order.id}
                    order={order}
                    selected={selected === order.id}
                    onOpen={(trigger) => openOrder(order.id, trigger)}
                  />
                ))}
              </div>
            )}
            {grouped.done.length > 0 && (
              <div className={styles.orderGroup}>
                <h3 className={styles.orderGroupTitle}>已結束</h3>
                {grouped.done.map((order) => (
                  <OrderSummaryRow
                    key={order.id}
                    order={order}
                    selected={selected === order.id}
                    onOpen={(trigger) => openOrder(order.id, trigger)}
                  />
                ))}
              </div>
            )}
            <div className={styles.bar}>
              {cursor && <Button onClick={() => setCursor(undefined)}>回到第一頁訂單</Button>}
              {orders.data.nextCursor && (
                <Button onClick={() => setCursor(orders.data!.nextCursor)}>下一頁訂單</Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OrderSummaryRow({
  order,
  selected,
  onOpen,
}: {
  order: {
    id: string;
    locationName: string;
    state: string;
    itemCount: number;
    total: { amountMinor: number; currency: string };
    requestedPickupAt: string;
    allowedActions: readonly string[];
  };
  selected: boolean;
  onOpen(trigger: HTMLElement | null): void;
}) {
  const next = foodCustomerNextStep({
    state: order.state,
    allowedActions: order.allowedActions,
    mode: 'summary',
  });
  return (
    <div className={styles.row} data-selected={selected || undefined}>
      <div className={styles.orderSummary}>
        <h3>{order.locationName}</h3>
        <p>
          {foodStateLabels[order.state] ?? order.state} · {order.itemCount} 份 ·{' '}
          {foodMoney(order.total)}
        </p>
        <p>預計取餐 {foodTime(order.requestedPickupAt)}</p>
        <p className={styles.nextStep}>{next}</p>
      </div>
      <Button
        aria-label={`查看訂單：${order.id}`}
        aria-current={selected ? 'true' : undefined}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        查看訂單
      </Button>
    </div>
  );
}

export function FoodOrderDetail({
  client,
  cache,
  accountId,
  tenantId,
  orderId,
  onChange,
  onBack,
}: {
  client: FoodClient;
  cache: FoodDraftCache;
  accountId: string;
  tenantId: string;
  orderId: string;
  onChange(): Promise<unknown>;
  onBack(): void;
}) {
  const scope = `food:order:${tenantId}:${orderId}`;
  const panelRef = useRef<HTMLElement>(null);
  const load = useCallback(() => client.getOrder(tenantId, orderId), [client, tenantId, orderId]);
  const order = useFoodRead(load, {
    pollMs: FOOD_POLL_MS,
    shouldPoll: (data) => !data || !FOOD_TERMINAL_STATES.has(data.state),
  });
  const [reason, setReason] = useFoodDraft<NuniFoodCustomerCancelReason>(
    cache,
    `${scope}:reason`,
    'changed-mind',
  );
  const [detail, setDetail] = useFoodDraft(cache, `${scope}:reason-detail`, '');
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const now = useFoodClock();
  const [checkout, setCheckout] = useState<NuniFoodPaymentSessionProjection | null>(null);
  const task = useFoodMutation({
    cache,
    scope,
    accountId,
    enabled: !!order.data,
    reload: async () => {
      await order.reload();
      await onChange();
    },
    execute: (intent) =>
      intent.action === 'cancel'
        ? client.cancelOrder(tenantId, orderId, intent.input)
        : client.createPaymentSession(tenantId, orderId, intent.input),
    onSuccess(result, intent) {
      setCancelConfirmed(false);
      setShowToken(false);
      if (intent.action === 'pay') setCheckout(result as NuniFoodPaymentSessionProjection);
    },
  });
  useEffect(() => {
    panelRef.current?.focus();
  }, [orderId]);
  const locked = !order.data || task.busy || !!task.pending || task.storageBlocked;
  const receipt = order.data;
  const payment = checkout ?? receipt?.paymentSession;
  const token = receipt?.pickup.credential;
  const canShow =
    !!receipt?.allowedActions.includes('show-pickup-credential') &&
    receipt.pickup.allowedActions.includes('present-one-time-token') &&
    !!token &&
    Date.parse(token.expiresAt) > now;
  const nextStep = receipt
    ? foodCustomerNextStep({
        state: receipt.state,
        allowedActions: receipt.allowedActions,
        pickup: receipt.pickup,
        payment: payment ?? null,
        now,
        mode: 'detail',
      })
    : '';
  const inProgress = receipt ? isFoodOrderInProgress(receipt.state) : false;
  return (
    <section ref={panelRef} className={styles.panel} aria-label="訂單詳情" tabIndex={-1}>
      <div className={styles.bar}>
        <div>
          {receipt ? (
            <p className={styles.eyebrow}>{inProgress ? '進行中的訂單' : '已結束的訂單'}</p>
          ) : null}
          <h2>這次的訂單</h2>
        </div>
        <div className={styles.barActions}>
          <Button disabled={task.busy} onClick={onBack}>
            返回訂單列表
          </Button>
          <Button
            disabled={task.busy || order.loading}
            onClick={() => {
              setShowToken(false);
              setCheckout(null);
              void order.reload();
            }}
          >
            更新這筆訂單
          </Button>
        </div>
      </div>
      {order.loading && <p role="status">正在確認訂單…</p>}
      {order.error && <p role="alert">{order.error}</p>}
      <FoodMutationStatus task={task} />
      {receipt && (
        <div className={styles.stack}>
          <div className={styles.nextStepBanner} role="status">
            <p className={styles.eyebrow}>下一步</p>
            <p>{nextStep}</p>
          </div>
          <div>
            <h3>
              {receipt.locationName} · {foodStateLabels[receipt.state]}
            </h3>
            <details>
              <summary>訂單編號</summary>
              <p>{receipt.id}</p>
            </details>
            <p>
              預計取餐 {foodTime(receipt.requestedPickupAt)} · 取餐號碼 {receipt.pickup.displayCode}
            </p>
          </div>
          <p className={styles.amount}>訂單總額 {foodMoney(receipt.total)}</p>
          {receipt.state === 'payment-pending' &&
            !(
              payment &&
              (payment.progress === 'authorized-awaiting-settlement' || payment.progress === 'paid')
            ) && <p>付款尚未完成。請到櫃檯向店員確認付款方式；店員收到款項後才會更新訂單。</p>}
          {receipt.allowedActions.includes('create-payment-session') &&
            !(
              payment &&
              (payment.progress === 'authorized-awaiting-settlement' || payment.progress === 'paid')
            ) && (
              <PaymentActions
                client={client}
                tenantId={tenantId}
                locationId={receipt.locationId}
                task={task}
                disabled={locked}
              />
            )}
          {payment && (
            <div>
              <p>
                付款進度：
                {
                  {
                    opening: '正在準備結帳',
                    'awaiting-payment': '等待付款',
                    'authorized-awaiting-settlement': '等待入帳',
                    paid: '已入帳',
                    failed: '付款未完成',
                    canceled: '已取消付款',
                    expired: '結帳已逾時',
                    refunding: '退款中',
                    refunded: '已退款',
                    'awaiting-offline-payment': '等待現場付款',
                  }[payment.progress]
                }
              </p>
              {payment.failureReason && <p>{payment.failureReason}</p>}
              {receipt.state === 'payment-pending' &&
                payment.allowedActions.includes('open-checkout') &&
                Date.parse(payment.expiresAt) > now && (
                  <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer">
                    前往安全付款頁面
                  </a>
                )}
            </div>
          )}
          {receipt.refund && (
            <p>
              退款：{receipt.refund.state === 'completed' ? '已完成' : '等待處理'} ·{' '}
              {foodMoney(receipt.refund.amount)}
            </p>
          )}
          {receipt.pickup.callCount > 0 && (
            <p>
              店家已叫號 {receipt.pickup.callCount} 次
              {receipt.pickup.lastCalledAt
                ? `，最近一次 ${foodTime(receipt.pickup.lastCalledAt)}`
                : ''}
              。叫號不代表已取餐。
            </p>
          )}
          {canShow && (
            <div className={styles.pickupBlock}>
              <Button
                variant="primary"
                disabled={locked}
                onClick={() => setShowToken((value) => !value)}
              >
                {showToken ? '隱藏取餐憑證' : '出示取餐憑證'}
              </Button>
              {showToken && (
                <>
                  <p>請只交給這間店的店員。取餐號碼不能取代這份一次性憑證。</p>
                  <code className={styles.token} aria-label="一次性取餐憑證">
                    {token!.token}
                  </code>
                  <PickupQr token={token!.token} />
                  <p>有效至 {foodTime(token!.expiresAt)}</p>
                </>
              )}
            </div>
          )}
          {receipt.state === 'ready' && !canShow && (
            <p>取餐憑證目前無法使用，請更新這筆訂單取得最新狀態。</p>
          )}
          {receipt.allowedActions.includes('cancel') && (
            <div className={styles.fields}>
              <h3>取消這筆訂單</h3>
              <Select
                label="取消原因"
                disabled={locked}
                value={reason}
                options={[
                  { value: 'changed-mind', label: '改變主意' },
                  { value: 'ordered-by-mistake', label: '點錯餐點' },
                  { value: 'pickup-time-no-longer-works', label: '無法在取餐時間前往' },
                  { value: 'other', label: '其他原因' },
                ]}
                onChange={(event) => {
                  setReason(event.target.value as NuniFoodCustomerCancelReason);
                  setCancelConfirmed(false);
                }}
              />
              {reason === 'other' && (
                <Textarea
                  label="取消原因說明"
                  minLength={3}
                  maxLength={500}
                  disabled={locked}
                  value={detail}
                  onChange={(event) => {
                    setDetail(event.target.value);
                    setCancelConfirmed(false);
                  }}
                />
              )}
              <label className={styles.check}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={cancelConfirmed}
                  onChange={(event) => setCancelConfirmed(event.target.checked)}
                />
                我確認要取消這筆訂單
              </label>
              <Button
                disabled={
                  locked || !cancelConfirmed || (reason === 'other' && detail.trim().length < 3)
                }
                onClick={() => {
                  if (
                    !cancelConfirmed ||
                    locked ||
                    (reason === 'other' && detail.trim().length < 3)
                  )
                    return;
                  void task.send({
                    action: 'cancel',
                    input: {
                      reason,
                      ...(reason === 'other' ? { reasonDetail: detail.trim() } : {}),
                      idempotencyKey: foodKey(),
                    },
                  });
                }}
              >
                確認取消訂單
              </Button>
            </div>
          )}
          <FoodOrderReceipt
            expandLines={inProgress}
            order={{
              id: receipt.id,
              locationName: receipt.locationName,
              lines: receipt.lines,
              total: receipt.total,
              createdAt: receipt.createdAt,
              updatedAt: receipt.updatedAt,
            }}
          />
        </div>
      )}
    </section>
  );
}

function PaymentActions({
  client,
  tenantId,
  locationId,
  task,
  disabled,
}: {
  client: FoodClient;
  tenantId: string;
  locationId: string;
  task: ReturnType<typeof useFoodMutation>;
  disabled: boolean;
}) {
  const load = useCallback(
    () => client.getPaymentMethods(tenantId, locationId),
    [client, tenantId, locationId],
  );
  const methods = useFoodRead(load);
  return (
    <div>
      <p>完成線上結帳後，請更新訂單確認入帳。</p>
      {methods.loading && <p role="status">正在確認可用付款方式…</p>}
      {methods.error && (
        <>
          <p role="alert">{methods.error}</p>
          <Button disabled={methods.loading} onClick={() => void methods.reload()}>
            重新確認付款方式
          </Button>
        </>
      )}
      {methods.data?.unavailableMessage && <p>{methods.data.unavailableMessage}</p>}
      <div className={styles.bar}>
        {methods.data?.methods.map((method) => (
          <div key={method.method}>
            <Button
              disabled={disabled || !method.available}
              onClick={() => {
                if (!method.available || disabled) return;
                void task.send({
                  action: 'pay',
                  input: { method: method.method, idempotencyKey: foodKey() },
                });
              }}
            >
              {method.label}
            </Button>
            {!method.available && method.unavailableMessage && <p>{method.unavailableMessage}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PickupQr({ token }: { token: string }) {
  const [image, setImage] = useState<{ token: string; data: string } | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(token, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (active) setImage({ token, data });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);
  return image?.token === token ? (
    <Image
      src={image.data}
      width={256}
      height={256}
      unoptimized
      alt="讓店員核對的一次性取餐 QR Code"
    />
  ) : null;
}
