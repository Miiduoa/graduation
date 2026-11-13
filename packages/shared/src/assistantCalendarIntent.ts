import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from './assistantExecution';
import { taipeiParts } from './taipeiTime';

export type AssistantCalendarIntent =
  | { kind: 'draft'; event: AssistantCalendarEvent }
  | { kind: 'invalid'; message: string };

const datePattern = '(今天|明天|後天|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})';
const timePattern = '(\\d{1,2}:\\d{2})\\s*(?:到|至|[-~～–—])\\s*(\\d{1,2}:\\d{2})';
const prefix = '(?:(?:請|麻煩)(?:你)?\\s*)?(?:(?:幫我|替我|我想)\\s*)?';
const verb = '(?:安排|(?:新增|建立)(?:一(?:筆|個))?(?:個人)?行程|(?:加入|排入)(?:我的|個人)?行事曆)';
const dateFirst = new RegExp(`^${prefix}${datePattern}\\s*${timePattern}\\s*${verb}\\s*(.+)$`, 'u');
const verbFirst = new RegExp(`^${prefix}${verb}\\s*${datePattern}\\s*${timePattern}\\s*(?:的\\s*)?(.+)$`, 'u');

function explicitDate(value: string, now: number): string {
  const relative = ['今天', '明天', '後天'].indexOf(value);
  if (relative >= 0) {
    const parts = taipeiParts(now);
    if (!parts) return '';
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + relative)).toISOString().slice(0, 10);
  }
  return value.split(/[-/]/).map((part, index) => index ? part.padStart(2, '0') : part).join('-');
}

/** A single explicit appointment, never an inferred deadline or a general study plan. */
export function parseAssistantCalendarIntent(question: unknown, now = Date.now()): AssistantCalendarIntent | null {
  if (typeof question !== 'string' || question.length > 240 || !Number.isFinite(now) ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[。.!！]+$/u, '').trim();
  const match = dateFirst.exec(text) ?? verbFirst.exec(text);
  if (!match) return null;
  const [, rawDate, rawStart, rawEnd, rawTitle] = match;
  const title = rawTitle.trim();
  // A compound instruction must stay with its original handler. Its extra
  // request must not be silently converted into an appointment title.
  if (!title || title.length > 100 || /[，,；;。!?？！「」『』"`]/u.test(title) ||
      /https?:|www\.|並且|然後|順便|同時|以及|另外|接著|還要|再幫我|也幫我|不用|不要|不需要|送出|提交|繳交|發送|傳送|發訊息|付款|下單|刪除|取消|通知|提醒|邀請/u.test(title) ||
      /\d{1,2}:\d{2}/u.test(title)) return null;
  const clock = (value: string) => value.split(':').map((part) => part.padStart(2, '0')).join(':');
  try {
    const event = parseAssistantCalendarEvent({
      title, date: explicitDate(rawDate, now), allDay: false,
      startTime: clock(rawStart), endTime: clock(rawEnd),
    });
    if (Date.parse(`${event.date}T${event.startTime}:00+08:00`) <= now) {
      return { kind: 'invalid', message: '這個開始時間已經過了。請提供未來的日期與起訖時間，我會先列出行程草稿。' };
    }
    return { kind: 'draft', event };
  } catch {
    return { kind: 'invalid', message: '請提供有效日期，以及同一天由早到晚的起訖時間，例如「幫我明天 19:00 到 20:00 安排英文讀書」。' };
  }
}
