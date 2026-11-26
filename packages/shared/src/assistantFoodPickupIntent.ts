import { parseAssistantCalendarIntent } from './assistantCalendarIntent';

export type AssistantFoodPickupIntent =
  | { kind: 'latest'; durationMinutes: number }
  | { kind: 'invalid'; message: string };

const guidance = '可以說「把最近一筆訂單的取餐時間加入行事曆，預留15分鐘」。我會核對原訂單後提供確認卡；這次尚未讀取訂單或建立行程。';

function parseBaseline(text: string, compact: string): AssistantFoodPickupIntent | null {
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

const writeSubject = '((?:[^,;、。.!?]{0,80}訂單的?)?(?:預定)?取餐時間)';
const writeDestination = '(?:放到|記到|加到|寫到|排到|新增到|同步到)' +
  '(?:我(?:的)?)?(?:個人)?(?:日曆|行事曆|行程)(?:上|中|裡|內)?';
const requestWrite = new RegExp(
  '^(?:幫我|請你?|麻煩你?|我要|我想要?|給我|替我){1,3}把' + writeSubject + writeDestination + '[。.!]?$',
);
const feasibilityQuestion = /可以|可否|能否|能不能|能夠|可不可行|行不行|好不好|要不要|會不會|方不方便|方便不方便/;
const queryOrStatus = /查|看|確認|核對|檢查|問|知道|哪|幾|什麼|何時|為何|如何|怎|日期|時間是|是否|有沒有|有無|是不是|已|嗎|呢|吧|了|尚未|還沒|沒|[?]/;
const otherAction = new RegExp(
  '取消|撤銷|撤回|作廢|退|刪|移除|移走|挪|清除|清空|改|編輯|調整|變更|更新|更換|換|付款|結帳|同步|' +
  '下單|下訂|訂購|重(?:新)?(?:點|訂|買|購)|再(?:點|訂|買|購)|補訂|加點|買|點餐|^(?:點|訂(?!單))|' +
  '送出|提交|建立|新增|安排|儲存|加入|加到|加進|排入|排到|放[入到進]|記[入到在]|寫[入到]|存[入到]|' +
  '鎖定|解鎖|凍結|延後|提前|延期|重排|標記|備註|不要|不用|不必|無須|不需要|不想|先別|別幫|不是|翻譯|例句|範例|假設|如果',
);

/** Preserve the existing classification before checking for a new pickup write. */
export function parseAssistantFoodPickupIntent(question: string): AssistantFoodPickupIntent | null {
  if (typeof question !== 'string') return null;
  const text = question.normalize('NFKC').trim();
  const compact = text.replace(/\s+/g, '');
  const baseline = parseBaseline(text, compact);
  if (baseline) return baseline;

  if (text.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"'\x60]/u.test(text) ||
      feasibilityQuestion.test(compact) || queryOrStatus.test(compact)) return null;
  const match = requestWrite.exec(compact);
  // Check for other actions in the subject so placement verbs such as 同步到 are allowed.
  if (!match || otherAction.test(match[1]) || parseAssistantCalendarIntent(text)) return null;
  return { kind: 'invalid', message: guidance };
}
