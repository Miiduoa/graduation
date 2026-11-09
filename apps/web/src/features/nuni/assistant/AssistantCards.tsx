import Link from 'next/link';
import { formatEventWhen, formatPickup, formatYuan, inAppHref, pageLabel } from './copy';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { canConfirmAction, priorCalendarActionsVerified } from './execution';
import styles from './AssistantReply.module.css';
import type { V2ActionState, V2ActionStates, V2Card } from './types';

function Status({ value, card, pending, onReconcile }: {
  value: V2ActionState;
  card: V2Card;
  pending: boolean;
  onReconcile?: (card: V2Card) => void;
}) {
  if (value.status === 'handoff') {
    const href = inAppHref(value.href);
    return <div>
      <p className={styles.note}>{value.message}</p>
      {href && <Link className={styles.pageLink} href={href}>開啟確認的頁面</Link>}
    </div>;
  }
  if (value.status === 'verified') {
    const href = '/calendar?schoolId=' + encodeURIComponent(card.schoolId);
    return <div className={styles.receipt} aria-label="行程執行回執">
      <p className={`${styles.status} ${styles.statusOk}`}>已核對並加入個人行事曆</p>
      <p className={styles.note}>核對時間：{formatTaipeiDateTime(value.receipt.verifiedAt, { seconds: true })}（台灣時間）</p>
      {value.verificationWarning && <p className={styles.reason}>{value.verificationWarning}</p>}
      {value.local === 'ready'
        ? <Link className={styles.pageLink} href={href + '&eventId=' + encodeURIComponent(value.receipt.record.id)}>開啟這筆行程</Link>
        : <>
          <p className={styles.reason}>帳號中已儲存，此裝置尚未更新。{value.localMessage}</p>
          <Link className={styles.pageLink} href={href}>開啟個人行事曆</Link>
        </>}
      {onReconcile && <button type="button" className={styles.secondary} disabled={pending} onClick={() => onReconcile(card)}>
        {value.local === 'ready' ? '重新核對結果' : '重新核對並更新此裝置'}
      </button>}
    </div>;
  }
  const message = value.status === 'executing' ? '正在執行並核對…'
    : value.status === 'checking' ? '正在讀回核對，沒有重新送出…'
      : value.status === 'cancelled' ? '已撤銷未執行提議'
        : value.status === 'superseded' ? '已被新提議取代'
          : 'message' in value ? value.message : '正在核對執行狀態…';
  const canCheck = card.tool === 'propose_personal_event' &&
    ['unknown', 'absent', 'conflict'].includes(value.status);
  return <div>
    <p className={`${styles.status} ${styles.statusMuted}`}>{message}</p>
    {canCheck && onReconcile && <button type="button" className={styles.secondary} disabled={pending} onClick={() => onReconcile(card)}>重新核對結果</button>}
    {value.status === 'conflict' && <Link className={styles.pageLink} href={'/calendar?schoolId=' + encodeURIComponent(card.schoolId)}>開啟個人行事曆</Link>}
  </div>;
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
      <p className={styles.note}>確認後才會寫入帳號的個人行事曆，核對後顯示在此裝置。不會發送推播提醒。</p>
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
  onReconcile,
}: {
  card: V2Card;
  index: number;
  cards: V2Card[];
  states: V2ActionStates;
  pending: boolean;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
  onReconcile?: (card: V2Card) => void;
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
      {state && <Status value={state} card={card} pending={pending} onReconcile={onReconcile} />}
      {canConfirmAction(state) && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={
              pending ||
              !priorCalendarActionsVerified(cards, index, states)
            }
            onClick={() => onConfirm([card])}
          >
            {state ? '重試原確認' : '確認'}
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
  onReconcile,
  allowBatchConfirmation = true,
}: {
  cards: V2Card[];
  states: V2ActionStates;
  pending: boolean;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
  onReconcile?: (card: V2Card) => void;
  allowBatchConfirmation?: boolean;
}) {
  if (!cards.length) return null;
  const open = cards.filter((c) => canConfirmAction(states[c.mutationId]));
  const calendar = cards.filter((card) => card.tool === 'propose_personal_event');
  const verified = calendar.filter((card) => states[card.mutationId]?.status === 'verified').length;
  const uncertain = calendar.filter((card) => ['unknown', 'executing', 'checking'].includes(states[card.mutationId]?.status)).length;
  const retired = calendar.filter((card) => ['cancelled', 'superseded'].includes(states[card.mutationId]?.status)).length;
  return (
    <div className={styles.stack}>
      {calendar.length > 0 && <p className={styles.executionSummary} role="status" aria-label="行程執行進度">
        已核對 {verified}/{calendar.length} 項{uncertain ? ` · 待核對 ${uncertain} 項` : ''}{calendar.length - verified - uncertain - retired ? ` · 尚未完成 ${calendar.length - verified - uncertain - retired} 項` : ''}{retired ? ` · 已停止 ${retired} 項提議` : ''}
      </p>}
      {allowBatchConfirmation && open.length > 1 ? (
        <button type="button" className={styles.batch} disabled={pending || !priorCalendarActionsVerified(cards, cards.indexOf(open[0]), states)} onClick={() => onConfirm(open)}>
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
          onReconcile={onReconcile}
        />
      ))}
    </div>
  );
}
