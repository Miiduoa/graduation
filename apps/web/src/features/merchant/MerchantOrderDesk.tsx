'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createNuniFoodClient,
  type NuniFoodStaffOrderQueueItem,
  type NuniFoodOrderCommandResult,
  type NuniFoodHandoverReceipt,
} from '@campus/shared/src/nuniFood';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import {
  FOOD_POLL_MS,
  FoodMutationStatus,
  foodKey,
  foodMoney,
  foodStateLabels,
  foodTime,
  useFoodDraft,
  useFoodMutation,
  useFoodRead,
  type FoodDraftCache,
  type FoodIntent,
} from '@/features/food/foodState';
import { merchantOrderBucket, merchantOrderNextStep } from '@/features/food/foodOrderGuidance';
import styles from '@/features/food/Food.module.css';
import { PickupScanner } from './PickupScanner';

const actionLabels: Record<string, string> = {
  'record-counter-payment': '登記櫃檯收款',
  accept: '接單',
  reject: '無法接單',
  'cancel-accepted': '取消已接訂單',
  'confirm-counter-refund': '確認已退還款項',
  'fulfill-pickup': '核對憑證並交付餐點',
};
const channelLabels = {
  cash: '現場現金',
  'campus-ledger': '校內記帳',
  counter: '櫃檯收款',
  online: '線上付款（已收到）',
  demo: '測試付款（沒有實際入帳）',
};
export function MerchantOrderDesk({
  context,
  tenantId,
  locationId,
  cache,
}: {
  context: string;
  tenantId: string;
  locationId: string;
  cache: FoodDraftCache;
}) {
  const auth = useNuniSession();
  const accountId = auth.session?.platformAccountId ?? '';
  const client = useMemo(
    () =>
      createNuniFoodClient((path, input, query) =>
        browserRequest(path, context, input, undefined, query),
      ),
    [context],
  );
  const scope = `merchant-food:${tenantId}:${locationId}`;
  const [cursor, setCursor] = useState<string | undefined>();
  const load = useCallback(async () => {
    const [queue, shift] = await Promise.all([
      client.listMerchantOrders(tenantId, locationId, { limit: 50, cursor }),
      client.getShift(tenantId, locationId).catch((error: unknown) => {
        if (
          error instanceof NuniError &&
          error.status === 404 &&
          error.code === 'FOOD_SHIFT_NOT_FOUND'
        )
          return null;
        throw error;
      }),
    ]);
    return { queue, shift };
  }, [client, tenantId, locationId, cursor]);
  const data = useFoodRead(load, { pollMs: FOOD_POLL_MS });
  const [opening, setOpening] = useFoodDraft(cache, `${scope}:opening`, '0');
  const [counted, setCounted] = useFoodDraft(cache, `${scope}:counted`, '');
  const [openNext, setOpenNext] = useFoodDraft(cache, `${scope}:open-next`, false);
  const [nextCash, setNextCash] = useFoodDraft(cache, `${scope}:next-cash`, '0');
  const [handoverNote, setHandoverNote] = useFoodDraft(cache, `${scope}:handover-note`, '');
  const [confirmedShift, setConfirmedShift] = useState<{ id: string | null } | null>(null);
  const shiftConfirm =
    !!confirmedShift && !!data.data && confirmedShift.id === (data.data.shift?.id ?? null);
  const setShiftConfirm = (confirmed: boolean) => {
    setConfirmedShift(confirmed ? { id: data.data?.shift?.id ?? null } : null);
  };
  const [selected, setSelected] = useState<{ action: string; orderId: string } | null>(null);
  const [fields, setFields] = useFoodDraft<
    Record<string, { token: string; reason: string; detail: string }>
  >(cache, `${scope}:order-fields`, {});
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [shiftOpen, setShiftOpen] = useState(true);
  const execute = (intent: FoodIntent) => {
    const args = [tenantId, locationId] as const;
    switch (intent.action) {
      case 'open-shift':
        return client.openShift(...args, intent.input);
      case 'handover':
        return client.handoverShift(...args, intent.input);
      case 'record-counter-payment':
        return client.recordCounterPayment(...args, intent.orderId!, intent.input);
      case 'accept':
        return client.acceptOrder(...args, intent.orderId!, intent.input);
      case 'reject':
        return client.rejectOrder(...args, intent.orderId!, intent.input);
      case 'cancel-accepted':
        return client.cancelAcceptedOrder(...args, intent.orderId!, intent.input);
      case 'confirm-counter-refund':
        return client.confirmCounterRefund(...args, intent.orderId!, intent.input);
      case 'fulfill-pickup':
        return client.fulfillOrder(...args, intent.orderId!, intent.input);
      case 'start-preparation':
        return client.startTicket(...args, intent.orderId!, intent.ticketId!, intent.input);
      case 'mark-ready':
        return client.readyTicket(...args, intent.orderId!, intent.ticketId!, intent.input);
      default:
        throw new Error('Unsupported action');
    }
  };
  const task = useFoodMutation({
    cache,
    scope,
    accountId,
    enabled: !!data.data,
    execute,
    reload: data.reload,
    onSuccess(result, intent) {
      setSelected(null);
      setConfirmed(false);
      setShiftConfirm(false);
      if (intent.action === 'open-shift') setReceipt('已開啟收銀班別。');
      else if (intent.action === 'handover') {
        const value = result as NuniFoodHandoverReceipt;
        setReceipt(
          `交班已完成。應有現金 ${value.closed.expectedCash ? foodMoney(value.closed.expectedCash) : '請查看班別紀錄'}，實點 ${value.closed.countedCash ? foodMoney(value.closed.countedCash) : '已登記'}。${value.next ? '下一班已開啟。' : '目前沒有開啟的班別。'}`,
        );
        setCounted('');
      } else {
        const value = result as NuniFoodOrderCommandResult;
        setReceipt(`訂單 ${value.orderId}：${foodStateLabels[value.state] ?? '已更新'}。`);
        if (intent.action === 'fulfill-pickup')
          setFields((current) => ({
            ...current,
            [intent.orderId!]: { token: '', reason: 'item-unavailable', detail: '' },
          }));
      }
    },
  });
  const locked = !data.data || task.busy || !!task.pending || task.storageBlocked;
  const incomingOrders = useMemo(
    () =>
      (data.data?.queue.orders ?? []).filter((order) => merchantOrderBucket(order) === 'incoming'),
    [data.data],
  );
  const activeOrders = useMemo(
    () =>
      (data.data?.queue.orders ?? []).filter((order) => merchantOrderBucket(order) === 'active'),
    [data.data],
  );
  useEffect(() => {
    if (!confirmedShift || !data.data || task.busy || task.pending) return;
    const shift = data.data.shift;
    if (
      confirmedShift.id !== (shift?.id ?? null) ||
      (shift && !shift.allowedActions.includes('handover'))
    )
      setConfirmedShift(null);
  }, [confirmedShift, data.data, task.busy, task.pending]);
  const chosen = data.data?.queue.orders.find((order) => order.id === selected?.orderId);
  useEffect(() => {
    if (!selected || !data.data || task.busy || task.pending) return;
    if (
      !chosen ||
      !chosen.allowedActions.includes(
        selected.action as NuniFoodStaffOrderQueueItem['allowedActions'][number],
      )
    ) {
      setSelected(null);
      setConfirmed(false);
    }
  }, [selected, data.data, chosen, task.busy, task.pending]);
  const form = selected
    ? (fields[selected.orderId] ?? { token: '', reason: 'item-unavailable', detail: '' })
    : null;
  const setField = (field: 'token' | 'reason' | 'detail', value: string) => {
    if (!selected || locked) return;
    setFields((previous) => ({
      ...previous,
      [selected.orderId]: {
        ...(previous[selected.orderId] ?? { token: '', reason: 'item-unavailable', detail: '' }),
        [field]: value,
      },
    }));
    setConfirmed(false);
  };
  const cashValid = (value: string) => /^\d+$/.test(value) && Number(value) <= 10_000_000;
  function submitOrder() {
    if (
      !selected ||
      !chosen ||
      !form ||
      !confirmed ||
      locked ||
      !chosen.allowedActions.includes(
        selected.action as NuniFoodStaffOrderQueueItem['allowedActions'][number],
      )
    )
      return;
    const reasonRequired = ['reject', 'cancel-accepted'].includes(selected.action);
    if (
      (selected.action === 'fulfill-pickup' &&
        !/^[A-Za-z0-9_-]{32,512}$/.test(form.token.trim())) ||
      (reasonRequired && form.reason === 'other' && form.detail.trim().length < 3)
    )
      return;
    void task.send({
      action: selected.action,
      orderId: selected.orderId,
      input: {
        idempotencyKey: foodKey(),
        ...(selected.action === 'fulfill-pickup' ? { pickupToken: form.token.trim() } : {}),
        ...(reasonRequired
          ? {
              reason: form.reason,
              ...(form.reason === 'other' ? { reasonDetail: form.detail.trim() } : {}),
            }
          : {}),
      },
    });
  }
  return (
    <section className={styles.panel} aria-label="門市訂單工作台">
      <div className={styles.bar}>
        <h2>收款、備餐與取餐</h2>
        <Button
          disabled={task.busy || data.loading}
          onClick={() => {
            setSelected(null);
            setConfirmed(false);
            setShiftConfirm(false);
            void data.reload();
          }}
        >
          更新工作台
        </Button>
      </div>
      <p>暫停接單後，已收到的餐點仍會留在這裡。每個動作依目前訂單與你的門市權限提供。</p>
      {data.loading && <p role="status">正在核對訂單與班別…</p>}
      {data.error && <p role="alert">{data.error}</p>}
      <FoodMutationStatus task={task} />
      {receipt && <p role="status">{receipt}</p>}
      {data.data && (
        <div className={styles.stack}>
          {!data.data.shift ? (
            <section className={styles.row} aria-label="收銀班別">
              <h3>開始收銀</h3>
              <div className={styles.fields}>
                <p>先開啟班別，才可登記櫃檯收到的款項。</p>
                <Input
                  label="期初現金（元）"
                  type="number"
                  min={0}
                  max={10000000}
                  step={1}
                  disabled={locked}
                  value={opening}
                  onChange={(event) => {
                    setOpening(event.target.value);
                    setShiftConfirm(false);
                  }}
                />
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={shiftConfirm}
                    onChange={(event) => setShiftConfirm(event.target.checked)}
                  />
                  我已清點這一班的期初現金
                </label>
                <Button
                  disabled={locked || !shiftConfirm || !cashValid(opening)}
                  onClick={() => {
                    if (!shiftConfirm || locked || !cashValid(opening)) return;
                    void task.send({
                      action: 'open-shift',
                      input: { openingCashMinor: Number(opening), idempotencyKey: foodKey() },
                    });
                  }}
                >
                  確認開班
                </Button>
              </div>
            </section>
          ) : null}
          <section aria-label="待處理訂單" className={styles.stack}>
            <div>
              <h3>待處理訂單</h3>
              <p className={styles.muted}>先處理待收款與確認，再進行備餐與取餐。</p>
            </div>
            {!data.data.queue.orders.length && <p>這一頁沒有待處理的訂單。</p>}
            {incomingOrders.length > 0 && (
              <div className={styles.orderGroup} aria-label="待收款與確認">
                <h4 className={styles.orderGroupTitle}>
                  待收款與確認 <span>{incomingOrders.length}</span>
                </h4>
                {incomingOrders.map((order) => (
                  <MerchantOrderCard
                    key={order.id}
                    order={order}
                    locked={locked}
                    selected={selected}
                    onSelect={(action) => {
                      setSelected({ action, orderId: order.id });
                      setConfirmed(false);
                    }}
                    onTicket={(action, ticketId) =>
                      void task.send({
                        action,
                        orderId: order.id,
                        ticketId,
                        input: { idempotencyKey: foodKey() },
                      })
                    }
                  />
                ))}
              </div>
            )}
            {activeOrders.length > 0 && (
              <div className={styles.orderGroup} aria-label="進行中訂單">
                <h4 className={styles.orderGroupTitle}>
                  備餐與取餐 <span>{activeOrders.length}</span>
                </h4>
                {activeOrders.map((order) => (
                  <MerchantOrderCard
                    key={order.id}
                    order={order}
                    locked={locked}
                    selected={selected}
                    onSelect={(action) => {
                      setSelected({ action, orderId: order.id });
                      setConfirmed(false);
                    }}
                    onTicket={(action, ticketId) =>
                      void task.send({
                        action,
                        orderId: order.id,
                        ticketId,
                        input: { idempotencyKey: foodKey() },
                      })
                    }
                  />
                ))}
              </div>
            )}
            <div className={styles.bar}>
              {cursor && (
                <Button disabled={task.busy} onClick={() => setCursor(undefined)}>
                  回到第一頁待處理訂單
                </Button>
              )}
              {data.data.queue.nextCursor && (
                <Button disabled={task.busy} onClick={() => setCursor(data.data!.queue.nextCursor)}>
                  下一頁待處理訂單
                </Button>
              )}
            </div>
          </section>
          {data.data.shift ? (
            <details
              className={styles.shiftDetails}
              aria-label="收銀班別"
              open={shiftOpen}
              onToggle={(event) => setShiftOpen(event.currentTarget.open)}
            >
              <summary>
                <span className={styles.shiftSummaryTitle}>目前收銀班別</span>
                <span className={styles.muted}>
                  開班 {foodTime(data.data.shift.openedAt)} · 期初{' '}
                  {foodMoney(data.data.shift.openingCash)} · 校內記帳{' '}
                  {foodMoney(data.data.shift.campusLedgerTotal)}
                </span>
              </summary>
              {data.data.shift.allowedActions.includes('handover') ? (
                <div className={styles.fields}>
                  <p>交班會結束這一班的收銀紀錄。未完成餐點仍在原班別，線上付款不計入抽屜現金。</p>
                  <Input
                    label="交班實點現金（元）"
                    type="number"
                    min={0}
                    max={10000000}
                    step={1}
                    disabled={locked}
                    value={counted}
                    onChange={(event) => {
                      setCounted(event.target.value);
                      setShiftConfirm(false);
                    }}
                  />
                  <Textarea
                    label="交班備註（選填）"
                    maxLength={300}
                    disabled={locked}
                    value={handoverNote}
                    onChange={(event) => {
                      setHandoverNote(event.target.value);
                      setShiftConfirm(false);
                    }}
                  />
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={openNext}
                      onChange={(event) => {
                        setOpenNext(event.target.checked);
                        setShiftConfirm(false);
                      }}
                    />
                    交班後開啟下一班
                  </label>
                  {openNext && (
                    <Input
                      label="下一班期初現金（元）"
                      type="number"
                      min={0}
                      max={10000000}
                      step={1}
                      disabled={locked}
                      value={nextCash}
                      onChange={(event) => {
                        setNextCash(event.target.value);
                        setShiftConfirm(false);
                      }}
                    />
                  )}
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={shiftConfirm}
                      disabled={locked}
                      onChange={(event) => setShiftConfirm(event.target.checked)}
                    />
                    我已清點現金，確認交班內容
                  </label>
                  <Button
                    disabled={
                      locked ||
                      !shiftConfirm ||
                      !cashValid(counted) ||
                      (openNext && !cashValid(nextCash))
                    }
                    onClick={() => {
                      if (
                        !shiftConfirm ||
                        locked ||
                        !cashValid(counted) ||
                        (openNext && !cashValid(nextCash))
                      )
                        return;
                      void task.send({
                        action: 'handover',
                        input: {
                          countedCashMinor: Number(counted),
                          openNext,
                          ...(openNext ? { nextOpeningCashMinor: Number(nextCash) } : {}),
                          ...(handoverNote.trim() ? { note: handoverNote.trim() } : {}),
                          idempotencyKey: foodKey(),
                        },
                      });
                    }}
                  >
                    確認交班
                  </Button>
                </div>
              ) : (
                <p className={styles.muted}>這一班目前沒有交班操作。</p>
              )}
            </details>
          ) : null}
          {selected && chosen && form && (
            <section className={styles.row} aria-label="確認訂單操作">
              <h3>
                {actionLabels[selected.action]} · 取餐 {chosen.pickupDisplayCode}
              </h3>
              {chosen.viewerScope === 'cash-register' && <p>金額 {foodMoney(chosen.total)}</p>}
              {selected.action === 'record-counter-payment' && (
                <p>只在實際收到這筆款項後確認。此操作登記現場收款，不會替顧客刷卡。</p>
              )}
              {selected.action === 'confirm-counter-refund' && (
                <p>請先實際把款項退給顧客，才確認退款紀錄。</p>
              )}
              {selected.action === 'fulfill-pickup' && (
                <>
                  <p>請核對顧客出示的一次性憑證。單靠取餐號碼不能交付餐點。</p>
                  <PickupScanner
                    key={selected.orderId}
                    disabled={locked}
                    onToken={(token) => setField('token', token)}
                  />
                  <Input
                    label="顧客的一次性取餐憑證"
                    autoComplete="off"
                    maxLength={512}
                    value={form.token}
                    disabled={locked}
                    onChange={(event) => setField('token', event.target.value)}
                  />
                </>
              )}
              {['reject', 'cancel-accepted'].includes(selected.action) && (
                <>
                  <Select
                    label="店家處理原因"
                    value={form.reason}
                    disabled={locked}
                    options={[
                      { value: 'item-unavailable', label: '餐點或食材不足' },
                      { value: 'location-closed', label: '門市無法供餐' },
                      { value: 'preparation-capacity', label: '無法負荷目前餐量' },
                      { value: 'payment-problem', label: '付款有問題' },
                      { value: 'other', label: '其他原因' },
                    ]}
                    onChange={(event) => setField('reason', event.target.value)}
                  />
                  {form.reason === 'other' && (
                    <Textarea
                      label="店家原因說明"
                      minLength={3}
                      maxLength={500}
                      value={form.detail}
                      disabled={locked}
                      onChange={(event) => setField('detail', event.target.value)}
                    />
                  )}
                </>
              )}
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {selected.action === 'record-counter-payment'
                  ? '我已實際收到這筆訂單的款項'
                  : selected.action === 'confirm-counter-refund'
                    ? '我已實際退還這筆款項'
                    : selected.action === 'fulfill-pickup'
                      ? '我已核對憑證，準備把這份餐交給顧客'
                      : '我已確認這筆訂單與處理內容'}
              </label>
              <div className={styles.bar}>
                <Button
                  disabled={
                    locked ||
                    !confirmed ||
                    (selected.action === 'fulfill-pickup' &&
                      !/^[A-Za-z0-9_-]{32,512}$/.test(form.token.trim())) ||
                    (['reject', 'cancel-accepted'].includes(selected.action) &&
                      form.reason === 'other' &&
                      form.detail.trim().length < 3)
                  }
                  onClick={submitOrder}
                >
                  確認：{actionLabels[selected.action]}
                </Button>
                <Button
                  disabled={locked}
                  onClick={() => {
                    setSelected(null);
                    setConfirmed(false);
                  }}
                >
                  先不操作
                </Button>
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function MerchantOrderCard({
  order,
  locked,
  selected,
  onSelect,
  onTicket,
}: {
  order: NuniFoodStaffOrderQueueItem;
  locked: boolean;
  selected: { action: string; orderId: string } | null;
  onSelect(action: string): void;
  onTicket(action: 'start-preparation' | 'mark-ready', ticketId: string): void;
}) {
  const next = merchantOrderNextStep(order);
  const highlighted = selected?.orderId === order.id;
  return (
    <article className={styles.row} data-selected={highlighted || undefined}>
      <h4>
        取餐 {order.pickupDisplayCode} · {foodStateLabels[order.state]}
      </h4>
      <p className={styles.nextStep}>{next}</p>
      <p>
        訂單 {order.id} · 預計 {foodTime(order.requestedPickupAt)}
      </p>
      {order.lines.map((line, index) => (
        <p key={index}>
          {[
            `${line.nameSnapshot} × ${line.quantity}`,
            line.selectedOptions.map((option) => option.nameSnapshot).join('、'),
            line.customerNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ))}
      {order.viewerScope === 'cash-register' && (
        <>
          <p className={styles.amount}>應付 {foodMoney(order.total)}</p>
          <p>{order.paymentChannel ? channelLabels[order.paymentChannel] : '尚未登記付款'}</p>
        </>
      )}
      <div className={styles.bar}>
        {order.allowedActions
          .filter((action) => action in actionLabels)
          .map((action) => (
            <Button
              key={action}
              variant={
                action === 'accept' ||
                action === 'record-counter-payment' ||
                action === 'fulfill-pickup'
                  ? 'primary'
                  : 'default'
              }
              disabled={locked}
              onClick={() => onSelect(action)}
            >
              {actionLabels[action]}：{order.pickupDisplayCode}
            </Button>
          ))}
      </div>
      {(order.kitchenTickets ?? []).map((ticket) => (
        <div className={styles.bar} key={ticket.id}>
          <p>
            {{ hot: '熱食', cold: '冷食', drinks: '飲品', combo: '組餐' }[ticket.station]}
            工作單 ·{' '}
            {
              {
                queued: '待準備',
                preparing: '準備中',
                ready: '已完成',
                fulfilled: '已交付',
                cancelled: '已取消',
              }[ticket.state]
            }
          </p>
          {ticket.allowedActions.includes('start-preparation') &&
            order.allowedActions.includes('start-preparation') && (
              <Button disabled={locked} onClick={() => onTicket('start-preparation', ticket.id)}>
                開始備餐：{ticket.id}
              </Button>
            )}
          {ticket.allowedActions.includes('mark-ready') &&
            order.allowedActions.includes('mark-ready') && (
              <Button disabled={locked} onClick={() => onTicket('mark-ready', ticket.id)}>
                餐點已備妥：{ticket.id}
              </Button>
            )}
        </div>
      ))}
    </article>
  );
}
