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
const readPrompt = '(?:(?:能不能|可不可以|能否|是否可以|可以|能)?' + polite + '(?:幫忙)?' +
  '(?:確認|核對|查詢|查看|看|查|知道|詢問|問)(?:一下)?)';
const questionEnding = '(?:啊|呢|嗎)?[?]*$';
const standaloneReadPrompt = new RegExp('^(?:' + readPrompt + '|' + polite + ')' + questionEnding);
const calendarVisibility = '(?:我)?(?:在)?' + calendarLocation + '(?:還是|仍然|還|仍)?' +
  '(?:找不到|看不到|(?:沒有|沒|未)(?:找到|看到|出現|顯示))';
// Order qualifiers are open-ended, so exclude action verbs and request prefixes
// here. Calendar placement verbs are allowed only in the status question itself.
// Bare order verbs can begin a request, while words such as 餐點 can describe an order.
const orderRequest = '(?:點|訂(?!單)|買|購買)';
const delegatedOrderRequest = '(?:幫忙|幫我|替我|代)' + orderRequest;
const connectedOrderRequest = '(?:並且?|接著|然後|順便|也|另外)' + orderRequest;
// Avoid treating the boundary in 「查一下訂單」 as the verb 「下訂」.
const orderWriteVerb =
  '鎖定|解鎖|凍結|取消|撤銷|撤回|作廢|刪|移除|移走|清除|清空|封存|編輯|改|變更|調整|更新|更換|' +
  '下單|(?<!一)下訂|訂購|加點|補訂|重(?:新)?(?:點|訂|買|購)|再(?:點|訂|買|購)|付款|結帳|退款|退訂|退單|退費|送出|提交|延後|提前|延期|重排|標記|備註|同步|' +
  delegatedOrderRequest + '|' + connectedOrderRequest;
const bareOrderRequest = readPrompt + '?' + orderRequest;
const order = '(?!' + bareOrderRequest + ')(?:(?!' + pickupVerb.source +
  '|' + orderWriteVerb +
  '|請|麻煩|幫我|替我|我想|不要|不用|如果|假設|翻譯)[^,;、。.!?]){0,80}訂單';
const orderLookup = new RegExp(
  '^' + readPrompt + '?' + order + '(?:的?' + pickupTime +
    '(?:是?(?:幾點|什麼時候)(?:啊|呢|嗎)?)?)?[?]*$',
);
const pickupDate = '(?:今|昨|前|大前|明|後)天|上(?:一)?次|上(?:個)?(?:週|星期|月)|最近|最新';
const pickupQualifier = '(?:' + order + '的?|(?:我(?:的)?)?(?:' + pickupDate + ')的?)';
const pickupTimeLookup = new RegExp(
  '^' + readPrompt + '?' + pickupQualifier + '?' + pickupTime + '是?(?:幾點|什麼時候)(?:啊|呢|嗎)?[?]*$',
);
const calendarEntry = '(?:' + placement + '|放進|記在)' + calendarLocation;
const calendarEntryPattern = new RegExp(calendarEntry);
const colloquialEntry = /(?:放到|記到|加到|寫到|存到|排到|新增到|同步到|記入|存入|放進|記在)/;
const statusQuestion = /哪|幾點|幾號|什麼|何時|何處|如何|怎麼|怎樣|為何|有沒有|有無|是否|是不是|難道|會不會|想知道|請問|確認|已經|[?]|(?:了|嗎|呢|了沒|了吧|了沒有)$/;
const statusQuestionTail = /^(?:好嗎|可以嗎|行嗎|對嗎|是嗎|了嗎|了沒|了吧)[?]*$/;
const colloquialRequest = /^(?:(?:沒有|還沒)就|(?:不要|不用|先別)?(?:把|將|請(?!問)|麻煩|幫我|替我|(?:我)?(?:想(?!知道)|要)|可以|能不能|可不可以))/;
const otherWrite = new RegExp(
  '(?:^|並且?|接著|然後|順便|另外|沒有就|還沒就)(?:' + readPrompt + '|' + polite + ')(?:' +
    orderWriteVerb + '|修改|建立|新增|安排|儲存|' + placement + ')',
);
const pickupSubject = '(?:' + pickupQualifier + '?' + pickupTime + ')?';
const calendarSubject = readPrompt + '?' + pickupSubject;
const calendarStatus = new RegExp(
  '^' + calendarSubject +
    '(?:(?:有沒有|有無|是否|是不是)(?:已經|已)?' + calendarEntry + '(?:了)?(?:嗎|呢)?|' +
    '(?:已經|已|有)?' + calendarEntry + '(?:了嗎|嗎|了沒|沒有)|' +
    '(?:已經|已|有)' + calendarEntry + '(?:了|呢)?(?=[?])|' +
    calendarEntry + '(?:了|呢)(?=[?]))[?]*$',
);
const calendarSlot = '(?:哪(?:一)?(?:天|日|個時段|個時間(?:點)?|個日期)|幾號|星期幾|禮拜幾|幾點|什麼時候|什麼時段)';
const calendarSlotLookup = new RegExp(
  '^' + calendarSubject + '(?:已經|已|有)?' + calendarEntry +
    '的?(?:是|在)?' + calendarSlot + questionEnding,
);
const calendarVisibilityPattern = new RegExp(calendarVisibility);
const missingCalendarEntry = '(?:(?:還沒(?:有)?|尚未|沒有|沒|未)(?:被)?' + calendarEntry +
  '|(?:找不到|看不到))';
const reason = '(?:為什麼|為何|怎麼|怎會)';
const missingCalendarStatus = new RegExp('^' + calendarSubject + missingCalendarEntry + '$');
const calendarAbsenceQuestion = new RegExp(
  '^' + readPrompt + '?(?:(?:' + reason + pickupSubject + '|' + pickupSubject + reason + ')' +
    missingCalendarEntry + '|' +
    pickupSubject + missingCalendarEntry + '(?=嗎|[?]))' + questionEnding,
);
const sync = '(?:有)?同步(?:完成|成功|好|到' + calendarLocation + ')?';
const diagnosticState = '(?:(?:還沒(?:有)?|尚未|未|沒有|沒)' + sync + '|同步(?:失敗|異常|出錯|延遲)|' +
  '(?:同步|系統|日曆|行事曆)(?:有(?:了)?問題|出(?:了)?(?:問題|錯)|異常|錯誤|故障)|' +
  '(?:同步|系統)(?:的)?問題)';
const syncStatus = '(?:有沒有|有無|是否)(?:已經|已)?' + sync + '|' +
  sync + '(?:了嗎|了沒|沒有|沒)';
const visibilityFollowup = '(?:(?:還沒(?:有)?|尚未|未|沒有|沒)(?:出現|顯示)(?:在' + calendarLocation + ')?|看不到|找不到)';
const reasonFollowup = new RegExp(
  '^' + readPrompt + '?(?:' + reason + '(?:(?:還是|仍然|還|仍)?(?:' +
    missingCalendarEntry + '|' + visibilityFollowup + '|' + diagnosticState + '))?|' +
    '(?:會不會是|是不是|是否|難道是|是)(?:因為)?' + diagnosticState + '|' +
    '(?:同步|系統)(?:是不是|是否|有沒有|有無)(?:有)?(?:問題|異常|出錯|故障)|' +
    syncStatus + '|' + diagnosticState + '(?=嗎|[?]))' + questionEnding,
);

const lookupFollowup = new RegExp(
  '^' + readPrompt + '?(?:我)?(?:應該|該)?(?:要|可以|能|得)?' +
    '(?:(?:(?:去|到|從|在)?(?:哪(?:裡|兒|邊)?|何處)(?:去)?|(?:怎麼|怎樣|如何)(?:才(?:能|可以))?)' +
    '(?:查(?:詢|看|找|到|得到)?|看(?:到|得到)?|找(?:到|得到)?)(?:一下)?|(?:找|問)誰)' +
    questionEnding,
);

function pickupClauses(text: string): string[] {
  return text.split(/[;,、。.!]+|(?<=\?)(?=[^?])/)
    .map(clause => clause.replace(/^(?:也|順便|另外|再(?!點|訂|買|購)|然後|接著|並且|並)+/, ''));
}

function isReadOnlyPickupQuestion(text: string, checkColloquialStatus = false): boolean {
  const clauses = pickupClauses(text)
    .filter(clause => clause && !standaloneReadPrompt.test(clause));
  return clauses.length > 0 &&
    clauses.every((clause, index) =>
      calendarStatus.test(clause) || calendarSlotLookup.test(clause) ||
      calendarAbsenceQuestion.test(clause) ||
      orderLookup.test(clause) || pickupTimeLookup.test(clause) ||
      (checkColloquialStatus && (
        (colloquialEntry.test(clause) && !otherWrite.test(clause.replace(colloquialEntry, '')) &&
          (statusQuestion.test(clause) || statusQuestionTail.test(clauses[index + 1] ?? ''))) ||
        (statusQuestionTail.test(clause) && colloquialEntry.test(clauses[index - 1] ?? ''))
      )) ||
      // Follow-ups borrow their subject from a preceding read clause.
      (missingCalendarStatus.test(clause) &&
        (reasonFollowup.test(clauses[index + 1] ?? '') || lookupFollowup.test(clauses[index + 1] ?? ''))) ||
      (index > 0 && (reasonFollowup.test(clause) || lookupFollowup.test(clause))));
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

// Preserve the merge-base grammar for calendar visibility questions.
function legacyClassify(text: string, compact: string): AssistantFoodPickupIntent | null {
  if (!/取餐/.test(text) || !/訂單|取餐時間/.test(text) || !/行事曆|日曆|行程/.test(text) ||
      !/加入|加到|加進|排入|放入|建立|新增|安排|存到|儲存/.test(text)) return null;
  // A user-specified appointment can mention order work in its title. Preserve
  // the complete existing appointment grammar, including its invalid-time help.
  if (parseAssistantCalendarIntent(text)) return null;
  const invalid = (): AssistantFoodPickupIntent => ({ kind: 'invalid', message: guidance });
  if (text.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"'`]/u.test(text) ||
      /不要|不用|不必|無須|不需要|不想|先別|別幫|不是|翻譯|例句|範例|假設|如果/.test(text)) return invalid();
  const polite = '(?:(?:請|麻煩你?|幫我|替我|我想){0,3})';
  const latest = '(?:我(?:的)?)?(?:最近|最新)(?:的)?(?:一筆|一張)?(?:的)?訂單';
  const destination = '(?:加(?:入|到|進)|排入|放入)(?:我(?:的)?)?(?:個人)?(?:行事曆|日曆|行程)(?:中|裡|內)?';
  const duration = '(?:[,、;]?(?:幫我)?(?:預留|保留|留)([0-9]{1,3})(?:分鐘|分))?[。.!！]?';
  const direct = new RegExp('^' + polite + '(?:把|將)?' + latest + '的?(?:預定)?取餐時間' + destination + duration + '$');
  const readThenPlan = new RegExp('^' + polite + '(?:查詢|查看|查)' + latest + '[,;](?:然後|接著|再|並且|並)?(?:把|將)(?:它的|該筆訂單的)?(?:預定)?取餐時間' + destination + duration + '$');
  const match = direct.exec(compact) || readThenPlan.exec(compact);
  if (!match) return invalid();
  const durationMinutes = match[1] === undefined ? 15 : Number(match[1]);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 120)
    return { kind: 'invalid', message: '取餐行程請預留5到120分鐘，例如「把最近一筆訂單的取餐時間加入行事曆，預留15分鐘」。這次尚未建立行程。' };
  return { kind: 'latest', durationMinutes };
}

/** A complete source-dependent request, shared by the UI and server. Unknown
 * qualifiers must not become an unfiltered order selection or a guessed event.
 * A recognized but unsupported request stays out of the model write path.
 */
export function parseAssistantFoodPickupIntent(question: string): AssistantFoodPickupIntent | null {
  if (typeof question !== 'string') return null;
  const text = question.normalize('NFKC').trim();
  const compact = text.replace(/\s+/g, '');
  if (calendarVisibilityPattern.test(compact)) return legacyClassify(text, compact);
  if (colloquialEntry.test(compact) && legacyClassify(text, compact) === null) {
    // Only a request can opt in to placement that the old grammar did not catch.
    if (isReadOnlyPickupQuestion(compact, true) ||
        !pickupClauses(compact).some(clause =>
          (colloquialRequest.test(clause) && !standaloneReadPrompt.test(clause)) ||
          otherWrite.test(clause.replace(colloquialEntry, '')))) return null;
  }
  if (!/取餐/.test(text) || !/訂單|取餐時間/.test(text) || !/行事曆|日曆|行程/.test(text) ||
      !(pickupVerb.test(text) || calendarEntryPattern.test(text))) return null;
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
