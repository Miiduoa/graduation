import { parseAssistantCalendarIntent } from './assistantCalendarIntent';

export type AssistantFoodPickupIntent =
  | { kind: 'latest'; durationMinutes: number }
  | { kind: 'invalid'; message: string };

const guidance =
  '可以說「把最近一筆訂單的取餐時間加入行事曆，預留15分鐘」。我會核對原訂單後提供確認卡；這次尚未讀取訂單或建立行程。';

const placement = '加(?:入|到|進)|排入|放(?:入|到)|記(?:入|到)|存(?:入|到)';
const pickupVerb = new RegExp(placement + '|建立|新增|安排|儲存');
const polite = '(?:(?:請|麻煩你?|幫我|替我|我想){0,3})';
const latest = '(?:我(?:的)?)?(?:最近|最新)(?:的)?(?:一筆|一張)?(?:的)?訂單';
const destination = '(?:' + placement + ')(?:我(?:的)?)?(?:個人)?(?:行事曆|日曆|行程)(?:中|裡|內)?';
const hours: Readonly<Record<string, number>> = {
  半小時: 30,
  半個小時: 30,
  一小時: 60,
  一個小時: 60,
  一個半小時: 90,
  兩小時: 120,
  兩個小時: 120,
};
const duration =
  '(?:[,、;]?(?:幫我)?(?:預留|保留|留)(?:([0-9]{1,3})(?:分鐘|分)|(' +
  Object.keys(hours).join('|') +
  ')))?[。.!！]?';
const direct = new RegExp(
  '^' + polite + '(?:把|將)?' + latest + '的?(?:預定)?取餐時間' + destination + duration + '$',
);
const readThenPlan = new RegExp(
  '^' +
    polite +
    '(?:查詢|查看|查)' +
    latest +
    '[,;](?:然後|接著|再|並且|並)?(?:把|將)(?:它的|該筆訂單的)?(?:預定)?取餐時間' +
    destination +
    duration +
    '$',
);

/** A complete source-dependent request, shared by the UI and server. Unknown
 * qualifiers must not become an unfiltered order selection or a guessed event.
 * A recognized but unsupported request stays out of the model write path.
 */
export function parseAssistantFoodPickupIntent(question: string): AssistantFoodPickupIntent | null {
  if (typeof question !== 'string') return null;
  const text = question.normalize('NFKC').trim();
  if (!/取餐/.test(text) || !/訂單|取餐時間/.test(text) || !/行事曆|日曆|行程/.test(text) ||
      !pickupVerb.test(text)) return null;
  // A user-specified appointment can mention order work in its title. Preserve
  // the complete existing appointment grammar, including its invalid-time help.
  if (parseAssistantCalendarIntent(text)) return null;
  const invalid = (): AssistantFoodPickupIntent => ({ kind: 'invalid', message: guidance });
  if (text.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"'`]/u.test(text) ||
      /不要|不用|不必|無須|不需要|不想|先別|別幫|不是|翻譯|例句|範例|假設|如果/.test(text)) return invalid();
  const compact = text.replace(/\s+/g, '');
  const match = direct.exec(compact) || readThenPlan.exec(compact);
  if (!match) return invalid();
  const [, numericMinutes, hourLabel] = match;
  const durationMinutes =
    numericMinutes !== undefined ? Number(numericMinutes) : hourLabel ? hours[hourLabel] : 15;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 120)
    return { kind: 'invalid', message: '取餐行程請預留5到120分鐘，例如「把最近一筆訂單的取餐時間加入行事曆，預留15分鐘」。這次尚未建立行程。' };
  return { kind: 'latest', durationMinutes };
}
