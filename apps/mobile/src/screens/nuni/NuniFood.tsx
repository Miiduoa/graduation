import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';
import type {
  NuniFoodCancelInput,
  NuniFoodCustomerOrderDetail,
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
  FoodQuantityStepper,
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

import { foodCustomerNextStep } from './foodOrderGuidance';
import { PickupTimePicker } from './PickupTimePicker';
import { formatPickupTime, pickupTimeFromMinutes } from './foodPickupTime';

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

type CartLine = { quantity: string; selectedOptionIds: string[]; note: string; inBasket?: boolean };
type MenuStage = 'menu' | 'customize' | 'basket';
type MenuIntent =
  | { kind: 'quote'; input: NuniFoodQuoteInput }
  | { kind: 'order'; input: NuniFoodCreateOrderInput };
type LineIssue = { kind: 'quantity' | 'options' | 'item'; message: string };
const emptyLine = (): CartLine => ({ quantity: '0', selectedOptionIds: [], note: '' });
const activeCartEntries = (cart: Record<string, CartLine>) =>
  Object.entries(cart).filter(
    ([, value]) =>
      value.inBasket !== false && value.quantity !== '' && Number(value.quantity) !== 0,
  );
function OrderLines({ lines }: { lines: NuniFoodQuoteLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <View key={`${line.menuItemId}:${index}`} style={{ gap: 4 }}>
          <FoodText>{`${line.nameSnapshot} × ${line.quantity} · ${money(line.lineTotal)}`}</FoodText>
          {line.selectedOptions.length ? (
            <FoodText subdued>
              {line.selectedOptions.map((option) => option.nameSnapshot).join('、')}
            </FoodText>
          ) : null}
          {line.customerNote ? <FoodText subdued>{`備註：${line.customerNote}`}</FoodText> : null}
        </View>
      ))}
    </>
  );
}
function describeOptions(item: NuniFoodMenuItem, line: CartLine) {
  const names = item.optionGroups.flatMap((group) =>
    group.options
      .filter((option) => line.selectedOptionIds.includes(option.id))
      .map((option) => option.name),
  );
  return names.length ? names.join('、') : item.optionGroups.length ? '尚未選配料' : '未加選配料';
}
function toggleOption(
  line: CartLine,
  group: NuniFoodMenuItem['optionGroups'][number],
  optionId: string,
) {
  if (line.selectedOptionIds.includes(optionId))
    return line.selectedOptionIds.filter((id) => id !== optionId);
  const previous =
    group.maximumSelections === 1
      ? line.selectedOptionIds.filter((id) => !group.options.some((option) => option.id === id))
      : line.selectedOptionIds;
  return [...previous, optionId];
}
function validateLine(item: NuniFoodMenuItem | undefined, line: CartLine): LineIssue | null {
  if (!item || !item.available || !item.allowedActions.includes('add-to-quote'))
    return { kind: 'item', message: `${item?.name ?? '此餐點'}目前無法加入。` };
  if (!/^\d+$/.test(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 20)
    return { kind: 'quantity', message: `${item.name}數量需為 1–20 份。` };
  for (const group of item.optionGroups) {
    const count = group.options.filter((option) =>
      line.selectedOptionIds.includes(option.id),
    ).length;
    if (count < group.minimumSelections || count > group.maximumSelections)
      return {
        kind: 'options',
        message: `「${item.name}」請選擇「${group.name}」（${group.minimumSelections}–${group.maximumSelections} 項）。`,
      };
  }
  if (
    line.selectedOptionIds.some(
      (id) =>
        !item.optionGroups.some((group) =>
          group.options.some((option) => option.id === id && option.available),
        ),
    )
  )
    return { kind: 'options', message: `「${item.name}」有無法使用的配料，請重新選擇。` };
  return null;
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
  const [submittingPickupAt, setSubmittingPickupAt] = useState<string>();
  const preparingQuote = useRef(false);
  const [stage, setStage] = useState<MenuStage>('menu');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
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
        setStage('menu');
        setFocusId(null);
        setLineErrors({});
        onOrder((receipt as NuniFoodOrderCommandResult).orderId);
      }
    },
  );
  useEffect(() => {
    // A failed verification read may follow a successful save. Keep the time
    // fixed until storage recovery or a confirmed result unlocks the operation.
    if (!mutation.locked) setSubmittingPickupAt(undefined);
  }, [mutation.locked]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const locked = mutation.locked || !!quote;
  const catalog = resource.data?.sections.flatMap((section) => section.items) ?? [];
  const selected = activeCartEntries(cart);
  const cartCount = selected.reduce((sum, [, line]) => {
    const quantity = Number(line.quantity);
    return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
  const focusItem = focusId ? catalog.find((item) => item.id === focusId) : undefined;
  const focusLine = focusId ? (cart[focusId] ?? emptyLine()) : emptyLine();
  const update = (id: string, patch: Partial<CartLine>) =>
    setCart((previous) => ({
      ...previous,
      [id]: { ...emptyLine(), ...previous[id], ...patch },
    }));
  const openCustomize = (item: NuniFoodMenuItem) => {
    if (locked || !item.available || !item.allowedActions.includes('add-to-quote')) return;
    setError('');
    setLineErrors((previous) => {
      const next = { ...previous };
      delete next[item.id];
      return next;
    });
    setCart((previous) => {
      const current = previous[item.id];
      if (current && current.quantity !== '' && Number(current.quantity) > 0) return previous;
      return {
        ...previous,
        [item.id]: { ...emptyLine(), ...current, quantity: '1', inBasket: false },
      };
    });
    setFocusId(item.id);
    setStage('customize');
  };
  const saveCustomize = () => {
    if (!focusItem || locked) return;
    const line = cart[focusItem.id] ?? emptyLine();
    const issue = validateLine(focusItem, line);
    if (issue) {
      setError('');
      setLineErrors((previous) => ({ ...previous, [focusItem.id]: issue.message }));
      return;
    }
    setLineErrors((previous) => {
      const next = { ...previous };
      delete next[focusItem.id];
      return next;
    });
    setError('');
    update(focusItem.id, { inBasket: true });
    setFocusId(null);
    setStage('menu');
  };
  const removeLine = (id: string) => {
    if (locked) return;
    setCart((previous) => {
      return {
        ...previous,
        [id]: { ...emptyLine(), ...previous[id], quantity: '0' },
      };
    });
    setLineErrors((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    if (focusId === id) {
      setFocusId(null);
      setStage('menu');
    }
  };
  const prepareQuote = () => {
    if (locked || preparingQuote.current || !resource.data || resource.loading || resource.error)
      return;
    setError('');
    const nextErrors: Record<string, string> = {};
    try {
      const requestedAt = Date.now();
      setNow(requestedAt);
      const requestedPickupAt = pickupTimeFromMinutes(minutes, requestedAt);
      if (!requestedPickupAt) {
        setError('預計取餐時間需為 1–1,440 分鐘後。');
        return;
      }
      if (selected.length === 0) {
        setError('請先選至少一道餐點。');
        return;
      }
      if (selected.length > 20) {
        setError('一次最多確認 20 道品項。');
        return;
      }
      const input: NuniFoodQuoteInput = {
        locationId,
        requestedPickupAt,
        idempotencyKey: key(),
        items: selected.map(([id, value]) => {
          const item = catalog.find((candidate) => candidate.id === id);
          const issue = validateLine(item, value);
          if (issue) {
            nextErrors[id] = issue.message;
            throw new Error(issue.kind);
          }
          return {
            menuItemId: id,
            quantity: Number(value.quantity),
            selectedOptionIds: value.selectedOptionIds,
            ...(value.note.trim() ? { customerNote: value.note.trim() } : {}),
          };
        }),
      };
      setLineErrors({});
      preparingQuote.current = true;
      setSubmittingPickupAt(requestedPickupAt);
      void mutation.send({ kind: 'quote', input }).finally(() => {
        preparingQuote.current = false;
      });
    } catch (failure) {
      setLineErrors(nextErrors);
      const first = Object.values(nextErrors)[0];
      setError(
        first
          ? ''
          : failure instanceof Error && failure.message === 'quantity'
            ? '請確認品項數量（每項 1–20 份）。'
            : '請確認品項數量（每項 1–20 份）、必選配料與預計取餐時間（1–1,440 分鐘後）。',
      );
    }
  };
  const renderBrowseItem = (item: NuniFoodMenuItem) => {
    const line = cart[item.id];
    const qty = line && line.quantity !== '' ? Number(line.quantity) : 0;
    const inCart = line?.inBasket !== false && qty > 0;
    const canAdd = item.available && item.allowedActions.includes('add-to-quote');
    return (
      <FoodCard key={item.id}>
        <FoodText title>{item.name}</FoodText>
        {item.description ? <FoodText subdued>{item.description}</FoodText> : null}
        <FoodText>{money(item.basePrice)}</FoodText>
        {item.allergenTags.length ? (
          <FoodText subdued>{`過敏原：${item.allergenTags.join('、')}`}</FoodText>
        ) : null}
        {!item.available ? <FoodText status>目前售完</FoodText> : null}
        {inCart ? (
          <>
            <FoodText status>{`已選 ${qty} 份 · ${describeOptions(item, line)}`}</FoodText>
            {line.note.trim() ? <FoodText subdued>{`備註：${line.note.trim()}`}</FoodText> : null}
          </>
        ) : null}
        {lineErrors[item.id] ? <FoodText alert>{lineErrors[item.id]}</FoodText> : null}
        {canAdd ? (
          <FoodButton
            disabled={locked}
            accessibilityLabel={inCart ? `調整${item.name}` : `選擇${item.name}`}
            onPress={() => openCustomize(item)}
          >
            {inCart ? `調整：${item.name}` : `選擇：${item.name}`}
          </FoodButton>
        ) : item.available ? (
          <FoodText subdued>這道餐點目前不能線上點。</FoodText>
        ) : null}
      </FoodCard>
    );
  };
  const renderCustomize = () => {
    if (!focusItem) return null;
    const disabled =
      locked || !focusItem.available || !focusItem.allowedActions.includes('add-to-quote');
    return (
      <FoodCard>
        <FoodText title>{focusItem.name}</FoodText>
        {focusItem.description ? <FoodText subdued>{focusItem.description}</FoodText> : null}
        <FoodText>{money(focusItem.basePrice)}</FoodText>
        {focusItem.allergenTags.length ? (
          <FoodText subdued>{`過敏原：${focusItem.allergenTags.join('、')}`}</FoodText>
        ) : null}
        <FoodQuantityStepper
          label={`${focusItem.name}數量`}
          value={focusLine.quantity === '0' ? '1' : focusLine.quantity}
          disabled={disabled}
          onChange={(quantity) => update(focusItem.id, { quantity })}
        />
        {focusItem.optionGroups.map((group) => (
          <View key={group.id} style={{ gap: 8 }}>
            <FoodText>{`${group.name}（選 ${group.minimumSelections}–${group.maximumSelections} 項）`}</FoodText>
            {group.options.map((option) => (
              <FoodButton
                key={option.id}
                selected={focusLine.selectedOptionIds.includes(option.id)}
                disabled={
                  disabled ||
                  !option.available ||
                  (!focusLine.selectedOptionIds.includes(option.id) &&
                    group.maximumSelections !== 1 &&
                    group.options.filter((value) => focusLine.selectedOptionIds.includes(value.id))
                      .length >= group.maximumSelections)
                }
                onPress={() =>
                  update(focusItem.id, {
                    selectedOptionIds: toggleOption(focusLine, group, option.id),
                  })
                }
              >{`${focusItem.name}：${option.name}（${money(option.priceDelta)}）`}</FoodButton>
            ))}
          </View>
        ))}
        {lineErrors[focusItem.id] ? <FoodText alert>{lineErrors[focusItem.id]}</FoodText> : null}
        <FoodField
          label={`${focusItem.name}備註`}
          value={focusLine.note}
          disabled={disabled}
          onChange={(note) => update(focusItem.id, { note })}
        />
        <FoodButton variant="primary" disabled={disabled} onPress={saveCustomize}>
          放入購物籃
        </FoodButton>
        <FoodButton
          disabled={locked}
          onPress={() => {
            if (
              focusLine.quantity === '0' ||
              focusLine.quantity === '' ||
              Number(focusLine.quantity) === 0
            )
              removeLine(focusItem.id);
            else {
              setFocusId(null);
              setStage('menu');
            }
            setError('');
          }}
        >
          返回菜單
        </FoodButton>
        {selected.some(([id]) => id === focusItem.id) ? (
          <FoodButton disabled={locked} onPress={() => removeLine(focusItem.id)}>
            {`從購物籃移除：${focusItem.name}`}
          </FoodButton>
        ) : null}
      </FoodCard>
    );
  };
  const renderBasket = () => (
    <>
      <FoodText title>確認購物籃</FoodText>
      <FoodText subdued>{`共 ${selected.length} 道 · ${cartCount} 份`}</FoodText>
      {!selected.length ? <FoodText>購物籃還是空的，請先選餐。</FoodText> : null}
      {selected.map(([id, line]) => {
        const item = catalog.find((candidate) => candidate.id === id);
        if (!item)
          return (
            <FoodCard key={id}>
              <FoodText>這道餐點已不在目前菜單中</FoodText>
              <FoodText alert>{lineErrors[id] || '請移除後重新選餐。'}</FoodText>
              <FoodButton disabled={locked} onPress={() => removeLine(id)}>
                移除下架餐點
              </FoodButton>
            </FoodCard>
          );
        const disabled = locked || !item.available || !item.allowedActions.includes('add-to-quote');
        return (
          <FoodCard key={id}>
            <FoodText title>{item.name}</FoodText>
            <FoodText subdued>{describeOptions(item, line)}</FoodText>
            <FoodQuantityStepper
              label={`${item.name}數量`}
              value={line.quantity}
              min={0}
              disabled={disabled}
              onChange={(quantity) => update(id, { quantity })}
            />
            {item.optionGroups.map((group) => (
              <View key={group.id} style={{ gap: 8 }}>
                <FoodText>{`${group.name}（選 ${group.minimumSelections}–${group.maximumSelections} 項）`}</FoodText>
                {group.options.map((option) => (
                  <FoodButton
                    key={option.id}
                    selected={line.selectedOptionIds.includes(option.id)}
                    disabled={
                      disabled ||
                      !option.available ||
                      (!line.selectedOptionIds.includes(option.id) &&
                        group.maximumSelections !== 1 &&
                        group.options.filter((value) => line.selectedOptionIds.includes(value.id))
                          .length >= group.maximumSelections)
                    }
                    onPress={() =>
                      update(id, {
                        selectedOptionIds: toggleOption(line, group, option.id),
                      })
                    }
                  >{`${item.name}：${option.name}（${money(option.priceDelta)}）`}</FoodButton>
                ))}
              </View>
            ))}
            {lineErrors[id] ? <FoodText alert>{lineErrors[id]}</FoodText> : null}
            <FoodField
              label={`${item.name}備註`}
              value={line.note}
              disabled={disabled}
              onChange={(note) => update(id, { note })}
            />
            <FoodButton disabled={locked} onPress={() => removeLine(id)}>
              {`移除：${item.name}`}
            </FoodButton>
          </FoodCard>
        );
      })}
      {/* Keep quantity fields visible while a pending mutation locks the form. */}
      {locked && !selected.length
        ? catalog
            .filter((item) => cart[item.id])
            .map((item) => (
              <FoodQuantityStepper
                key={`locked-${item.id}`}
                label={`${item.name}數量`}
                value={cart[item.id]?.quantity ?? '0'}
                disabled
                onChange={() => undefined}
              />
            ))
        : null}
      <PickupTimePicker
        disabled={locked}
        value={minutes}
        now={now}
        location={resource.data!.location}
        pendingPickupAt={
          mutation.pending?.kind === 'quote'
            ? mutation.pending.input.requestedPickupAt
            : submittingPickupAt
        }
        onChange={(value) => {
          if (locked) return;
          setMinutes(value);
          setNow(Date.now());
          setError('');
        }}
      />
      <FoodButton
        variant="primary"
        disabled={locked || resource.loading || !!resource.error || !selected.length}
        onPress={prepareQuote}
      >
        確認餐點與金額
      </FoodButton>
      <FoodButton
        disabled={locked}
        onPress={() => {
          setStage('menu');
          setError('');
        }}
      >
        繼續選餐
      </FoodButton>
    </>
  );
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={page}>
      <FoodButton onPress={onBack}>返回門市列表</FoodButton>
      <FoodText title>{resource.data?.location.name ?? '選擇餐點'}</FoodText>
      <FoodText status>
        {stage === 'customize'
          ? '調整這道餐點'
          : stage === 'basket'
            ? '檢查購物籃與取餐時間'
            : '選餐後再確認購物籃'}
      </FoodText>
      <FoodReadState resource={resource} disabled={mutation.busy} />
      {mutation.error ? <FoodText alert>{mutation.error}</FoodText> : null}
      <FoodStorageRecovery mutation={mutation} />
      {mutation.pending ? (
        <>
          <FoodText>這次送出內容已保留。返回後仍會使用同一次操作確認。</FoodText>
          {mutation.pending.kind === 'quote' && stage !== 'basket' ? (
            <FoodText
              status
            >{`這次取餐時間 ${formatPickupTime(mutation.pending.input.requestedPickupAt)}（台灣時間）`}</FoodText>
          ) : null}
          <FoodButton
            variant="primary"
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
          <FoodText
            status
          >{`預計取餐 ${formatPickupTime(quote.requestedPickupAt)}（台灣時間）`}</FoodText>
          <FoodText subdued>{`金額與庫存保留至 ${foodTime(quote.expiresAt)}`}</FoodText>
          <FoodText>送出後請到店付款。這個步驟不會線上扣款。</FoodText>
          {quote.state === 'expired' || Date.parse(quote.expiresAt) <= now ? (
            <FoodText alert>這次報價已過期，請返回調整取餐時間，再重新確認金額。</FoodText>
          ) : null}
          <FoodButton
            variant="primary"
            disabled={
              mutation.locked ||
              resource.loading ||
              !!resource.error ||
              Date.parse(quote.expiresAt) <= now ||
              quote.state !== 'active' ||
              !quote.allowedActions.includes('create-order')
            }
            onPress={() => {
              if (Date.parse(quote.expiresAt) <= Date.now()) {
                setNow(Date.now());
                return;
              }
              void mutation.send({
                kind: 'order',
                input: { quoteId: quote.id, idempotencyKey: key() },
              });
            }}
          >
            確認送出訂單，到店付款
          </FoodButton>
          <FoodButton
            disabled={mutation.locked}
            onPress={() => {
              setQuote(null);
              setNow(Date.now());
              setStage('basket');
            }}
          >
            返回修改餐點與取餐時間
          </FoodButton>
        </FoodCard>
      ) : resource.data ? (
        <>
          {stage !== 'customize' ? (
            <FoodButton
              variant={stage === 'basket' ? 'secondary' : 'primary'}
              disabled={locked || !selected.length}
              accessibilityLabel={
                selected.length ? `查看購物籃，已選 ${cartCount} 份` : '購物籃還是空的'
              }
              onPress={() => {
                setStage('basket');
                setError('');
              }}
            >
              {selected.length ? `查看購物籃（${cartCount} 份）` : '購物籃（尚無餐點）'}
            </FoodButton>
          ) : null}
          {locked && stage === 'menu'
            ? selected.map(([id, line]) => {
                const item = catalog.find((candidate) => candidate.id === id);
                if (!item) return null;
                return (
                  <FoodQuantityStepper
                    key={`locked-menu-${id}`}
                    label={`${item.name}數量`}
                    value={line.quantity}
                    disabled
                    onChange={() => undefined}
                  />
                );
              })
            : null}
          {stage === 'customize'
            ? renderCustomize()
            : stage === 'basket'
              ? renderBasket()
              : resource.data.sections.map((section) => (
                  <View key={section.id} style={{ gap: 14 }}>
                    <FoodText title>{section.name}</FoodText>
                    {section.items.map(renderBrowseItem)}
                  </View>
                ))}
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
  const [lastOrder, setLastOrder] = useState<NuniFoodCustomerOrderDetail | null>(null);
  useEffect(() => {
    if (resource.errorKind === 'unavailable') {
      setLastOrder(null);
      setShowOrderNumber(false);
    } else if (resource.data) setLastOrder(resource.data);
  }, [resource.data, resource.errorKind]);
  const order = resource.errorKind === 'unavailable' ? null : (resource.data ?? lastOrder);
  const current = !!resource.data && !resource.error && !resource.loading;
  const token = order?.pickup.credential;
  const canShowToken =
    current &&
    order?.state === 'ready' &&
    order.allowedActions.includes('show-pickup-credential') &&
    order.pickup.allowedActions.includes('present-one-time-token') &&
    token &&
    Date.parse(token.expiresAt) > now;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={page}>
      <FoodButton onPress={onBack}>返回訂單紀錄</FoodButton>
      <FoodText title>訂單進度</FoodText>
      {resource.loading ? <FoodText status>正在更新訂單…</FoodText> : null}
      {resource.error ? (
        <FoodText
          alert
        >{`${resource.error} 這次沒能更新狀態。${order ? '畫面保留上次讀到的資料。' : ''}請再試一次。`}</FoodText>
      ) : null}
      <FoodButton disabled={resource.loading} onPress={() => void resource.load()}>
        更新狀態
      </FoodButton>
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
          <FoodText>{`現在該做什麼：${
            !current
              ? '請先更新訂單，再確認付款或取餐'
              : foodCustomerNextStep({
                  ...order,
                  payment: order.paymentSession,
                  now,
                })
          }`}</FoodText>
          <FoodText>{`最後更新時間 ${foodTime(order.updatedAt)}（訂單資料時間）`}</FoodText>
          {!current ? <FoodText>目前顯示上次讀到的狀態，更新後再確認付款或取餐。</FoodText> : null}
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
          {current && order.allowedActions.includes('cancel') ? (
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
