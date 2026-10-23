'use client';

import { useCallback, useState } from 'react';
import type {
  NuniFoodQuoteProjection,
  NuniFoodOrderCommandResult,
} from '@campus/shared/src/nuniFood';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { FoodClient } from './FoodWorkspace';
import {
  FoodMutationStatus,
  foodKey,
  foodMoney,
  foodTime,
  useFoodDraft,
  useFoodClock,
  useFoodMutation,
  useFoodRead,
  type FoodDraftCache,
} from './foodState';
import styles from './Food.module.css';

const taipeiInput = (time: number) => new Date(time + 8 * 3600_000).toISOString().slice(0, 16);
type Cart = Record<string, { quantity: number; options: string[]; note: string }>;
export function FoodMenu({
  client,
  cache,
  accountId,
  tenantId,
  locationId,
  onOrder,
}: {
  client: FoodClient;
  cache: FoodDraftCache;
  accountId: string;
  tenantId: string;
  locationId: string;
  onOrder(orderId: string): void;
}) {
  const scope = `food:cart:${tenantId}:${locationId}`;
  const [cart, setCart] = useFoodDraft<Cart>(cache, scope, {});
  const [pickup, setPickup] = useFoodDraft(cache, `${scope}:time`, () =>
    taipeiInput(Date.now() + 30 * 60_000),
  );
  const [quote, setQuote] = useFoodDraft<NuniFoodQuoteProjection | null>(
    cache,
    `${scope}:quote`,
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const now = useFoodClock();
  const [validation, setValidation] = useState('');
  const load = useCallback(
    () => client.getMenu(tenantId, locationId),
    [client, tenantId, locationId],
  );
  const menu = useFoodRead(load);
  const task = useFoodMutation({
    cache,
    scope,
    accountId,
    enabled: !!menu.data,
    reload: menu.reload,
    onRejected: () => {
      setQuote(null);
      setConfirmed(false);
    },
    execute: (intent) =>
      intent.action === 'quote'
        ? client.createQuote(tenantId, intent.input)
        : client.createOrder(tenantId, intent.input),
    onSuccess(result, intent) {
      if (intent.action === 'quote') {
        setQuote(result as NuniFoodQuoteProjection);
        setConfirmed(false);
      } else {
        setQuote(null);
        setCart({});
        onOrder((result as NuniFoodOrderCommandResult).orderId);
      }
    },
  });
  const locked = !menu.data || task.busy || !!task.pending || task.storageBlocked;
  const items = menu.data?.sections.flatMap((section) => section.items) ?? [];
  function update(id: string, next: Partial<Cart[string]>) {
    if (locked) return;
    setCart((value) => ({
      ...value,
      [id]: { ...(value[id] ?? { quantity: 0, options: [], note: '' }), ...next },
    }));
    setQuote(null);
    setConfirmed(false);
    setValidation('');
  }
  function requestQuote() {
    if (locked || menu.data?.location.merchantMode !== 'full') return;
    const selected = items.filter((item) => (cart[item.id]?.quantity ?? 0) > 0);
    if (
      !selected.length ||
      selected.some(
        (item) =>
          !item.available ||
          !item.allowedActions.includes('add-to-quote') ||
          item.optionGroups.some((group) => {
            const chosen = group.options.filter((option) =>
              cart[item.id].options.includes(option.id),
            );
            return (
              chosen.length < group.minimumSelections ||
              chosen.length > group.maximumSelections ||
              chosen.some((option) => !option.available)
            );
          }),
      )
    ) {
      setValidation('請選擇餐點，並完成各餐點的必選項目。');
      return;
    }
    const time = new Date(`${pickup}:00+08:00`);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now()) {
      setValidation('請選擇尚未過去的取餐時間。');
      return;
    }
    setValidation('');
    setConfirmed(false);
    void task.send({
      action: 'quote',
      input: {
        locationId,
        requestedPickupAt: time.toISOString(),
        items: selected.map((item) => ({
          menuItemId: item.id,
          quantity: cart[item.id].quantity,
          selectedOptionIds: cart[item.id].options,
          ...(cart[item.id].note.trim() ? { customerNote: cart[item.id].note.trim() } : {}),
        })),
        idempotencyKey: foodKey(),
      },
    });
  }
  return (
    <section className={styles.panel} aria-label="點餐菜單">
      <div className={styles.bar}>
        <h2>{menu.data?.location.name ?? '菜單'}</h2>
        <Button
          disabled={task.busy || !!task.pending || menu.loading}
          onClick={() => {
            setQuote(null);
            setConfirmed(false);
            void menu.reload();
          }}
        >
          更新菜單
        </Button>
      </div>
      {menu.loading && <p role="status">正在讀取菜單…</p>}
      {menu.error && <p role="alert">{menu.error}</p>}
      <FoodMutationStatus task={task} />
      {validation && <p role="alert">{validation}</p>}
      {menu.data && (
        <div className={styles.stack}>
          {menu.data.sections.map((section) => (
            <section key={section.id}>
              <h3>{section.name}</h3>
              {section.items.map((item) => {
                const line = cart[item.id] ?? { quantity: 0, options: [], note: '' };
                const unavailable =
                  locked ||
                  !item.available ||
                  !item.allowedActions.includes('add-to-quote') ||
                  menu.data!.location.merchantMode !== 'full';
                return (
                  <div key={item.id} className={styles.row}>
                    <h4>
                      {item.name} · {foodMoney(item.basePrice)}
                    </h4>
                    <p>{item.description}</p>
                    <p>
                      過敏原：
                      {item.allergenTags.length
                        ? item.allergenTags.join('、')
                        : '店家未提供，請先向店家確認'}
                    </p>
                    {item.nutrition.declared && <p>每份熱量：{item.nutrition.caloriesKcal} 大卡</p>}
                    <Input
                      label={`${item.name} 數量`}
                      type="number"
                      min={0}
                      max={20}
                      step={1}
                      value={line.quantity}
                      disabled={unavailable}
                      onChange={(event) =>
                        update(item.id, { quantity: Number(event.target.value) })
                      }
                    />
                    {item.optionGroups.map((group) => (
                      <fieldset className={styles.options} disabled={unavailable} key={group.id}>
                        <legend>
                          {group.name}（至少 {group.minimumSelections}，最多{' '}
                          {group.maximumSelections} 項）
                        </legend>
                        {group.options.map((option) => (
                          <label className={styles.check} key={option.id}>
                            <input
                              type="checkbox"
                              checked={line.options.includes(option.id)}
                              disabled={
                                !option.available ||
                                (!line.options.includes(option.id) &&
                                  group.options.filter((value) => line.options.includes(value.id))
                                    .length >= group.maximumSelections)
                              }
                              onChange={(event) =>
                                update(item.id, {
                                  options: event.target.checked
                                    ? [...line.options, option.id]
                                    : line.options.filter((id) => id !== option.id),
                                })
                              }
                            />
                            {option.name}（+{foodMoney(option.priceDelta)}）
                            {!option.available && '，暫停供應'}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    <Input
                      label={`${item.name} 餐點備註`}
                      maxLength={300}
                      value={line.note}
                      disabled={unavailable}
                      onChange={(event) => update(item.id, { note: event.target.value })}
                    />
                    {!item.available && <p>暫停供應</p>}
                  </div>
                );
              })}
            </section>
          ))}
          {!items.length && <p>店家目前沒有可顯示的菜單。</p>}
          <Input
            label="預計取餐時間（台灣時間）"
            type="datetime-local"
            value={pickup}
            disabled={locked}
            onChange={(event) => {
              setPickup(event.target.value);
              setQuote(null);
              setConfirmed(false);
            }}
          />
          <Button disabled={locked || !items.length} onClick={requestQuote}>
            計算金額與確認庫存
          </Button>
        </div>
      )}
      {quote && (
        <section className={styles.row} aria-label="送出前確認">
          <h3>確認這份餐點</h3>
          {quote.lines.map((line, index) => (
            <p key={index}>
              {[
                `${line.nameSnapshot} × ${line.quantity}`,
                line.selectedOptions.map((item) => item.nameSnapshot).join('、'),
                foodMoney(line.lineTotal),
                line.customerNote,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ))}
          <p>餐點小計 {foodMoney(quote.subtotal)}</p>
          {quote.fees.map((fee) => (
            <p key={fee.code}>
              {fee.label} {foodMoney(fee.amount)}
            </p>
          ))}
          <p className={styles.amount}>應付 {foodMoney(quote.total)}</p>
          <p>
            取餐：{foodTime(quote.requestedPickupAt)} · 請在 {foodTime(quote.expiresAt)} 前確認
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我已確認餐點、取餐時間與應付金額
          </label>
          <Button
            variant="primary"
            disabled={
              locked ||
              !confirmed ||
              !quote.allowedActions.includes('create-order') ||
              Date.parse(quote.expiresAt) <= now
            }
            onClick={() => {
              if (
                locked ||
                !confirmed ||
                !quote.allowedActions.includes('create-order') ||
                Date.parse(quote.expiresAt) <= Date.now()
              ) {
                setValidation('金額或保留時間已過期，請重新計算。');
                return;
              }
              void task.send({
                action: 'order',
                input: { quoteId: quote.id, idempotencyKey: foodKey() },
              });
            }}
          >
            確認送出訂單
          </Button>
          <p>送出訂單不代表完成付款，請依訂單顯示的方式付款。</p>
        </section>
      )}
    </section>
  );
}
