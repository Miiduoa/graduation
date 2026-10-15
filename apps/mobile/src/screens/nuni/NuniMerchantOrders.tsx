import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  NuniFoodStaffOrderQueueItem,
  NuniFoodStaffRejectReason,
} from '@campus/shared/src/nuniFoodTypes';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { NuniPickupScanner } from './NuniPickupScanner';
import {
  FOOD_POLL_MS,
  FoodButton,
  FoodCard,
  FoodField,
  FoodReadState,
  FoodText,
  foodTime,
  money,
  orderState,
  useFoodClient,
  useFoodLoad,
  useFoodMutation,
} from './NuniFoodUi';

type Intent =
  | { kind: 'open' | 'handover'; cash: number; note: string; idempotencyKey: string; label: string }
  | {
      kind: 'counter' | 'accept' | 'start' | 'ready' | 'fulfill' | 'refund' | 'reject' | 'cancel';
      reason: NuniFoodStaffRejectReason;
      reasonDetail: string;
      orderId: string;
      ticketId: string;
      token: string;
      idempotencyKey: string;
      label: string;
    };
const reasons: [NuniFoodStaffRejectReason, string][] = [
  ['item-unavailable', '餐點無法供應'],
  ['location-closed', '門市已停止營業'],
  ['preparation-capacity', '無法如期備餐'],
  ['payment-problem', '付款有問題'],
  ['other', '其他原因'],
];
const stationNames: Record<string, string> = {
  hot: '熱食',
  cold: '冷食',
  drinks: '飲料',
  combo: '組合餐',
};
export function NuniMerchantOrders({
  tenantId,
  locationId,
  context,
  onBack,
}: {
  tenantId: string;
  locationId: string;
  context: string;
  onBack(): void;
}) {
  const client = useFoodClient(context);
  const scope = `merchant-food:${tenantId}:${locationId}`;
  const [cursor, setCursor] = useState<string | undefined>();
  const [cash, setCash] = useNuniDraftState(`${scope}:cash`, '');
  const [note, setNote] = useNuniDraftState(`${scope}:note`, '');
  const [tokens, setTokens] = useNuniDraftState<Record<string, string>>(`${scope}:tokens`, {});
  const [reasonsByOrder, setReasonsByOrder] = useNuniDraftState<
    Record<string, NuniFoodStaffRejectReason>
  >(`${scope}:reasons`, {});
  const [detailsByOrder, setDetailsByOrder] = useNuniDraftState<Record<string, string>>(
    `${scope}:reason-details`,
    {},
  );
  const [review, setReview] = useState<Intent | null>(null);
  const [notice, setNotice] = useState('');
  const [scanOrder, setScanOrder] = useState<string | null>(null);
  const [error, setError] = useState('');
  const loader = useCallback(async () => {
    const [queue, shift] = await Promise.all([
      client.listMerchantOrders(tenantId, locationId, { limit: 50, ...(cursor ? { cursor } : {}) }),
      client
        .getShift(tenantId, locationId)
        .then((value) => ({ kind: 'open' as const, value }))
        .catch((failure: unknown) => {
          if (
            failure instanceof NuniError &&
            failure.status === 404 &&
            failure.code === 'FOOD_SHIFT_NOT_FOUND'
          )
            return { kind: 'none' as const };
          if (failure instanceof NuniError && failure.status === 403)
            return { kind: 'restricted' as const };
          throw failure;
        }),
    ]);
    return { queue, shift };
  }, [client, tenantId, locationId, cursor]);
  const resource = useFoodLoad(loader, { pollMs: FOOD_POLL_MS });
  const mutation = useFoodMutation<Intent>(
    `${scope}:intent`,
    (intent) => {
      const input = { idempotencyKey: intent.idempotencyKey };
      switch (intent.kind) {
        case 'open':
          return client.openShift(tenantId, locationId, {
            ...input,
            openingCashMinor: intent.cash,
          });
        case 'handover':
          return client.handoverShift(tenantId, locationId, {
            ...input,
            countedCashMinor: intent.cash,
            openNext: false,
            ...(intent.note ? { note: intent.note } : {}),
          });
        case 'counter':
          return client.recordCounterPayment(tenantId, locationId, intent.orderId, input);
        case 'refund':
          return client.confirmCounterRefund(tenantId, locationId, intent.orderId, input);
        case 'reject':
        case 'cancel': {
          const details = {
            ...input,
            reason: intent.reason,
            ...(intent.reasonDetail ? { reasonDetail: intent.reasonDetail } : {}),
          };
          return intent.kind === 'reject'
            ? client.rejectOrder(tenantId, locationId, intent.orderId, details)
            : client.cancelAcceptedOrder(tenantId, locationId, intent.orderId, details);
        }
        case 'accept':
          return client.acceptOrder(tenantId, locationId, intent.orderId, input);
        case 'start':
          return client.startTicket(tenantId, locationId, intent.orderId, intent.ticketId, input);
        case 'ready':
          return client.readyTicket(tenantId, locationId, intent.orderId, intent.ticketId, input);
        case 'fulfill':
          return client.fulfillOrder(tenantId, locationId, intent.orderId, {
            ...input,
            pickupToken: intent.token,
          });
      }
    },
    (_receipt, intent) => {
      setReview(null);
      if (intent.kind === 'fulfill')
        setTokens((previous) => ({ ...previous, [intent.orderId]: '' }));
      if (intent.kind === 'open' || intent.kind === 'handover') {
        setCash('');
        setNote('');
      }
      setNotice('已完成，正在更新訂單與班次。');
      void resource.load();
    },
  );
  useEffect(() => {
    if (!scanOrder || !resource.data || mutation.locked || review) return;
    const stillAllowed = resource.data.queue.orders.some(
      (order) => order.id === scanOrder && order.allowedActions.includes('fulfill-pickup'),
    );
    if (!stillAllowed) setScanOrder(null);
  }, [scanOrder, resource.data, mutation.locked, review]);
  useEffect(() => {
    if (!review || !resource.data || mutation.locked || mutation.pending) return;
    if (!('orderId' in review)) return;
    const orderId = review.orderId;
    const order = resource.data.queue.orders.find((entry) => entry.id === orderId);
    const actionOk =
      review.kind === 'counter'
        ? order?.allowedActions.includes('record-counter-payment')
        : review.kind === 'accept'
          ? order?.allowedActions.includes('accept')
          : review.kind === 'fulfill'
            ? order?.allowedActions.includes('fulfill-pickup')
            : review.kind === 'refund'
              ? order?.allowedActions.includes('confirm-counter-refund')
              : review.kind === 'reject'
                ? order?.allowedActions.includes('reject')
                : review.kind === 'cancel'
                  ? order?.allowedActions.includes('cancel-accepted')
                  : review.kind === 'start' || review.kind === 'ready'
                    ? !!order
                    : false;
    if (!actionOk) setReview(null);
  }, [review, resource.data, mutation.locked, mutation.pending]);
  const disabled =
    mutation.locked || !!review || resource.loading || !!resource.error || !resource.data;
  const prepareShift = (kind: 'open' | 'handover') => {
    if (disabled) return;
    const amount = Number(cash);
    if (!/^\d+$/.test(cash) || !Number.isSafeInteger(amount) || amount > 10_000_000) {
      setError('請輸入實際清點的現金整數金額（0–10,000,000 元）。');
      return;
    }
    setError('');
    setReview({
      kind,
      cash: amount,
      note: note.trim(),
      label: kind === 'open' ? `開班，起始現金 ${amount} 元` : `交班，實點現金 ${amount} 元`,
      idempotencyKey: `food-${Crypto.randomUUID()}`,
    });
  };
  const prepareOrder = (
    kind: 'counter' | 'accept' | 'start' | 'ready' | 'fulfill' | 'refund' | 'reject' | 'cancel',
    order: NuniFoodStaffOrderQueueItem,
    label: string,
    ticketId = '',
  ) => {
    if (disabled) return;
    const token = tokens[order.id]?.trim() ?? '';
    const reason = reasonsByOrder[order.id] ?? 'item-unavailable';
    const reasonDetail = detailsByOrder[order.id]?.trim() ?? '';
    if ((kind === 'reject' || kind === 'cancel') && reason === 'other' && reasonDetail.length < 3) {
      setError('其他原因請至少填寫 3 個字，讓顧客知道處理情況。');
      return;
    }
    if (kind === 'fulfill' && !/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
      setError('請貼上顧客出示的完整一次性取餐憑證；取餐號碼不能代替憑證。');
      return;
    }
    setError('');
    setReview({
      kind,
      orderId: order.id,
      ticketId,
      token: kind === 'fulfill' ? token : '',
      reason,
      reasonDetail,
      label,
      idempotencyKey: `food-${Crypto.randomUUID()}`,
    });
  };
  const scanning =
    scanOrder &&
    resource.data?.queue.orders.find(
      (order) => order.id === scanOrder && order.allowedActions.includes('fulfill-pickup'),
    );
  if (scanning && !resource.loading && !resource.error && !mutation.locked && !review)
    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <FoodText>{`取餐 ${scanning.pickupDisplayCode}`}</FoodText>
        <NuniPickupScanner
          key={scanning.id}
          onCancel={() => setScanOrder(null)}
          onToken={(value) => {
            setTokens((previous) => ({ ...previous, [scanning.id]: value }));
            setScanOrder(null);
            setNotice('已讀取憑證，請核對餐點後按「檢查取餐」。');
          }}
        />
      </ScrollView>
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
    >
      <FoodButton onPress={onBack}>返回門市設定</FoodButton>
      <FoodText title>處理訂單與收銀</FoodText>
      <FoodText>暫停接新單不會取消原有訂單，請繼續完成備餐與交付。</FoodText>
      <FoodReadState resource={resource} disabled={mutation.busy} />
      {notice ? <FoodText>{notice}</FoodText> : null}
      {error ? <FoodText alert>{error}</FoodText> : null}
      {mutation.error ? <FoodText alert>{mutation.error}</FoodText> : null}
      {mutation.pending ? (
        <FoodCard>
          <FoodText title>確認上一筆操作</FoodText>
          {resource.data ? <FoodText>{mutation.pending.label}</FoodText> : null}
          <FoodText>尚未確認結果，其他操作暫時鎖定；重試會使用原本內容。</FoodText>
          <FoodButton
            disabled={mutation.busy || resource.loading || !!resource.error}
            onPress={() => void mutation.send()}
          >
            重試確認上一筆操作
          </FoodButton>
        </FoodCard>
      ) : null}
      {review && !mutation.pending && resource.data ? (
        <FoodCard>
          <FoodText title>請確認實際情況</FoodText>
          <FoodText>{review.label}</FoodText>
          {review.kind === 'counter' ? (
            <FoodText>請先向顧客收款。此按鈕只登記已收到的款項，不會刷卡或扣款。</FoodText>
          ) : null}
          {review.kind === 'refund' ? (
            <FoodText>請先將款項退還顧客。此按鈕只登記實際退款，不會自動匯款或刷退。</FoodText>
          ) : null}
          {review.kind === 'reject' || review.kind === 'cancel' ? (
            <FoodText>{`原因：${reasons.find(([value]) => value === review.reason)?.[1]}${review.reasonDetail ? `；${review.reasonDetail}` : ''}。若有已收款項，請依更新後的退款狀態辦理。`}</FoodText>
          ) : null}
          {review.kind === 'fulfill' ? (
            <FoodText>請核對顧客與餐點，再送出核銷。成功後，這組憑證不能再次使用。</FoodText>
          ) : null}
          {review.kind === 'handover' ? (
            <FoodText>這會結束目前班次，不會自動開下一班。</FoodText>
          ) : null}
          <FoodButton
            disabled={mutation.busy || resource.loading || !!resource.error}
            onPress={() => void mutation.send(review)}
          >
            {review.kind === 'counter'
              ? '我已實際收到款項，確認登記'
              : review.kind === 'refund'
                ? '我已實際退還款項，確認登記'
                : review.kind === 'fulfill'
                  ? '確認交付餐點並核銷'
                  : '確認執行這次操作'}
          </FoodButton>
          <FoodButton disabled={mutation.busy} onPress={() => setReview(null)}>
            返回檢查
          </FoodButton>
        </FoodCard>
      ) : null}
      {resource.data ? (
        <>
          <FoodCard>
            <FoodText title>目前班次</FoodText>
            {resource.data.shift.kind === 'open' ? (
              <>
                <FoodText>{`開班時間 ${foodTime(resource.data.shift.value.openedAt)}`}</FoodText>
                <FoodText>{`起始現金 ${money(resource.data.shift.value.openingCash)}`}</FoodText>
                {resource.data.shift.value.expectedCash ? (
                  <FoodText>{`應有現金 ${money(resource.data.shift.value.expectedCash)}`}</FoodText>
                ) : null}
                {resource.data.shift.value.allowedActions.includes('handover') ? (
                  <>
                    <FoodField
                      label="交班實點現金（元）"
                      numeric
                      disabled={disabled}
                      value={cash}
                      onChange={setCash}
                      max={8}
                    />
                    <FoodField
                      label="交班備註（選填）"
                      disabled={disabled}
                      value={note}
                      onChange={setNote}
                    />
                    <FoodButton disabled={disabled} onPress={() => prepareShift('handover')}>
                      檢查交班
                    </FoodButton>
                  </>
                ) : null}
              </>
            ) : resource.data.shift.kind === 'none' ? (
              <>
                <FoodText>尚未開班。先清點起始現金，才能登記現場收款。</FoodText>
                <FoodField
                  label="起始現金（元）"
                  numeric
                  disabled={disabled}
                  value={cash}
                  onChange={setCash}
                  max={8}
                />
                <FoodButton disabled={disabled} onPress={() => prepareShift('open')}>
                  檢查開班
                </FoodButton>
              </>
            ) : (
              <FoodText>你的權限不包含收銀班次，可處理下方授權的備餐工作。</FoodText>
            )}
          </FoodCard>
          <FoodText title>待處理訂單</FoodText>
          {!resource.data.queue.orders.length ? <FoodText>這一頁沒有待處理訂單。</FoodText> : null}
          {resource.data.queue.orders.map((order) => (
            <FoodCard key={order.id}>
              <FoodText title>{`取餐 ${order.pickupDisplayCode}`}</FoodText>
              <FoodText>{orderState[order.state]}</FoodText>
              <FoodText>{`預計 ${foodTime(order.requestedPickupAt)}`}</FoodText>
              {order.lines.map((line, index) => (
                <View key={`${line.menuItemId}:${index}`}>
                  <FoodText>{`${line.nameSnapshot} × ${line.quantity}`}</FoodText>
                  {line.selectedOptions.length ? (
                    <FoodText>
                      {line.selectedOptions.map((option) => option.nameSnapshot).join('、')}
                    </FoodText>
                  ) : null}
                  {line.customerNote ? <FoodText>{`備註：${line.customerNote}`}</FoodText> : null}
                </View>
              ))}
              {order.viewerScope === 'cash-register' ? (
                <>
                  <FoodText>{`總額 ${money(order.total)}`}</FoodText>
                  {order.paymentChannel === 'online' ? (
                    <FoodText>已線上付款，請勿重複收款。</FoodText>
                  ) : null}
                  {order.allowedActions.includes('record-counter-payment') ? (
                    <FoodButton
                      disabled={disabled}
                      onPress={() =>
                        prepareOrder(
                          'counter',
                          order,
                          `訂單 ${order.pickupDisplayCode}，實收 ${money(order.total)}`,
                        )
                      }
                    >{`登記現場收款：${order.pickupDisplayCode}`}</FoodButton>
                  ) : null}
                </>
              ) : null}
              {order.allowedActions.includes('accept') ? (
                <FoodButton
                  disabled={disabled}
                  onPress={() =>
                    prepareOrder('accept', order, `接受訂單 ${order.pickupDisplayCode}`)
                  }
                >{`接單：${order.pickupDisplayCode}`}</FoodButton>
              ) : null}
              {order.viewerScope === 'cash-register' &&
              order.allowedActions.includes('confirm-counter-refund') ? (
                <FoodButton
                  disabled={disabled}
                  onPress={() =>
                    prepareOrder(
                      'refund',
                      order,
                      `訂單 ${order.pickupDisplayCode}，實退 ${money(order.total)}`,
                    )
                  }
                >{`登記現場退款：${order.pickupDisplayCode}`}</FoodButton>
              ) : null}
              {order.allowedActions.includes('reject') ||
              order.allowedActions.includes('cancel-accepted') ? (
                <View style={{ gap: 8 }}>
                  <FoodText>{`訂單 ${order.pickupDisplayCode} 無法供餐的原因`}</FoodText>
                  {reasons.map(([value, label]) => (
                    <FoodButton
                      key={value}
                      disabled={disabled}
                      onPress={() =>
                        setReasonsByOrder((previous) => ({ ...previous, [order.id]: value }))
                      }
                    >{`${(reasonsByOrder[order.id] ?? 'item-unavailable') === value ? '已選：' : ''}${label}：${order.pickupDisplayCode}`}</FoodButton>
                  ))}
                  <FoodField
                    label={`訂單 ${order.pickupDisplayCode} 原因補充（其他原因必填）`}
                    disabled={disabled}
                    max={500}
                    value={detailsByOrder[order.id] ?? ''}
                    onChange={(value) =>
                      setDetailsByOrder((previous) => ({ ...previous, [order.id]: value }))
                    }
                  />
                  {order.allowedActions.includes('reject') ? (
                    <FoodButton
                      disabled={disabled}
                      onPress={() =>
                        prepareOrder('reject', order, `婉拒訂單 ${order.pickupDisplayCode}`)
                      }
                    >{`檢查拒單：${order.pickupDisplayCode}`}</FoodButton>
                  ) : null}
                  {order.allowedActions.includes('cancel-accepted') ? (
                    <FoodButton
                      disabled={disabled}
                      onPress={() =>
                        prepareOrder('cancel', order, `取消已接訂單 ${order.pickupDisplayCode}`)
                      }
                    >{`檢查取消已接訂單：${order.pickupDisplayCode}`}</FoodButton>
                  ) : null}
                </View>
              ) : null}
              {(order.kitchenTickets ?? []).map((ticket) => (
                <View key={ticket.id} style={{ gap: 8 }}>
                  <FoodText>{`${stationNames[ticket.station] ?? ticket.station}：${ticket.state === 'queued' ? '等待備餐' : ticket.state === 'preparing' ? '備餐中' : ticket.state === 'ready' ? '已備妥' : '已結束'}`}</FoodText>
                  {ticket.allowedActions.includes('start-preparation') ? (
                    <FoodButton
                      disabled={disabled}
                      onPress={() =>
                        prepareOrder(
                          'start',
                          order,
                          `訂單 ${order.pickupDisplayCode} 開始${stationNames[ticket.station]}備餐`,
                          ticket.id,
                        )
                      }
                    >{`開始備餐：${order.pickupDisplayCode} ${stationNames[ticket.station]}`}</FoodButton>
                  ) : null}
                  {ticket.allowedActions.includes('mark-ready') ? (
                    <FoodButton
                      disabled={disabled}
                      onPress={() =>
                        prepareOrder(
                          'ready',
                          order,
                          `訂單 ${order.pickupDisplayCode} ${stationNames[ticket.station]}已備妥`,
                          ticket.id,
                        )
                      }
                    >{`餐點備妥：${order.pickupDisplayCode} ${stationNames[ticket.station]}`}</FoodButton>
                  ) : null}
                </View>
              ))}
              {order.allowedActions.includes('fulfill-pickup') ? (
                <>
                  <FoodButton
                    disabled={disabled}
                    onPress={() => setScanOrder(order.id)}
                  >{`掃描取餐 QR：${order.pickupDisplayCode}`}</FoodButton>
                  <FoodField
                    label={`取餐 ${order.pickupDisplayCode} 的一次性憑證`}
                    value={tokens[order.id] ?? ''}
                    max={512}
                    disabled={disabled}
                    onChange={(value) =>
                      setTokens((previous) => ({ ...previous, [order.id]: value }))
                    }
                  />
                  <FoodButton
                    disabled={disabled}
                    onPress={() =>
                      prepareOrder(
                        'fulfill',
                        order,
                        `將訂單 ${order.pickupDisplayCode} 交付顧客`,
                        '',
                      )
                    }
                  >{`檢查取餐：${order.pickupDisplayCode}`}</FoodButton>
                </>
              ) : null}
            </FoodCard>
          ))}
          {resource.data.queue.nextCursor ? (
            <FoodButton
              disabled={disabled}
              onPress={() => setCursor(resource.data!.queue.nextCursor)}
            >
              下一頁訂單
            </FoodButton>
          ) : null}
          {cursor ? (
            <FoodButton disabled={disabled} onPress={() => setCursor(undefined)}>
              回到第一頁訂單
            </FoodButton>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
