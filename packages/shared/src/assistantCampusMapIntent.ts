/** Explicit location questions shared by the browser and the server. This
 * module contains no model, credentials, source readers or server imports. */
export type CampusMapCommand = { kind: 'place'; query: string } | { kind: 'next-class' };
export type CampusMapClause = CampusMapCommand |
  { kind: 'next-class'; dayPhrase: string } | { kind: 'previous-next-class' } |
  { kind: 'previous-event'; index: number } | { kind: 'previous-library' };

const prefix = '(?:(?:幫我|替我|請問|請|麻煩|我想知道|我想查|我想看|告訴我|查詢|查看|查一下|看一下|查|找|看)\\s*)*';
const nextClass = '(?:下(?:一)?(?:堂|節)課|接下來(?:的)?(?:一堂|一節)?課)';
const day = '(今天|今日|明天|明日|後天|後日|\\d{4}-\\d{2}-\\d{2})?';
const where = '(?:(?:教室|上課地點|地點|位置)?(?:在哪裡|在哪裏|在哪)|(?:教室|上課地點|地點)(?:的)?位置|(?:教室)?(?:地圖|位置))';
const nextLocation = new RegExp('^' + prefix + day + '(?:我的?)?' + nextClass + '的?' + where + '(?:嗎|呢)?$');
const nextSchedule = new RegExp('^' + prefix + '(?:我的?)?' + nextClass + '(?:是什麼|是什麼課|有什麼)?(?:嗎|呢)?$');
const previousLocation = new RegExp('^' + prefix + '(?:(?:那堂課|這堂課|那個|這個|它)的?)?(?:教室|上課地點|地點)(?:在哪裡|在哪裏|在哪|的?位置)(?:嗎|呢)?$');
const libraryLocation = new RegExp('^' + prefix + '(?:這間|這座|該|那間|那座)圖書館的?(?:位置|地點|在哪裡|在哪裏|在哪)(?:嗎|呢)?$');
const eventLocation = new RegExp('^' + prefix + '第([一二兩三四五1-5])(?:個|筆|場|項)活動的?(?:(?:地點)?(?:在哪裡|在哪裏|在哪)|位置|地點)(?:嗎|呢)?$');
const badRequest = /不要|不用|不必|不需要|無須|先別|別幫|不是要|翻譯|這句話|假設|如果|例如|範例|之前|曾經|昨天|前天|剛才|剛剛|每天|每日|每週|每月|自動|持續|新增|建立|儲存|保存|移除|刪除|修改|更改|規劃|提醒|送出|繳交|提交|分享|傳訊|傳給|發送|寄出|寄信|寄給|發布|發文|預約|訂位|申請|請假|報名|取消|變更|更新|付款|購買|開啟|打開|前往|進入|導航|路線|怎麼走|如何走|怎麼去|如何去|步行|走路|開車|騎車/;
const badQuery = /今天|今日|明天|明日|後天|後日|本週|下週|禮拜|星期|幾點|幾樓|哪一樓|哪個|營業|開放|時間|最近|目前|現在|附近|最近的|距離|公尺|分鐘|(?:然後|接著|順便|並且|另外|以及|同時)|(?:樓|館|教室|中心|校門|宿舍|球場|操場|停車場|餐廳|廣場)(?:和|與)/;
const namedPlace = /(?:樓|館|教室|中心|校門|大門|宿舍|球場|操場|停車場|餐廳|實驗室|公車站|站牌|廣場|辦公室|系辦)(?:\s*[A-Za-z]?\d{1,5}[A-Za-z]?)?$/;
const classroomCode = /^[\p{Script=Han}A-Za-z]{1,12}[ -]?\d{2,5}[A-Za-z]?$/u;

function cleanQuestion(question: string): string | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[。.!！?？]+$/, '').trim();
  return badRequest.test(text) ? null : text;
}

/** One fully consumed clause. Context-dependent classroom pronouns carry no
 * guessed location; the task planner must bind a verified next-class source. */
export function parseCampusMapClause(question: string): CampusMapClause | null {
  const text = cleanQuestion(question);
  if (!text || /[，,；;。.!！?？]/.test(text)) return null;
  const next = text.match(nextLocation);
  if (next) return next[1] ? { kind: 'next-class', dayPhrase: next[1] } : { kind: 'next-class' };
  if (previousLocation.test(text)) return { kind: 'previous-next-class' };
  if (libraryLocation.test(text)) return { kind: 'previous-library' };
  const event = text.match(eventLocation);
  if (event) return { kind: 'previous-event', index: ({ 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5 } as Record<string, number>)[event[1]] || Number(event[1]) };

  const body = text.replace(new RegExp('^' + prefix), '');
  const explicitMap = body.match(/^(?:校園)?(?:地圖|地點)(?:查詢|查|找)?\s*[:：]?\s*(.+?)(?:的?(?:位置|地點))?$/);
  const location = body.match(/^(.+?)(?:的?(?:位置|地點))?(?:在哪裡|在哪裏|在哪|位於哪裡)(?:嗎|呢)?$/) ||
    body.match(/^(.+?)的(?:位置|地點)(?:嗎|呢)?$/);
  const hasReadPrefix = body !== text;
  const query = (explicitMap?.[1] || location?.[1] || (hasReadPrefix ? body : '')).trim();
  if (!query || query.length > 120 || badQuery.test(query) ||
      !/^[\p{L}\p{N} _()（）-]+$/u.test(query) ||
      /下一堂|下堂|下一節|下節|課表|行程|作業|公告|通知|教材|助理|權限/.test(query) ||
      /^(?:教室|地點|位置|校園|地圖)$/.test(query) ||
      (!explicitMap && !namedPlace.test(query) && !classroomCode.test(query)) ||
      (!explicitMap && !location && /^(?:圖書館|餐廳|宿舍|公車站|站牌)$/.test(query))) return null;
  return { kind: 'place', query };
}

/** A complete, read-only map command. A date or any additional service is left
 * on the full task parser; converting it to a short command would lose intent. */
export function parseCampusMapCommand(question: string): CampusMapCommand | null {
  const text = cleanQuestion(question);
  if (!text) return null;
  const single = parseCampusMapClause(text);
  if (single?.kind === 'place') return single;
  if (single?.kind === 'next-class' && !('dayPhrase' in single)) return single;
  const clauses = text.split(/(?:然後|接著|順便|並且|[，,；;。])+/).map(clause => clause.trim()).filter(Boolean);
  if (clauses.length !== 2) return null;
  if (nextSchedule.test(clauses[0]) && parseCampusMapClause(clauses[1])?.kind === 'previous-next-class')
    return { kind: 'next-class' };
  const location = parseCampusMapClause(clauses[0]);
  // The existing homepage suggestion asks both location and time. The verified
  // next-class read already returns its exact start/end; no request is dropped.
  return location?.kind === 'next-class' && !('dayPhrase' in location) &&
    /^(?:是)?幾點(?:開始|上課|結束)?(?:嗎|呢)?$/.test(clauses[1]) ? { kind: 'next-class' } : null;
}
