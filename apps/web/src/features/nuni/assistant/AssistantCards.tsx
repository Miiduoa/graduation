import Link from 'next/link';
import { formatEventWhen, formatPickup, formatYuan, inAppHref, pageLabel } from './copy';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { canConfirmAction, priorCalendarActionsVerified } from './execution';
import styles from './AssistantReply.module.css';
import type { V2ActionState, V2ActionStates, V2Card } from './types';

// Unknown tool names cannot be reviewed as a generic page action.
// The server independently verifies signed tokens and current authorization.
function supportedCard(card: V2Card): boolean {
  return card.tool === 'propose_personal_event' ||
    card.tool === 'propose_open_page' || card.tool === 'propose_food_order';
}

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
  const pageOnly = card.args.mode !== 'order';
  return (
    <>
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>{pageOnly ? '點餐頁面' : '訂單確認'}</p>
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
      <p className={styles.note}>
        {pageOnly
          ? '這份內容只會帶到點餐頁，沒有送出訂單或付款。'
          : '按下確認可能直接送出訂單。請先核對品項、金額與取餐時間；付款狀態以店家實際紀錄為準。'}
      </p>
      {pageOnly && href ? (
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
  if (!supportedCard(card)) {
    return <article className={styles.card} aria-label="無法確認的任務">
      <p className={styles.eyebrow}>無法確認</p>
      <p className={styles.note}>這種操作尚未支援。沒有送出任何交易，請重新提問。</p>
    </article>;
  }
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
}: {
  cards: V2Card[];
  states: V2ActionStates;
  pending: boolean;
  onConfirm: (cards: V2Card[]) => void;
  onCancel: (index: number) => void;
  onReconcile?: (card: V2Card) => void;
}) {
  if (!cards.length) return null;
  const open = cards.filter((c) => supportedCard(c) && canConfirmAction(states[c.mutationId]));
  const calendarOnly = cards.every((card) => card.tool === 'propose_personal_event');
  const calendar = cards.filter((card) => card.tool === 'propose_personal_event');
  const verified = calendar.filter((card) => states[card.mutationId]?.status === 'verified').length;
  const uncertain = calendar.filter((card) => ['unknown', 'executing', 'checking'].includes(states[card.mutationId]?.status)).length;
  const retired = calendar.filter((card) => ['cancelled', 'superseded'].includes(states[card.mutationId]?.status)).length;
  return (
    <div className={styles.stack}>
      {calendar.length > 0 && <p className={styles.executionSummary} role="status" aria-label="行程執行進度">
        已核對 {verified}/{calendar.length} 項{uncertain ? ` · 待核對 ${uncertain} 項` : ''}{calendar.length - verified - uncertain - retired ? ` · 尚未完成 ${calendar.length - verified - uncertain - retired} 項` : ''}{retired ? ` · 已停止 ${retired} 項提議` : ''}
      </p>}
      {calendarOnly && open.length > 1 ? (
        <button type="button" className={styles.batch} disabled={pending || !priorCalendarActionsVerified(cards, cards.indexOf(open[0]), states)} onClick={() => onConfirm(open)}>
          依序確認 {open.length} 筆個人行程
        </button>
      ) : null}
      {cards.length > 1 ? (
        <p className={styles.hint}>{calendarOnly
          ? '個人行程會逐筆建立並讀回核對；若其中一筆結果不明，後續安排會停止。'
          : '這次包含不同類型的操作，請逐筆核對。開啟頁面不等於完成交易，點餐也不會和行程一起批次確認。'}</p>
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
