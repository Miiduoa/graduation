import Link from 'next/link';
import { formatEventWhen, formatPickup, formatYuan, inAppHref, pageLabel } from './copy';
import styles from './AssistantReply.module.css';
import type { V2Card } from './types';

function Status({ value }: { value: string }) {
  const href = inAppHref(value);
  if (href)
    return (
      <Link className={styles.pageLink} href={href}>
        開啟確認的頁面
      </Link>
    );
  const ok = value === '已加入個人行事曆' || value === '已送出訂單';
  return <p className={`${styles.status} ${ok ? styles.statusOk : styles.statusMuted}`}>{value}</p>;
}

function EventBody({ args }: { args: Record<string, unknown> }) {
  const title = typeof args.title === 'string' ? args.title : '行程';
  const when = formatEventWhen(args);
  return (
    <>
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>行程確認</p>
        <h3>{title}</h3>
      </div>
      {when ? <p className={styles.when}>{when}</p> : null}
      <p className={styles.note}>確認後才會寫入個人行事曆，不會發送推播提醒。</p>
    </>
  );
}

function FoodBody({ card }: { card: V2Card }) {
  const summary =
    card.args.summary && typeof card.args.summary === 'object' && !Array.isArray(card.args.summary)
      ? (card.args.summary as Record<string, unknown>)
      : {};
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  const store = typeof summary.store === 'string' ? summary.store : '點餐';
  const reason = typeof card.args.reason === 'string' ? card.args.reason : card.destination;
  const href = typeof card.args.href === 'string' ? inAppHref(card.args.href) : null;
  const total = formatYuan(summary.totalMinor);
  const pickup = formatPickup(summary.requestedPickupAt);
  return (
    <>
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>點餐</p>
        <h3>{store}</h3>
      </div>
      <ul className={styles.lines}>
        {lines.map((raw, i) => {
          const line =
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : {};
          const options = Array.isArray(line.options) ? line.options.map(String).filter(Boolean) : [];
          return (
            <li key={i}>
              <span>
                {String(line.name || '品項')} × {String(line.quantity || 1)}
                {options.length ? <small>{options.join('、')}</small> : null}
              </span>
              <span className={styles.price}>{formatYuan(line.unitMinor)}</span>
            </li>
          );
        })}
      </ul>
      {total ? <p className={styles.total}>合計 {total}</p> : null}
      {pickup ? <p className={styles.pickup}>取餐 {pickup}</p> : null}
      {reason ? <p className={styles.reason}>{reason}</p> : null}
      {href ? (
        <Link className={styles.pageLink} href={href}>
          前往點餐頁
        </Link>
      ) : null}
    </>
  );
}

function PageBody({ card }: { card: V2Card }) {
  const href = typeof card.destination === 'string' ? card.destination : '';
  const page = typeof card.args.page === 'string' ? card.args.page : pageLabel(href);
  return (
    <>
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>開啟頁面</p>
        <h3>{pageLabel('/' + String(page).replace(/^\//, ''))}</h3>
      </div>
      <p className={styles.note}>確認後才會前往，尚未開啟任何頁面。</p>
    </>
  );
}

export function AssistantCard({
  card,
  index,
  cards,
  states,
  pending,
  onConfirm,
  onCancel,
}: {
  card: V2Card;
  index: number;
  cards: V2Card[];
  states: Record<string, string>;
  pending: boolean;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
}) {
  const state = states[card.mutationId];
  return (
    <article
      className={styles.card}
      aria-label={
        card.tool === 'propose_food_order'
          ? '點餐確認卡'
          : card.tool === 'propose_personal_event'
            ? '行程確認卡'
            : '頁面確認卡'
      }
    >
      {card.tool === 'propose_food_order' ? (
        <FoodBody card={card} />
      ) : card.tool === 'propose_personal_event' ? (
        <EventBody args={card.args} />
      ) : (
        <PageBody card={card} />
      )}
      {state ? (
        <Status value={state} />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={
              pending ||
              cards
                .slice(0, index)
                .some(
                  (c) =>
                    states[c.mutationId] !== '已加入個人行事曆' &&
                    c.tool === 'propose_personal_event',
                )
            }
            onClick={() => onConfirm([card])}
          >
            確認
          </button>
          <button type="button" className={styles.secondary} disabled={pending} onClick={() => onCancel(index)}>
            取消
          </button>
        </div>
      )}
    </article>
  );
}

export function AssistantCardStack({
  cards,
  states,
  pending,
  onConfirm,
  onCancel,
}: {
  cards: V2Card[];
  states: Record<string, string>;
  pending: boolean;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
}) {
  if (!cards.length) return null;
  const open = cards.filter((c) => !states[c.mutationId]);
  return (
    <div className={styles.stack}>
      {open.length > 1 ? (
        <button type="button" className={styles.batch} disabled={pending} onClick={() => onConfirm(open)}>
          依序全部確認
        </button>
      ) : null}
      {cards.length > 1 ? (
        <p className={styles.hint}>讀書安排請依序確認；取消後若要更改順序，請重新規劃。</p>
      ) : null}
      {cards.map((card, index) => (
        <AssistantCard
          key={card.mutationId}
          card={card}
          index={index}
          cards={cards}
          states={states}
          pending={pending}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}
