import type { AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { parseAssistantCalendarIntent } from './assistantCalendarIntent';

export type AssistantCalendarBatchIntent =
  | { kind: 'draft'; events: AssistantCalendarEvent[] }
  | { kind: 'invalid'; message: string };

const INVALID = '請用「幫我安排以下行程：」開頭，列出 2–4 筆各有日期、起訖時間與名稱的行程，並用換行或分號分隔；時段不可重複或重疊，提醒、提交與付款請分開提出。';
const MAX_QUESTION_LENGTH = 1200;
const opening = '(?:(?:請|麻煩)(?:你)? *)?(?:(?:幫我|替我|我想) *)?(?:安排|新增|建立) *(?:以下|下列) *(?:個人 *)?行程';
const batchOpening = new RegExp(`^${opening}`, 'u');
const batchHeader = new RegExp(`^${opening} *: *`, 'u');
const controls = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const unsafeAction = /通知|提醒|推播|鬧鐘|送出|提交|繳交|上傳|交作業|寄出|寄信|傳訊|發訊|付款|支付|繳費|扣款|轉帳|匯款|下單|訂購|訂餐|購買|刪除|取消|邀請|並且|然後|順便|同時|以及|另外|接著|還要|再幫我|也幫我|不用|不要|不需要|\b(?:notify|remind|submit|send|pay|purchase|buy|delete|cancel|invite|email|message)\b|\b(?:and then|then also|place an? order|order food)\b/iu;
const url = /[a-z][a-z\d+.-]*:\/\/|(?:https?|javascript|data|mailto)\s*:|www\.|(?:^|\s)\/\/|\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:com|net|org|edu|gov|io|tw|app|dev)(?=$|[^a-z\d-])/iu;

const invalid = (): AssistantCalendarBatchIntent => ({ kind: 'invalid', message: INVALID });

/** Explicit commands only. Every row is reviewed together; no planner prose or partial result is executable. */
export function parseAssistantCalendarBatchIntent(question: unknown, now = Date.now()): AssistantCalendarBatchIntent | null {
  if (typeof question !== 'string') return null;
  // Removing invisible characters is only for recognizing a malformed batch,
  // never for accepting one. The actual input below must pass the strict gate.
  const probe = question.slice(0, 256).normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trimStart();
  if (!batchOpening.test(probe)) return null;
  if (question.length > MAX_QUESTION_LENGTH || !Number.isFinite(now) ||
      controls.test(question.replace(/\r\n|\n/g, ''))) return invalid();

  const text = question.normalize('NFKC').replace(/\r\n/g, '\n').trim();
  const header = batchHeader.exec(text);
  if (!header || url.test(text) || unsafeAction.test(text) || /[「」『』“”‘’"`]/u.test(text)) return invalid();
  // A semicolon followed by a line break is a single list separator. Empty
  // interior rows still fail; a closing semicolon is harmless punctuation.
  const body = text.slice(header[0].length).trim().replace(/;$/, '').trim();
  const rows = body.replace(/; *\n/g, ';').split(/[;\n]/u).map((row) => row.trim());
  if (rows.length < 2 || rows.length > 4 || rows.some((row) => !row)) return invalid();

  const events: AssistantCalendarEvent[] = [];
  const identities = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const row of rows) {
    const parsed = parseAssistantCalendarIntent(row, now) ?? parseAssistantCalendarIntent(`安排 ${row}`, now);
    if (parsed?.kind !== 'draft' || parsed.event.allDay || !parsed.event.startTime || !parsed.event.endTime) return invalid();
    const event = parsed.event;
    const identity = JSON.stringify(event);
    const start = Date.parse(`${event.date}T${event.startTime}:00+08:00`);
    const end = Date.parse(`${event.endDate || event.date}T${event.endTime}:00+08:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || identities.has(identity) ||
        ranges.some((range) => start < range.end && range.start < end)) return invalid();
    identities.add(identity);
    ranges.push({ start, end });
    events.push(event);
  }
  return { kind: 'draft', events };
}
