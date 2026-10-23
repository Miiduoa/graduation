import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';
import type {
  NuniFoodCancelInput,
  NuniFoodCreateOrderInput,
  NuniFoodMenuItem,
  NuniFoodOrderCommandResult,
  NuniFoodQuoteInput,
  NuniFoodQuoteProjection,
  NuniFoodQuoteLine,
} from '@campus/shared/src/nuniFoodTypes';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import {
  FOOD_POLL_MS,
  FOOD_TERMINAL_STATES,
  FoodButton,
  FoodCard,
  FoodField,
  FoodReadState,
  FoodStorageRecovery,
  FoodText,
  foodTime,
  money,
  orderState,
  useFoodClient,
  useFoodLoad,
  useFoodMutation,
} from './NuniFoodUi';
import { foodPageIntro } from '@campus/shared/src/foodPageCopy';
import { isMobileOnlineOrderingEnabled } from '../../utils/onlineOrdering';

const page = { padding: 20, paddingBottom: 48, gap: 16 };
const key = () => `food-${Crypto.randomUUID()}`;
type Selection = { tenantId: string; name: string; mode: 'menu' | 'orders' };
export function NuniFood() {
  const auth = useNuniSession();
  if (auth.loading || auth.pendingLogout || auth.error || !auth.session)
    return <FoodText>請先確認登入狀態。</FoodText>;
  return (
    <FoodAccount
      key={`${auth.session.platformAccountId}:${auth.session.context}`}
      context={auth.session.context}
    />
  );
}
function FoodAccount({ context }: { context: string }) {
  const client = useFoodClient(context);
  const [selected, select] = useNuniDraftState<Selection | null>('food:selected-realm', null);
  const loader = useCallback(
    async () => ({ public: await client.listRealms(), orders: await client.listOrderRealms() }),
    [client],
  );
  const resource = useFoodLoad(loader);
  const orderingOn = isMobileOnlineOrderingEnabled();
  const active = selected && (orderingOn || selected.mode === 'orders') ? selected : null;
  if (active)
    return (
      <FoodRealm
        key={`${active.tenantId}:${active.mode}`}
        context={context}
        selection={active}
        onBack={() => select(null)}
      />
    );
  return (
    <ScrollView contentContainerStyle={page}>
      <FoodText title>點餐與取餐</FoodText>
      <FoodText>{foodPageIntro(isMobileOnlineOrderingEnabled())}</FoodText>
      <FoodReadState resource={resource} />
      {resource.data ? (
        <>
          {orderingOn ? (
            <>
              <FoodText title>選擇用餐校區</FoodText>
              {resource.data.public
                .filter((realm) => realm.services.includes('food'))
                .map((realm) => (
                  <FoodButton
                    key={realm.tenantId}
                    onPress={() => select({ ...realm, mode: 'menu' })}
                  >{`查看餐點：${realm.name}`}</FoodButton>
                ))}
              {!resource.data.public.some((realm) => realm.services.includes('food')) ? (
                <FoodText>目前沒有開放接單的門市。</FoodText>
              ) : null}
            </>
          ) : null}
          <FoodText title>我的訂單</FoodText>
          <FoodText>店家暫停接新單時，仍可從這裡查看原有訂單。</FoodText>
          {resource.data.orders.map((realm) => (
            <FoodButton
              key={realm.tenantId}
              onPress={() => select({ ...realm, mode: 'orders' })}
            >{`訂單紀錄：${realm.name}`}</FoodButton>
          ))}
          {!resource.data.orders.length ? <FoodText>目前沒有訂單紀錄。</FoodText> : null}
        </>
      ) : null}
    </ScrollView>
  );
}
function FoodRealm({
  context,
  selection,
  onBack,
}: {
  context: string;
  selection: Selection;
  onBack(): void;
}) {
  const client = useFoodClient(context);
  const [locationId, selectLocation] = useNuniDraftState<string | null>(
    `food:${selection.tenantId}:location`,
    null,
  );
  const [orderId, selectOrder] = useNuniDraftState<string | null>(
    `food:${selection.tenantId}:order`,
    null,
  );
  const orderingOn = isMobileOnlineOrderingEnabled();
  const [storedMode, setMode] = useState(selection.mode);
  const mode = orderingOn ? storedMode : 'orders';
  const [cursor, setCursor] = useState<string | undefined>();
  const loader = useCallback(
    async () =>
      mode === 'menu'
        ? {
            kind: 'menu' as const,
            value: await client.listLocations(selection.tenantId, {
              limit: 20,
              ...(cursor ? { cursor } : {}),
            }),
          }
        : {
            kind: 'orders' as const,
            value: await client.listOrders(selection.tenantId, {
              limit: 20,
              ...(cursor ? { cursor } : {}),
            }),
          },
    [client, selection.tenantId, mode, cursor],
  );
  const resource = useFoodLoad(loader, {
    pollMs: mode === 'orders' ? FOOD_POLL_MS : undefined,
  });
  if (orderId)
    return (
      <FoodOrder
        key={orderId}
        context={context}
        tenantId={selection.tenantId}
        orderId={orderId}
        onBack={() => {
          selectOrder(null);
          setMode('orders');
          void resource.load();
        }}
      />
    );
  if (locationId && mode === 'menu')
    return (
      <FoodMenu
        key={locationId}
        context={context}
        tenantId={selection.tenantId}
        locationId={locationId}
        onBack={() => selectLocation(null)}
        onOrder={selectOrder}
      />
    );
  return (
    <ScrollView contentContainerStyle={page}>
      <FoodButton onPress={onBack}>返回用餐校區</FoodButton>
      <FoodText title>{selection.name}</FoodText>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {orderingOn ? (
          <FoodButton
            selected={mode === 'menu'}
            onPress={() => {
              setCursor(undefined);
              setMode('menu');
            }}
          >
            餐點門市
          </FoodButton>
        ) : null}
        <FoodButton
          selected={mode === 'orders'}
          onPress={() => {
            setCursor(undefined);
            setMode('orders');
          }}
        >
          我的訂單
        </FoodButton>
      </View>
      <FoodReadState resource={resource} />
      {resource.data?.kind === 'menu' ? (
        <>
          {resource.data.value.locations.map((location) => (
            <FoodCard key={location.id}>
              <FoodText title>{location.name}</FoodText>
              {!(
                location.state === 'open' &&
                location.description === '店家進駐已核准，尚待完成營運設定。'
              ) ? (
                <FoodText>{location.description}</FoodText>
              ) : null}
              <FoodText>{location.zoneLabel}</FoodText>
              {location.merchantMode === 'full' && location.allowedActions.includes('view-menu') ? (
                <FoodButton
                  onPress={() => selectLocation(location.id)}
                >{`選餐：${location.name}`}</FoodButton>
              ) : (
                <FoodText>這間門市目前沒有開放站內點餐。</FoodText>
              )}
            </FoodCard>
          ))}
          {!resource.data.value.locations.length ? (
            <FoodText>目前沒有開放的門市；已有訂單可至「我的訂單」查詢。</FoodText>
          ) : null}
        </>
      ) : null}
      {resource.data?.kind === 'orders' ? (
        <>
          {resource.data.value.orders.map((order) => (
            <FoodCard key={order.id}>
              <FoodText title>{order.locationName}</FoodText>
              <FoodText>{`${orderState[order.state]} · ${money(order.total)}`}</FoodText>
              <FoodText>{`預計取餐 ${foodTime(order.requestedPickupAt)}`}</FoodText>
              <FoodButton
                onPress={() => selectOrder(order.id)}
                accessibilityLabel={`查看訂單 ${order.id}`}
              >
                查看訂單
              </FoodButton>
            </FoodCard>
          ))}
          {!resource.data.value.orders.length ? (
            <FoodText>這個校區目前沒有你的訂單。</FoodText>
          ) : null}
        </>
      ) : null}
      {resource.data?.value.nextCursor ? (
        <FoodButton onPress={() => setCursor(resource.data!.value.nextCursor)}>下一頁</FoodButton>
      ) : null}
      {cursor ? <FoodButton onPress={() => setCursor(undefined)}>回到第一頁</FoodButton> : null}
    </ScrollView>
  );
}

type CartLine = { quantity: string; selectedOptionIds: string[]; note: string };
type MenuIntent =
  | { kind: 'quote'; input: NuniFoodQuoteInput }
  | { kind: 'order'; input: NuniFoodCreateOrderInput };
function OrderLines({ lines }: { lines: NuniFoodQuoteLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <View key={`${line.menuItemId}:${index}`} style={{ gap: 4 }}>
          <FoodText>{`${line.nameSnapshot} × ${line.quantity} · ${money(line.lineTotal)}`}</FoodText>
          {line.selectedOptions.length ? (
            <FoodText>
              {line.selectedOptions.map((option) => option.nameSnapshot).join('、')}
            </FoodText>
          ) : null}
          {line.customerNote ? <FoodText>{`備註：${line.customerNote}`}</FoodText> : null}
        </View>
      ))}
    </>
  );
}
function FoodMenu({
  context,
  tenantId,
  locationId,
  onBack,
  onOrder,
}: {
  context: string;
  tenantId: string;
  locationId: string;
  onBack(): void;
  onOrder(id: string): void;
}) {
  const client = useFoodClient(context);
  const scope = `food:${tenantId}:${locationId}`;
  const [cart, setCart] = useNuniDraftState<Record<string, CartLine>>(`${scope}:cart`, {});
  const [minutes, setMinutes] = useNuniDraftState(`${scope}:minutes`, '30');
  const [quote, setQuote] = useState<NuniFoodQuoteProjection | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const loader = useCallback(
    () => client.getMenu(tenantId, locationId),
    [client, tenantId, locationId],
  );
  const resource = useFoodLoad(loader);
  const mutation = useFoodMutation<MenuIntent>(
    `${scope}:intent`,
    (intent) =>
      intent.kind === 'quote'
        ? client.createQuote(tenantId, intent.input)
        : client.createOrder(tenantId, intent.input),
    (receipt, intent) => {
      if (intent.kind === 'quote') setQuote(receipt as NuniFoodQuoteProjection);
      else {
        setCart({});
        setQuote(null);
        onOrder((receipt as NuniFoodOrderCommandResult).orderId);
      }
    },
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const locked = mutation.locked || !!quote;
  const update = (id: string, patch: Partial<CartLine>) =>
    setCart((previous) => ({
      ...previous,
      [id]: { quantity: '0', selectedOptionIds: [], note: '', ...previous[id], ...patch },
    }));
  const prepareQuote = () => {
    if (locked || !resource.data || resource.loading || resource.error) return;
    setError('');
    try {
      const items = resource.data.sections.flatMap((section) => section.items);
      const selected = Object.entries(cart).filter(
        ([, value]) => value.quantity !== '' && Number(value.quantity) !== 0,
      );
      const minutesNumber = Number(minutes);
      if (
        !/^\d+$/.test(minutes) ||
        minutesNumber < 1 ||
        minutesNumber > 1440 ||
        selected.length === 0 ||
        selected.length > 20
      )
        throw new Error('selection');
      const input: NuniFoodQuoteInput = {
        locationId,
        requestedPickupAt: new Date(Date.now() + minutesNumber * 60_000).toISOString(),
        idempotencyKey: key(),
        items: selected.map(([id, value]) => {
          const item = items.find((candidate) => candidate.id === id);
          if (
            !item ||
            !item.available ||
            !item.allowedActions.includes('add-to-quote') ||
            !/^\d+$/.test(value.quantity) ||
            Number(value.quantity) < 1 ||
            Number(value.quantity) > 20
          )
            throw new Error('item');
          for (const group of item.optionGroups) {
            const count = group.options.filter((option) =>
              value.selectedOptionIds.includes(option.id),
            ).length;
            if (count < group.minimumSelections || count > group.maximumSelections)
              throw new Error('options');
          }
          if (
            value.selectedOptionIds.some(
              (id) =>
                !item.optionGroups.some((group) =>
                  group.options.some((option) => option.id === id && option.available),
                ),
            )
          )
            throw new Error('options');
          return {
            menuItemId: id,
            quantity: Number(value.quantity),
            selectedOptionIds: value.selectedOptionIds,
            ...(value.note.trim() ? { customerNote: value.note.trim() } : {}),
          };
        }),
      };
      void mutation.send({ kind: 'quote', input });
    } catch {
      setError('請確認品項數量（每項 1–20 份）、必選配料與預計取餐時間（1–1,440 分鐘後）。');
    }
  };
  const renderItem = (item: NuniFoodMenuItem) => {
    const line = cart[item.id] ?? { quantity: '0', selectedOptionIds: [], note: '' };
    const disabled = locked || !item.available || !item.allowedActions.includes('add-to-quote');
    return (
      <FoodCard key={item.id}>
        <FoodText title>{item.name}</FoodText>
        <FoodText>{item.description}</FoodText>
        <FoodText>{money(item.basePrice)}</FoodText>
        {item.allergenTags.length ? (
          <FoodText>{`過敏原：${item.allergenTags.join('、')}`}</FoodText>
        ) : null}
        {!item.available ? <FoodText>目前售完</FoodText> : null}
        <FoodField
          label={`${item.name}數量`}
          numeric
          max={2}
          value={line.quantity}
          disabled={disabled}
          onChange={(quantity) => update(item.id, { quantity })}
        />
        {item.optionGroups.map((group) => (
          <View key={group.id} style={{ gap: 8 }}>
            <FoodText>{`${group.name}（選 ${group.minimumSelections}–${group.maximumSelections} 項）`}</FoodText>
            {group.options.map((option) => (
              <FoodButton
                key={option.id}
                selected={line.selectedOptionIds.includes(option.id)}
                disabled={disabled || !option.available}
                onPress={() =>
                  update(item.id, {
                    selectedOptionIds: line.selectedOptionIds.includes(option.id)
                      ? line.selectedOptionIds.filter((id) => id !== option.id)
                      : [...line.selectedOptionIds, option.id],
                  })
                }
              >{`${item.name}：${option.name}（${money(option.priceDelta)}）`}</FoodButton>
            ))}
          </View>
        ))}
        <FoodField
          label={`${item.name}備註`}
          value={line.note}
          disabled={disabled}
          onChange={(note) => update(item.id, { note })}
        />
      </FoodCard>
    );
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={page}>
      <FoodButton onPress={onBack}>返回門市列表</FoodButton>
      <FoodText title>{resource.data?.location.name ?? '選擇餐點'}</FoodText>
      <FoodReadState resource={resource} disabled={mutation.busy} />
      {mutation.error ? <FoodText alert>{mutation.error}</FoodText> : null}
      <FoodStorageRecovery mutation={mutation} />
      {mutation.pending ? (
        <>
          <FoodText>這次送出內容已保留。返回後仍會使用同一次操作確認。</FoodText>
          <FoodButton
            disabled={
              mutation.busy ||
              mutation.storageBlocked ||
              !mutation.hydrated ||
              resource.loading ||
              !!resource.error
            }
            onPress={() => void mutation.send()}
          >
            重試確認這次送出
          </FoodButton>
        </>
      ) : null}
      {error ? <FoodText alert>{error}</FoodText> : null}
      {quote && resource.data && !resource.error && !resource.loading ? (
        <FoodCard>
          <FoodText title>確認這次訂單</FoodText>
          <OrderLines lines={quote.lines} />
          <FoodText>{`小計 ${money(quote.subtotal)}`}</FoodText>
          {quote.fees.map((fee) => (
            <FoodText key={fee.code}>{`${fee.label}：${money(fee.amount)}`}</FoodText>
          ))}
          <FoodText>{`應付總額 ${money(quote.total)}`}</FoodText>
          <FoodText>{`預計取餐 ${foodTime(quote.requestedPickupAt)}`}</FoodText>
          <FoodText>{`金額與庫存保留至 ${foodTime(quote.expiresAt)}`}</FoodText>
          <FoodText>送出後請到店付款。這個步驟不會線上扣款。</FoodText>
          {Date.parse(quote.expiresAt) <= now ? (
            <FoodText alert>這次報價已過期，請重新確認金額。</FoodText>
          ) : null}
          <FoodButton
            disabled={
              mutation.locked ||
              resource.loading ||
              !!resource.error ||
              Date.parse(quote.expiresAt) <= now ||
              quote.state !== 'active' ||
              !quote.allowedActions.includes('create-order')
            }
            onPress={() =>
              void mutation.send({
                kind: 'order',
                input: { quoteId: quote.id, idempotencyKey: key() },
              })
            }
          >
            確認送出訂單，到店付款
          </FoodButton>
          <FoodButton disabled={mutation.locked} onPress={() => setQuote(null)}>
            返回修改餐點
          </FoodButton>
        </FoodCard>
      ) : resource.data ? (
        <>
          {resource.data.sections.map((section) => (
            <View key={section.id} style={{ gap: 14 }}>
              <FoodText title>{section.name}</FoodText>
              {section.items.map(renderItem)}
            </View>
          ))}
          <FoodField
            label="幾分鐘後取餐"
            numeric
            max={4}
            disabled={locked}
            value={minutes}
            onChange={setMinutes}
          />
          <FoodButton
            disabled={locked || resource.loading || !!resource.error}
            onPress={prepareQuote}
          >
            確認餐點與金額
          </FoodButton>
        </>
      ) : null}
    </ScrollView>
  );
}

function FoodOrder({
  context,
  tenantId,
  orderId,
  onBack,
}: {
  context: string;
  tenantId: string;
  orderId: string;
  onBack(): void;
}) {
  const client = useFoodClient(context);
  const loader = useCallback(() => client.getOrder(tenantId, orderId), [client, tenantId, orderId]);
  const resource = useFoodLoad(loader, {
    pollMs: FOOD_POLL_MS,
    shouldPoll: (data) => !data || !FOOD_TERMINAL_STATES.has(data.state),
  });
  const [reason, setReason] = useNuniDraftState<NuniFoodCancelInput['reason']>(
    `food:${tenantId}:${orderId}:cancel-reason`,
    'changed-mind',
  );
  const [detail, setDetail] = useNuniDraftState(`food:${tenantId}:${orderId}:cancel-detail`, '');
  const [showOrderNumber, setShowOrderNumber] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const mutation = useFoodMutation<NuniFoodCancelInput>(
    `food:${tenantId}:${orderId}:cancel`,
    (intent) => client.cancelOrder(tenantId, orderId, intent),
    () => {
      setConfirm(false);
      setNotice('已送出取消，正在更新訂單狀態。');
      void resource.load();
    },
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const order = resource.data;
  const token = order?.pickup.credential;
  const canShowToken =
    order?.state === 'ready' &&
    order.allowedActions.includes('show-pickup-credential') &&
    order.pickup.allowedActions.includes('present-one-time-token') &&
    token &&
    Date.parse(token.expiresAt) > now;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={page}>
      <FoodButton onPress={onBack}>返回訂單紀錄</FoodButton>
      <FoodText title>訂單進度</FoodText>
      <FoodReadState resource={resource} />
      {notice ? <FoodText>{notice}</FoodText> : null}
      {mutation.error ? <FoodText alert>{mutation.error}</FoodText> : null}
      <FoodStorageRecovery mutation={mutation} />
      {mutation.pending ? (
        <FoodButton
          disabled={
            mutation.busy ||
            mutation.storageBlocked ||
            !mutation.hydrated ||
            resource.loading ||
            !!resource.error
          }
          onPress={() => void mutation.send()}
        >
          重試確認取消
        </FoodButton>
      ) : null}
      {order ? (
        <>
          <FoodText title>{order.locationName}</FoodText>
          <FoodText>{orderState[order.state]}</FoodText>
          <FoodButton
            expanded={showOrderNumber}
            onPress={() => setShowOrderNumber((visible) => !visible)}
          >
            {showOrderNumber ? '收起訂單編號' : '訂單編號'}
          </FoodButton>
          {showOrderNumber ? <FoodText>{`訂單 ${order.id}`}</FoodText> : null}
          <FoodText>{`取餐號碼 ${order.pickup.displayCode}`}</FoodText>
          <FoodText>{`預計取餐 ${foodTime(order.requestedPickupAt)}`}</FoodText>
          <OrderLines lines={order.lines} />
          <FoodText>{`應付總額 ${money(order.total)}`}</FoodText>
          {order.state === 'payment-pending' ? (
            <FoodText>請到店付款，由店家確認實際收款。付款完成後再重新讀取進度。</FoodText>
          ) : null}
          {order.refund ? (
            <FoodText>
              {order.refund.state === 'completed' ? '退款已完成。' : '退款仍在處理，尚未完成。'}
            </FoodText>
          ) : null}
          {canShowToken ? (
            <FoodCard>
              <FoodText title>出示給店家取餐</FoodText>
              <FoodText>這組憑證只能使用一次；請勿轉傳給他人。</FoodText>
              <View
                accessibilityLabel="取餐 QR 碼"
                style={{ padding: 16, backgroundColor: '#fff', alignSelf: 'flex-start' }}
              >
                <QRCode value={token.token} size={200} color="#111111" backgroundColor="#ffffff" />
              </View>
              <Text selectable accessibilityLabel="一次性取餐憑證">
                {token.token}
              </Text>
              <FoodText>{`有效至 ${foodTime(token.expiresAt)}`}</FoodText>
            </FoodCard>
          ) : order.state === 'ready' ? (
            <FoodText>請重新讀取有效取餐憑證。取餐號碼不能代替憑證核銷。</FoodText>
          ) : null}
          {order.allowedActions.includes('cancel') ? (
            <FoodCard>
              <FoodText title>取消訂單</FoodText>
              {(
                [
                  ['changed-mind', '不需要了'],
                  ['ordered-by-mistake', '餐點點錯'],
                  ['pickup-time-no-longer-works', '無法準時取餐'],
                  ['other', '其他原因'],
                ] as const
              ).map(([value, label]) => (
                <FoodButton
                  key={value}
                  selected={reason === value}
                  disabled={mutation.locked || confirm}
                  onPress={() => setReason(value)}
                >
                  {label}
                </FoodButton>
              ))}
              {reason === 'other' ? (
                <FoodField
                  label="取消原因說明"
                  disabled={mutation.locked || confirm}
                  value={detail}
                  onChange={setDetail}
                  max={500}
                />
              ) : null}
              {!confirm ? (
                <FoodButton
                  disabled={mutation.locked || (reason === 'other' && detail.trim().length < 3)}
                  onPress={() => setConfirm(true)}
                >
                  檢查取消訂單
                </FoodButton>
              ) : (
                <>
                  <FoodText>確定取消這張訂單？若已付款，退款進度會另外顯示。</FoodText>
                  <FoodButton
                    disabled={mutation.locked}
                    onPress={() =>
                      void mutation.send({
                        reason,
                        ...(reason === 'other' ? { reasonDetail: detail.trim() } : {}),
                        idempotencyKey: key(),
                      })
                    }
                  >
                    確認取消這張訂單
                  </FoodButton>
                  <FoodButton disabled={mutation.locked} onPress={() => setConfirm(false)}>
                    保留訂單
                  </FoodButton>
                </>
              )}
            </FoodCard>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
