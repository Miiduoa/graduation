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
const pickupTime = '(?:預定)?取餐時間';
const latestPickupTime = latest + '的?' + pickupTime;
const calendarLocation = '(?:我(?:的)?)?(?:個人)?(?:行事曆|日曆|行程)(?:上|中|裡|內)?';
const destination = '(?:' + placement + ')' + calendarLocation;
const readPrompt = '(?:' + polite + '(?:確認|核對|查詢|查看|看|查|知道|詢問|問)(?:一下)?)';
const standaloneReadPrompt = new RegExp('^(?:' + readPrompt + '|' + polite + ')$');
const orderWriteVerb =
  '取消|撤銷|撤回|作廢|刪|移除|移走|清除|清空|封存|改|變更|調整|更新|更換|' +
  '下單|訂購|重訂|付款|結帳|退款|退訂|退單|退費|送出|提交|延後|提前|延期|重排|標記|備註';
// Order qualifiers are open-ended, so exclude action verbs and request prefixes
// here. Calendar placement verbs are allowed only in the status question itself.
const order = '(?:(?!' + pickupVerb.source +
  '|' + orderWriteVerb + '|請|麻煩|幫我|替我|我想|不要|不用|如果|假設|翻譯)[^,;、。.!?]){0,80}訂單';
const orderLookup = new RegExp(
  '^' + readPrompt + '?' + order + '(?:的?' + pickupTime +
    '(?:是?(?:幾點|什麼時候)(?:啊|呢|嗎)?)?)?[?]*$',
);
const pickupTimeLookup = new RegExp(
  '^' + readPrompt + '?' + pickupTime + '是?(?:幾點|什麼時候)(?:啊|呢|嗎)?[?]*$',
);
const calendarEntry = '(?:' + placement + '|放進|記在)' + calendarLocation;
const calendarEntryPattern = new RegExp(calendarEntry);
const pickupSubject = '(?:(?:' + order + '的?)?' + pickupTime + ')?';
const calendarSubject = readPrompt + '?' + pickupSubject;
const calendarStatus = new RegExp(
  '^' + calendarSubject +
    '(?:(?:有沒有|有無|是否|是不是)(?:已經|已)?' + calendarEntry + '(?:了)?(?:嗎|呢)?|' +
    '(?:已經|已|有)?' + calendarEntry + '(?:了嗎|嗎|了沒|沒有)|' +
    '(?:已經|已|有)' + calendarEntry + '(?:了|呢)?(?=[?])|' +
    calendarEntry + '(?:了|呢)(?=[?]))[?]*$',
);
const questionEnding = '(?:啊|呢|嗎)?[?]*$';
const calendarSlot = '(?:哪(?:一)?(?:天|日|個時段|個時間(?:點)?|個日期)|幾號|星期幾|禮拜幾|幾點|什麼時候|什麼時段)';
const calendarSlotLookup = new RegExp(
  '^' + calendarSubject + '(?:已經|已|有)?' + calendarEntry +
    '的?(?:是|在)?' + calendarSlot + questionEnding,
);
const calendarVisibility = '(?:在)?' + calendarLocation + '(?:還是|仍然|還|仍)?(?:找不到|看不到)';
const calendarVisibilityPattern = new RegExp(calendarVisibility);
const missingCalendarEntry = '(?:(?:還沒(?:有)?|尚未|沒有|沒|未)(?:被)?' + calendarEntry +
  '|' + calendarVisibility + '|(?:找不到|看不到))';
const reason = '(?:為什麼|為何|怎麼|怎會)';
const missingCalendarStatus = new RegExp('^' + calendarSubject + missingCalendarEntry + '$');
const calendarAbsenceQuestion = new RegExp(
  '^' + readPrompt + '?(?:(?:' + reason + pickupSubject + '|' + pickupSubject + reason + ')' +
    missingCalendarEntry + '|' + reason + calendarVisibility + pickupSubject + '|' +
    pickupSubject + missingCalendarEntry + '(?=嗎|[?]))' + questionEnding,
);
const reasonFollowup = new RegExp('^' + readPrompt + '?' + reason + questionEnding);

function isReadOnlyPickupQuestion(text: string): boolean {
  const clauses = text.split(/[;,、。.!]+|(?<=\?)(?=[^?])/)
    .map(clause => clause.replace(/^(?:也|順便|另外|再|然後|接著)+/, ''))
    .filter(clause => clause && !standaloneReadPrompt.test(clause));
  return clauses.length > 0 &&
    clauses.every((clause, index) =>
      calendarStatus.test(clause) || calendarSlotLookup.test(clause) ||
      calendarAbsenceQuestion.test(clause) || orderLookup.test(clause) || pickupTimeLookup.test(clause) ||
      // A trailing reason question can refer to the immediately preceding absence statement.
      (missingCalendarStatus.test(clause) && reasonFollowup.test(clauses[index + 1] ?? '')) ||
      (reasonFollowup.test(clause) && missingCalendarStatus.test(clauses[index - 1] ?? '')));
}
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
  '^' + polite + '(?:把|將)?' + latestPickupTime + destination + duration + '$',
);
const readThenPlan = new RegExp(
  '^' +
    polite +
    '(?:查詢|查看|查)' +
    latest +
    '[,;](?:然後|接著|再|並且|並)?(?:把|將)(?:它的|該筆訂單的)?' +
    pickupTime +
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
  const compact = text.replace(/\s+/g, '');
  if (!/取餐/.test(text) || !/訂單|取餐時間/.test(text) || !/行事曆|日曆|行程/.test(text) ||
      !(pickupVerb.test(text) || calendarEntryPattern.test(text) || calendarVisibilityPattern.test(compact))) return null;
  // A user-specified appointment can mention order work in its title. Preserve
  // the complete existing appointment grammar, including its invalid-time help.
  if (parseAssistantCalendarIntent(text)) return null;
  const invalid = (): AssistantFoodPickupIntent => ({ kind: 'invalid', message: guidance });
  if (text.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"'`]/u.test(text)) return invalid();
  if (isReadOnlyPickupQuestion(compact)) return null;
  if (/不要|不用|不必|無須|不需要|不想|先別|別幫|不是|翻譯|例句|範例|假設|如果/.test(text)) return invalid();
  const match = direct.exec(compact) || readThenPlan.exec(compact);
  if (!match) return invalid();
  const [, numericMinutes, hourLabel] = match;
  const durationMinutes =
    numericMinutes !== undefined ? Number(numericMinutes) : hourLabel ? hours[hourLabel] : 15;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 120)
    return { kind: 'invalid', message: '取餐行程請預留5到120分鐘，例如「把最近一筆訂單的取餐時間加入行事曆，預留15分鐘」。這次尚未建立行程。' };
  return { kind: 'latest', durationMinutes };
}
