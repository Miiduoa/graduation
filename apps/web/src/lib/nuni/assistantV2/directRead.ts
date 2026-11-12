import { addDays, clip, eventArgs, taipeiDate, type Obj } from './contracts';
import { eventInterval } from './actions';

export type DirectRead = {
  kind: 'schedule' | 'next-class' | 'calendar' | 'due-work';
  tool: 'get_schedule' | 'get_calendar' | 'get_due_work';
  args: { from: string; to: string };
};


function mentionsSpecificCourseWork(text: string): boolean {
  if (!/作業|測驗/.test(text)) return false;
  const generic = /我的?|我有|今[天日]|明[天日]|後[天日]|這[週周](?:一|二|三|四|五|六|日|天)?|本[週周]|接下來|最近|目前|現在|還有|有沒有|哪些|什麼|要交|待繳|未繳|沒交|未交|沒繳|列出|告訴我|查詢?|所有|全部|待辦|課表|行程|行事曆|上課|\d{4}-\d{2}-\d{2}/g;
  const leftover = text.split(/作業|測驗/)[0]
    .replace(generic, '')
    .replace(/[的了嗎呢啊吧，,。．、？?\s有和與及]/g, '');
  return leftover.length >= 2;
}

/** Only unambiguous information requests get automatic, read-only retrieval. */
export function directReads(question: string, now: number): DirectRead[] {
  if (question.length > 1000 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return [];
  const text = question.normalize('NFKC').trim();
  if (
    /[「」『』“”"'`]|不要|不用|不必|無須|不需要|不想|不是要|先別|別幫|翻譯|這句話|假設|如果|例如|範例|曾經|之前|昨天|前天/.test(text) ||
    /開啟|打開|前往|進入|帶我到|帶我去|功能|怎麼用|如何用|操作|教我/.test(text) ||
    /新增|建立|加入|儲存|保存|移除|刪除|修改|更改|規劃|幫我排|幫我留|提醒|送出|(?:幫我|替我|代我)(?:繳交|提交)/.test(text) ||
    /然後|順便|並且|另外|接著|同時|也幫|分享|傳訊|傳給|發送|寄出|寄信|寄給|存下|交掉|幫我交|發布|發文|預約|訂位|申請|請假|報名|取消|變更|更新|付款|購買/.test(text) ||
    /圖書館|公車|交通|餐|社團|社群|教材|公告|通知|活動|成績|學分/.test(text) ||
    /週|周|禮拜|月底|月初|本月|下月|上月|上午|早上|下午|晚上|今晚|明早|明晚|大後天|隔天|改天|學期|寒假|暑假|明年|今年|每天|每日|\d{1,2}[月/]\d{1,2}|\d{1,2}(?:號|日)|[一二三四五六七八九十\d]+天(?:後|前)/.test(text)
  ) return [];
  const calendarQuestion = /(?:有(?:什麼|哪些|沒有)|列出|查看|查詢|告訴我).{0,8}安排/.test(text);
  if (/安排/.test(text) && !calendarQuestion) return [];
  const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]);
  if (dates.length > 1 || (dates[0] && (
    !Number.isFinite(Date.parse(dates[0])) || new Date(dates[0]).toISOString().slice(0, 10) !== dates[0]
  ))) return [];
  const relativeDays = [/今天|今日/, /明天|明日/, /後天|後日/].flatMap((pattern, offset) => pattern.test(text) ? [offset] : []);
  if (relativeDays.length > 1 || (dates.length && relativeDays.length)) return [];
  const today = taipeiDate(now);
  const day = dates[0] || addDays(today, relativeDays[0] || 0);
  if (/空檔|空堂|有空|沒課/.test(text)) return [];
  if (/已繳|已交|繳了|交了|已提交|提交的|交完/.test(text)) return [];
  if (mentionsSpecificCourseWork(text)) return [];
  const asking = /什麼|哪些|有沒有|幾點|在哪|哪裡|哪裏|多少|還有|未交|未繳|沒交|沒繳|查|告訴我|列出/.test(text);
  if (!asking && !/(?:我的|今天|今日|明天|明日|後天|後日|\d{4}-\d{2}-\d{2}).{0,4}(?:課表|行程|行事曆|作業)/.test(text)) return [];
  const reads: DirectRead[] = [];
  const nextClass = /下(?:一)?(?:堂|節)(?:課)?|接下來(?:的)?(?:一堂|一節)?課/.test(text);
  if (nextClass || /課表|上課|有.{0,5}課|哪些課|什麼課|幾點.{0,4}課|課.{0,5}(?:時間|教室|在哪|哪裡|幾點|結束)/.test(text)) {
    reads.push({ kind: nextClass ? 'next-class' : 'schedule', tool: 'get_schedule',
      args: { from: day, to: nextClass && !dates.length && !relativeDays.length ? addDays(day, 6) : day } });
  }
  if (/行程|行事曆|個人事件/.test(text) || calendarQuestion)
    reads.push({ kind: 'calendar', tool: 'get_calendar', args: { from: day, to: day } });
  if (/作業|測驗|要交|待繳|未繳|沒交|未交|沒繳/.test(text)) {
    // "今天還有哪些沒交" asks what remains, not only what is due today.
    // A named future date or an explicit due-today question narrows the range.
    const dueOnDay = dates.length > 0 || /明天|明日|後天|後日/.test(text) || /(?:今天|今日).{0,8}(?:要交|截止|到期)|(?:截止|到期).{0,4}(?:今天|今日)/.test(text);
    reads.push({ kind: 'due-work', tool: 'get_due_work', args: { from: day, to: dueOnDay ? day : addDays(day, 6) } });
  }
  return reads;
}

type Evidence = { tool: string; result: unknown };
const row = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const rows = (v: unknown): Obj[] => Array.isArray(v) ? v.map(row) : [];
const label = (v: unknown, fallback = '未提供') => typeof v === 'string' && v.trim()
  ? clip(v.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim(), 240) : fallback;
const validClock = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function dayLabel(day: string, now: number): string {
  const today = taipeiDate(now);
  return (day === today ? '今天' : day === addDays(today, 1) ? '明天' : day === addDays(today, 2) ? '後天' : '') + '（' + day + '）';
}
function timeLabel(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '未提供截止時間';
  return new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
}
function resultFor(read: DirectRead, evidence: Evidence[]): Obj | undefined {
  const found = evidence.find((item) => item.tool === read.tool);
  if (!found) return;
  const wrapped = row(found.result);
  return wrapped.data && typeof wrapped.data === 'object' ? row(wrapped.data) : wrapped;
}

/** Facts are rendered from this request's authenticated tool results, not model prose. */
export function directReadAnswer(reads: DirectRead[], evidence: Evidence[], now: number): string {
  const sections: string[] = [];
  for (const read of reads) {
    const result = resultFor(read, evidence);
    const day = dayLabel(read.args.from, now);
    if (!result) {
      sections.push('目前無法讀取' + (read.kind === 'due-work' ? '作業與測驗' : read.kind === 'calendar' ? '個人行程' : '已同步課表') +
        '，因此還不能判斷內容。請確認資料已連接或同步後重試。');
      continue;
    }
    if (read.kind === 'schedule' || read.kind === 'next-class') {
      const classes = rows(result.classes).filter((entry) => typeof entry.title === 'string' &&
        typeof entry.date === 'string' && entry.date >= read.args.from && entry.date <= read.args.to &&
        validClock(entry.startTime) && validClock(entry.endTime))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
      const selected = read.kind === 'next-class'
        ? classes.filter((entry) => Date.parse(entry.date + 'T' + entry.startTime + ':00+08:00') >
          (read.args.from === taipeiDate(now) ? now : Date.parse(read.args.from + 'T00:00:00+08:00') - 1)).slice(0, 1)
        : classes.slice(0, 20);
      const lines = [read.kind === 'next-class' ? '已同步課表中的下一堂課：' : day + '的已同步課表：'];
      for (const entry of selected) lines.push('- ' + (read.kind === 'next-class' ? dayLabel(String(entry.date), now) + ' ' : '') +
        entry.startTime + '–' + entry.endTime + '　' + label(entry.title) + '｜' + label(entry.location));
      if (!selected.length) lines.push(read.kind === 'next-class'
        ? (read.args.from === read.args.to ? day : '接下來七日') + '的已同步資料中，沒有找到下一堂課。'
        : '這一天沒有已同步且能定位時間的課程紀錄。');
      if (classes.length > 20 && read.kind === 'schedule') lines.push('共 ' + classes.length + ' 堂，先列出前 20 堂。');
      if (typeof result.unplaced === 'number' && result.unplaced > 0)
        lines.push('另有 ' + result.unplaced + ' 筆課表缺少可定位的日期或節次，未計入結果。');
      lines.push('來源：已同步的個人課表；未同步的裝置資料不包含在內。');
      sections.push(lines.join('\n'));
      continue;
    }
    if (read.kind === 'calendar') {
      const from = Date.parse(read.args.from + 'T00:00:00+08:00');
      const until = Date.parse(addDays(read.args.to, 1) + 'T00:00:00+08:00');
      let incomplete = 0;
      const events = rows(result.events).filter((entry) => {
        try {
          const [start, end] = eventInterval(eventArgs(entry));
          // All-day endDate is exclusive; timed events can overlap this day
          // even when they started on the previous date.
          return start < until && end > from;
        } catch {
          incomplete++;
          return false;
        }
      });
      const lines = [day + '的已同步個人行程：'];
      for (const entry of events.slice(0, 20)) {
        const start = validClock(entry.startTime) ? entry.startTime : '';
        const end = validClock(entry.endTime) ? entry.endTime : '';
        const datePrefix = entry.date !== read.args.from ? String(entry.date) + ' ' : '';
        const endPrefix = typeof entry.endDate === 'string' && entry.endDate !== entry.date ? entry.endDate + ' ' : '';
        lines.push('- ' + label(entry.title) + '｜' + (entry.allDay === true ? '全天'
          : start && end ? datePrefix + start + '–' + endPrefix + end : '時間未完整提供'));
      }
      if (!events.length) lines.push(incomplete
        ? '這一天沒有能確認時間的個人行程紀錄，仍有資料需要核對。'
        : '這一天沒有已同步的個人行程紀錄；這不代表課表也沒有課。');
      if (events.length > 20) lines.push('共 ' + events.length + ' 筆，先列出前 20 筆。');
      if (incomplete) lines.push('另有 ' + incomplete + ' 筆行程的日期或時間不完整，未計入結果。');
      lines.push('來源：已同步的個人行事曆。');
      sections.push(lines.join('\n'));
      continue;
    }
    const pending = rows(result.pending).filter((entry) => entry.submitted === false && entry.state === 'open');
    const undated = rows(result.undated).filter((entry) => entry.submitted === false && entry.state === 'open');
    const overdue = rows(result.overdue).filter((entry) => entry.submitted === false);
    const period = read.args.from === read.args.to ? day : read.args.from + ' 至 ' + read.args.to;
    const lines = [period + '的待繳作業／測驗：'];
    for (const entry of pending.slice(0, 20)) lines.push('- ' + label(entry.title) +
      (entry.kind === 'quiz' ? '（測驗）' : '') + '｜截止 ' + timeLabel(entry.dueAt));
    if (!pending.length) lines.push('目前成功讀取的課程資料中，沒有列出這段期間尚未到期的待繳項目。');
    if (pending.length > 20) lines.push('共 ' + pending.length + ' 筆，先列出前 20 筆。');
    if (overdue.length) lines.push('同一查詢期間內已逾期且未交：\n' + overdue.slice(0, 10)
      .map((entry) => '- ' + label(entry.title) + '｜原截止 ' + timeLabel(entry.dueAt)).join('\n'));
    if (overdue.length > 10) lines.push('另有 ' + (overdue.length - 10) + ' 筆同期間逾期項目未列出。');
    if (undated.length) lines.push('尚未提供截止時間：\n' + undated.slice(0, 10).map((entry) => '- ' + label(entry.title)).join('\n'));
    if (undated.length > 10) lines.push('另有 ' + (undated.length - 10) + ' 筆未定期限項目未列出。');
    if (result.partial === true) {
      const missing = rows(result.unqueried).map((entry) => label(entry.title, '')).filter(Boolean);
      lines.push('仍有課程未完成查詢' + (missing.length ? '：' + missing.slice(0, 8).join('、') : '') + '，以上不是完整清單。');
    }
    lines.push('來源：目前可讀取的課程作業與測驗，時間為台灣時間；未連接的課程不包含在內。');
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}
