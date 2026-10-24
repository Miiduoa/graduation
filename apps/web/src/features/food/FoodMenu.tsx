'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  NUNI_FOOD_LIMITS,
  type NuniFoodMenuItem,
  type NuniFoodQuoteProjection,
  type NuniFoodOrderCommandResult,
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
type CartLine = { quantity: number; options: string[]; note: string };
type Cart = Record<string, CartLine>;
const emptyLine: CartLine = { quantity: 0, options: [], note: '' };

function hasStaleOptions(item: NuniFoodMenuItem, line: CartLine) {
  const options = item.optionGroups.flatMap((group) => group.options);
  return line.options.some((id) => !options.some((option) => option.id === id && option.available));
}

function needsOptions(item: NuniFoodMenuItem, line: CartLine) {
  return item.optionGroups.some((group) => {
    const chosen = group.options.filter((option) => line.options.includes(option.id));
    return (
      chosen.length < group.minimumSelections ||
      chosen.length > group.maximumSelections ||
      chosen.some((option) => !option.available)
    );
  });
}

function lineEstimate(item: NuniFoodMenuItem, line: CartLine) {
  const extras = item.optionGroups
    .flatMap((group) => group.options)
    .filter((option) => line.options.includes(option.id))
    .reduce((total, option) => total + option.priceDelta.amountMinor, 0);
  return (item.basePrice.amountMinor + extras) * line.quantity;
}

export function FoodMenu({
  client,
  cache,
  accountId,
  tenantId,
  locationId,
  onBack,
  onOrder,
}: {
  client: FoodClient;
  cache: FoodDraftCache;
  accountId: string;
  tenantId: string;
  locationId: string;
  onBack(): void;
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
  const sectionPrefix = useId();
  const confirmationRef = useRef<HTMLElement>(null);
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
  const selected = items.filter((item) => (cart[item.id]?.quantity ?? 0) > 0);
  const selectedCount = selected.reduce((total, item) => total + cart[item.id].quantity, 0);
  const estimatedTotal = selected.reduce(
    (total, item) => total + lineEstimate(item, cart[item.id]),
    0,
  );
  const missingItems =
    menu.data &&
    Object.entries(cart).some(
      ([id, line]) => line.quantity > 0 && !items.some((item) => item.id === id),
    );

  useEffect(() => {
    if (quote) confirmationRef.current?.focus();
  }, [quote]);

  function update(id: string, next: Partial<CartLine>) {
    if (locked) return;
    setCart((value) => ({ ...value, [id]: { ...(value[id] ?? emptyLine), ...next } }));
    setQuote(null);
    setConfirmed(false);
    setValidation('');
  }

  function updateQuantity(item: NuniFoodMenuItem, quantity: number) {
    if (locked) return;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > NUNI_FOOD_LIMITS.maxQuantityPerLine
    ) {
      setValidation(`${item.name}的數量需為 0–${NUNI_FOOD_LIMITS.maxQuantityPerLine} 之間的整數。`);
      setQuote(null);
      setConfirmed(false);
      return;
    }
    if (
      quantity > 0 &&
      !(cart[item.id]?.quantity > 0) &&
      selected.length >= NUNI_FOOD_LIMITS.maxQuoteLines
    ) {
      setValidation(`每筆訂單最多選擇 ${NUNI_FOOD_LIMITS.maxQuoteLines} 種餐點。`);
      return;
    }
    update(item.id, { quantity });
  }

  function requestQuote(requestedAt: number) {
    if (locked || menu.data?.location.merchantMode !== 'full') return;
    if (
      Object.values(cart).some(
        (line) =>
          !Number.isSafeInteger(line.quantity) ||
          line.quantity < 0 ||
          line.quantity > NUNI_FOOD_LIMITS.maxQuantityPerLine,
      )
    ) {
      setValidation(`餐點數量需為 0–${NUNI_FOOD_LIMITS.maxQuantityPerLine} 之間的整數。`);
      return;
    }
    if (missingItems) {
      setValidation('菜單已有變動，請清除已選餐點後重新選擇。');
      return;
    }
    if (selected.length > NUNI_FOOD_LIMITS.maxQuoteLines) {
      setValidation(`每筆訂單最多選擇 ${NUNI_FOOD_LIMITS.maxQuoteLines} 種餐點。`);
      return;
    }
    if (selected.some((item) => hasStaleOptions(item, cart[item.id]))) {
      setValidation('餐點選項已有更新，請重新選擇口味後再確認。');
      return;
    }
    if (
      !selected.length ||
      selected.some(
        (item) =>
          !item.available ||
          !item.allowedActions.includes('add-to-quote') ||
          needsOptions(item, cart[item.id]),
      )
    ) {
      setValidation('請選擇餐點，並完成各餐點的必選項目。');
      return;
    }
    const time = new Date(`${pickup}:00+08:00`);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= requestedAt) {
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
    <section className={styles.stack} aria-label="點餐菜單">
      <div className={styles.menuHeader}>
        <Button variant="ghost" disabled={task.busy} onClick={onBack}>
          返回店家列表
        </Button>
        <div className={styles.bar}>
          <div>
            <p className={styles.eyebrow}>選餐與取餐</p>
            <h2>{menu.data?.location.name ?? '菜單'}</h2>
            {menu.data?.location.zoneLabel && (
              <p className={styles.muted}>{menu.data.location.zoneLabel}</p>
            )}
          </div>
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
      </div>
      {menu.loading && <p role="status">正在讀取菜單…</p>}
      {menu.error && <p role="alert">{menu.error}</p>}
      <FoodMutationStatus task={task} />
      {validation && (
        <p role="alert" className={styles.validation}>
          {validation}
        </p>
      )}
      {menu.data && selectedCount > 0 && (
        <a href={`#${sectionPrefix}-cart`} className={styles.mobileCartShortcut}>
          <span>已選 {selectedCount} 份</span>
          <strong>查看已選餐點</strong>
        </a>
      )}
      {menu.data && (
        <div className={styles.menuLayout}>
          <div className={styles.menuBody}>
            {menu.data.sections.length > 1 && (
              <nav className={styles.sectionNav} aria-label="菜單分類">
                {menu.data.sections.map((section) => (
                  <a href={`#${sectionPrefix}-${section.id}`} key={section.id}>
                    {section.name}
                  </a>
                ))}
              </nav>
            )}
            {menu.data.sections.map((section) => (
              <section
                id={`${sectionPrefix}-${section.id}`}
                className={styles.menuSection}
                key={section.id}
              >
                <h3>{section.name}</h3>
                {section.items.map((item) => {
                  const line = cart[item.id] ?? emptyLine;
                  const staleOptions = hasStaleOptions(item, line);
                  const knownOptionIds = new Set(
                    item.optionGroups.flatMap((group) => group.options.map((option) => option.id)),
                  );
                  const unavailable =
                    locked ||
                    !item.available ||
                    !item.allowedActions.includes('add-to-quote') ||
                    menu.data!.location.merchantMode !== 'full';
                  return (
                    <article
                      key={item.id}
                      className={styles.menuItem}
                      data-selected={line.quantity > 0 || undefined}
                    >
                      <div className={styles.itemHeading}>
                        <div>
                          <h4>{item.name}</h4>
                          {item.description && <p className={styles.muted}>{item.description}</p>}
                        </div>
                        <strong className={styles.itemPrice}>{foodMoney(item.basePrice)}</strong>
                      </div>
                      <div className={styles.itemTools}>
                        <div
                          className={styles.quantity}
                          role="group"
                          aria-label={`${item.name} 份數`}
                        >
                          <Button
                            aria-label={`減少${item.name}`}
                            style={{ width: 44, padding: 0, fontSize: 20 }}
                            disabled={locked || line.quantity <= 0}
                            onClick={() => updateQuantity(item, line.quantity - 1)}
                          >
                            −
                          </Button>
                          <Input
                            aria-label={`${item.name} 數量`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={NUNI_FOOD_LIMITS.maxQuantityPerLine}
                            step={1}
                            value={line.quantity}
                            disabled={unavailable}
                            onChange={(event) => updateQuantity(item, Number(event.target.value))}
                          />
                          <Button
                            aria-label={`增加${item.name}`}
                            style={{ width: 44, padding: 0, fontSize: 20 }}
                            disabled={
                              unavailable || line.quantity >= NUNI_FOOD_LIMITS.maxQuantityPerLine
                            }
                            onClick={() => updateQuantity(item, line.quantity + 1)}
                          >
                            ＋
                          </Button>
                        </div>
                        {!item.available ? (
                          <span className={styles.muted}>暫停供應</span>
                        ) : item.optionGroups.some((group) => group.minimumSelections > 0) &&
                          line.quantity === 0 ? (
                          <span className={styles.muted}>選擇份數後設定口味</span>
                        ) : null}
                      </div>
                      {line.quantity > 0 && (
                        <div className={styles.itemCustomization}>
                          {staleOptions && (
                            <div role="alert">
                              <p>部分口味已變更或暫停供應，請重新選擇。</p>
                              <Button
                                variant="ghost"
                                disabled={locked}
                                aria-label={`重設${item.name}選項`}
                                onClick={() => update(item.id, { options: [] })}
                              >
                                重選口味
                              </Button>
                            </div>
                          )}
                          {item.optionGroups.map((group) => (
                            <fieldset
                              className={styles.options}
                              disabled={unavailable}
                              key={group.id}
                            >
                              <legend>
                                {group.name}（至少 {group.minimumSelections}，最多{' '}
                                {group.maximumSelections} 項）
                              </legend>
                              {group.options.map((option) => (
                                <label className={styles.check} key={option.id}>
                                  <input
                                    type={
                                      group.minimumSelections === 1 && group.maximumSelections === 1
                                        ? 'radio'
                                        : 'checkbox'
                                    }
                                    name={`${sectionPrefix}-${item.id}-${group.id}`}
                                    checked={line.options.includes(option.id)}
                                    disabled={
                                      (!option.available && !line.options.includes(option.id)) ||
                                      (group.maximumSelections !== 1 &&
                                        !line.options.includes(option.id) &&
                                        group.options.filter((value) =>
                                          line.options.includes(value.id),
                                        ).length >= group.maximumSelections)
                                    }
                                    onChange={(event) =>
                                      update(item.id, {
                                        options: event.target.checked
                                          ? [
                                              ...line.options.filter(
                                                (id) =>
                                                  knownOptionIds.has(id) &&
                                                  (group.maximumSelections !== 1 ||
                                                    !group.options.some(
                                                      (value) => value.id === id,
                                                    )),
                                              ),
                                              option.id,
                                            ]
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
                          <details className={styles.itemDetails}>
                            <summary>餐點備註{line.note ? '（已填寫）' : '（選填）'}</summary>
                            <Input
                              label={`${item.name} 餐點備註`}
                              maxLength={300}
                              value={line.note}
                              disabled={unavailable}
                              onChange={(event) => update(item.id, { note: event.target.value })}
                            />
                          </details>
                        </div>
                      )}
                      <details className={styles.itemDetails}>
                        <summary>過敏原與營養資訊</summary>
                        <p>
                          過敏原：
                          {item.allergenTags.length
                            ? item.allergenTags.join('、')
                            : '店家未提供，請先向店家確認'}
                        </p>
                        {item.nutrition.declared && (
                          <p>每份熱量：{item.nutrition.caloriesKcal} 大卡</p>
                        )}
                      </details>
                    </article>
                  );
                })}
              </section>
            ))}
            {!items.length && <p className={styles.panel}>店家目前沒有可顯示的菜單。</p>}
          </div>
          <aside id={`${sectionPrefix}-cart`} className={styles.cart} aria-label="已選餐點">
            <div className={styles.bar}>
              <h3>
                已選餐點{' '}
                <span className={styles.cartCount} aria-live="polite">
                  {selectedCount} 份
                </span>
              </h3>
              {(selected.length > 0 || missingItems) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={() => {
                    setCart({});
                    setQuote(null);
                    setConfirmed(false);
                    setValidation('');
                  }}
                >
                  清除已選餐點
                </Button>
              )}
            </div>
            {selected.length ? (
              <ul className={styles.cartLines}>
                {selected.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.name} × {cart[item.id].quantity}
                      </strong>
                      {hasStaleOptions(item, cart[item.id]) ? (
                        <span className={styles.muted}>請重新選擇口味</span>
                      ) : (
                        needsOptions(item, cart[item.id]) && (
                          <span className={styles.muted}>尚有必選項目</span>
                        )
                      )}
                      {!item.available && (
                        <span className={styles.muted}>暫停供應，請調整餐點</span>
                      )}
                    </div>
                    <span>
                      {foodMoney({
                        amountMinor: lineEstimate(item, cart[item.id]),
                        currency: 'TWD',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>點選餐點旁的「＋」，開始選餐。</p>
            )}
            {missingItems && <p role="alert">部分餐點已從菜單移除，請清除後重新選擇。</p>}
            {selected.length > 0 && (
              <div className={styles.cartTotal}>
                <span>餐點試算</span>
                <strong>{foodMoney({ amountMinor: estimatedTotal, currency: 'TWD' })}</strong>
              </div>
            )}
            <p className={styles.cartHint}>實際金額與供應狀態會在下一步確認。</p>
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
            <Button
              variant="primary"
              fullWidth
              disabled={locked || !selected.length}
              onClick={() => requestQuote(Date.now())}
            >
              計算金額與確認庫存
            </Button>
          </aside>
        </div>
      )}
      {quote && (
        <section
          ref={confirmationRef}
          tabIndex={-1}
          className={`${styles.panel} ${styles.confirmation}`}
          aria-label="送出前確認"
        >
          <p className={styles.eyebrow}>最後確認</p>
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
          <p className={styles.muted}>送出訂單不代表完成付款，請依訂單顯示的方式付款。</p>
        </section>
      )}
    </section>
  );
}
