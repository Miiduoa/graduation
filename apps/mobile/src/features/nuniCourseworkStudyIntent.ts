import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { classDate } from '@campus/shared/src/timetable/classExceptions';
import { isPersonalImportDate } from '@campus/shared/src/imports/validation';
import { assignmentOrdinal } from '../services/assignmentResultPage';
import { parseAssistantCalendarIntent } from '../services/assistantCalendarIntent';
import type { CourseworkRead } from './nuniCourseworkFollowUp';
import type { CourseworkStudyTime } from './nuniCourseworkStudy';
import type { CourseworkListRead } from '../services/nuniAssistantDataRead';

export type CourseworkStudyChoice = { assignmentId: string };
export type CourseworkStudySelection = {
  assignmentIds: string[];
  time?: CourseworkStudyTime;
  suggestTime?: true;
  suggestDate?: string;
  chooseSource?: true;
};
type StudyReply = {
  content: string;
  courseworkRead?: CourseworkRead;
  courseworkList?: CourseworkListRead;
  courseworkStudy?: CourseworkStudySelection;
};

const reference = '(?:(?:剛才|剛剛)?[這那](?:一)?(?:份|個)(?:作業)?|第(?:[1-9]\\d?|[一二三四五六七八九十]{1,3})(?:份|個)(?:作業)?|作業|「[^「」\\r\\n]{1,100}」|『[^『』\\r\\n]{1,100}』)';
const date = '(今天|明天|後天|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})';
const clock = '(\\d{1,2}:\\d{2})\\s*(?:到|至|[-~～–—])\\s*(\\d{1,2}:\\d{2})';
const polite = '(?:(?:請|麻煩)(?:你)?\\s*)?';
const prefix = `(?:(?:那就|那|就)\\s*)?${polite}(?:(?:幫我|替我|我想)\\s*)?`;
const preparation = '(?:準備(?:時間|行程)?|讀書(?:時間|行程))';
const datedRequests = [
  new RegExp(`^${polite}(?:幫|替|為)(?:我)?\\s*(${reference})\\s*(?:在)?\\s*${date}\\s*${clock}\\s*(?:安排|排入|新增)\\s*${preparation}$`, 'u'),
  new RegExp(`^${prefix}${date}\\s*${clock}\\s*(?:安排|新增)\\s*(${reference})(?:的)?${preparation}$`, 'u'),
  new RegExp(`^${prefix}(?:安排|新增)\\s*${date}\\s*${clock}\\s*(${reference})(?:的)?${preparation}$`, 'u'),
  new RegExp(`^${prefix}(?:安排|新增)\\s*(${reference})(?:的)?${preparation}\\s*(?:在)?\\s*${date}\\s*${clock}$`, 'u'),
];
const simpleRequests = [
  new RegExp(`^${prefix}(?:安排|新增|建立)\\s*(${reference})(?:的)?${preparation}$`, 'u'),
  new RegExp(`^${polite}(?:幫|替|為)(?:我)?\\s*(${reference})\\s*(?:安排|新增|建立)\\s*${preparation}$`, 'u'),
];
const findDay = '(?:今天|今日|明天|明日|後天|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})';
const halfHour = '(?:(?:30|三十)\\s*分鐘|半(?:個)?小時)';
const slotWords = '(?:準備(?:時間|時段|空堂)?|空堂(?:準備)?|空檔(?:準備)?)';
const ending = '\\s*(?:可以嗎|好嗎|嗎|呢|吧)?';
const findTimeRequests = [
  new RegExp(`^${polite}(?:幫|替|為)(?:我)?\\s*(?<reference>${reference})(?:的)?\\s*(?:(?<day>${findDay})\\s*)?(?:找|尋找|找出)\\s*(?:${halfHour}\\s*)?${slotWords}${ending}$`, 'u'),
  new RegExp(`^${polite}(?:幫|替|為)(?:我)?\\s*(?<reference>${reference})(?:的)?\\s*(?:找|尋找|找出)\\s*(?<day>${findDay})(?:的)?\\s*(?:${halfHour}\\s*)?${slotWords}${ending}$`, 'u'),
  new RegExp(`^${prefix}(?:找|尋找|找出)\\s*(?<reference>${reference})(?:的)?\\s*(?:(?<day>${findDay})(?:的)?\\s*)?(?:${halfHour}\\s*)?${slotWords}${ending}$`, 'u'),
  new RegExp(`^${prefix}(?<day>${findDay})\\s*(?:幫|替|為)(?:我)?\\s*(?<reference>${reference})\\s*(?:找|尋找|找出)\\s*(?:${halfHour}\\s*)?${slotWords}${ending}$`, 'u'),
];
const contextualTimeRequests = [
  new RegExp(`^${prefix}(?:找|尋找|找出)\\s*(?:(?<day>${findDay})(?:的)?\\s*)?${halfHour}\\s*${slotWords}${ending}$`, 'u'),
  new RegExp(`^${prefix}(?<day>${findDay})\\s*(?:找|尋找|找出)\\s*${halfHour}\\s*${slotWords}${ending}$`, 'u'),
  new RegExp(`^${polite}(?:(?:這份作業\\s*)?(?:今天|明天|後天)(?:就)?要交\\s+)?(?<day>${findDay})\\s*(?:哪|哪段|有沒有|有)\\s*${halfHour}\\s*(?:可以|能|用來)?\\s*(?:準備|讀書)${ending}$`, 'u'),
];
const searchDayOnly = new RegExp(`^(?:那|改查|換成)?\\s*(?<day>${findDay})${ending}$`, 'u');
const timeOnly = new RegExp(`^${date}\\s*${clock}$`, 'u');
const referenceOnly = new RegExp(`^${reference}$`, 'u');
const instructions = '請選定一份作業，可尋找 30 分鐘空堂，或自行填寫日期與起訖時間；確認前會重新核對原作業。';

function normalize(value: string) {
  // Conversational commas may separate clauses; punctuation inside a quoted
  // assignment title remains part of the exact source name.
  return value.normalize('NFKC').split(/([「『][^「」『』]*[」』])/u)
    .map((part) => /^[「『]/u.test(part) ? part : part.replace(/[,，]/gu, ' '))
    .join('').trim().replace(/[。.!！?？]+$/u, '').trim();
}

function requestedDate(value: string, now: number): string | undefined {
  const relative = /^(?:今天|今日)$/.test(value) ? 0 : /^(?:明天|明日)$/.test(value) ? 1 : value === '後天' ? 2 : null;
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  const date = relative === null ? match && `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    : classDate(new Date(now + relative * 86_400_000));
  if (!date || !isPersonalImportDate(date)) return;
  const midnight = Date.parse(`${classDate(new Date(now))}T00:00:00+08:00`);
  const target = Date.parse(`${date}T00:00:00+08:00`);
  return target >= midnight && target < midnight + 7 * 86_400_000 ? date : undefined;
}

/** This only selects a loaded source and explicit time. It never creates write authority. */
export function answerCourseworkStudyIntent(input: {
  question: string;
  read?: CourseworkRead;
  list?: CourseworkListRead;
  previous?: CourseworkStudySelection;
  choice?: CourseworkStudyChoice;
  accountId?: string;
  schoolId: string;
  isCurrent: () => boolean;
  now?: number;
}): StudyReply | null {
  const text = normalize(input.question);
  const ordinalFollowUp = input.previous && assignmentOrdinal(text) !== null;
  const selectedTime = input.previous && timeOnly.exec(text);
  const simple = simpleRequests.map((pattern) => pattern.exec(text)).find(Boolean);
  const finding = findTimeRequests.map((pattern) => pattern.exec(text)).find(Boolean) ??
    ((input.read || input.list) ? contextualTimeRequests.map((pattern) => pattern.exec(text)).find(Boolean) : undefined) ??
    (input.previous?.suggestTime ? searchDayOnly.exec(text) : undefined);
  const datedIndex = datedRequests.findIndex((pattern) => pattern.test(text));
  const dated = datedIndex >= 0 ? datedRequests[datedIndex].exec(text) : null;
  const requestReference = simple?.[1] ?? finding?.groups?.reference ?? dated?.[datedIndex === 1 || datedIndex === 2 ? 4 : 1];
  const instruction = requestReference ? text.replace(requestReference, '作業') : text;
  // Reserve source references even when their time/wording is incomplete. They
  // must never become an ordinary appointment titled "這份作業".
  const refersToWork = /[這那](?:一)?份(?:作業)?|[這那](?:一)?個作業|第(?:[1-9]\d?|[一二三四五六七八九十]{1,3})(?:份|個)作業/u.test(text) &&
    /安排|新增|建立|加入|排入|尋找|找|空堂/u.test(text);
  if (!input.choice && !simple && !finding && !dated && !ordinalFollowUp && !selectedTime && !refersToWork) return null;
  if (text.length > 300 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input.question) ||
      (!input.choice && /https?:|www\.|並且|然後|順便|同時|以及|另外|接著|還要|再幫我|也幫我|不用|不要|不需要|送出|提交|繳交|發送|傳送|發訊息|付款|下單|刪除|取消|通知|提醒|邀請/u.test(instruction))) {
    return { content: '請一次安排一份作業的準備時間。這次尚未建立行程。' };
  }
  const { read, list } = input;
  const current = !!input.accountId && input.isCurrent();
  const validRead = read && read.result.kind === 'assignments' && current && !read.anchor.uid &&
    read.anchor.owner === `nuni:${input.accountId}` && read.anchor.schoolId === input.schoolId &&
    read.anchor.classes.length === 1 && !!read.checkedAt && parseTaipeiInstant(read.checkedAt) !== null &&
    (!read.selectedWorkspaceId || read.selectedWorkspaceId === read.result.workspace.id);
  const validList = !read && list && current && list.owner === `nuni:${input.accountId}` &&
    list.schoolId === input.schoolId && parseTaipeiInstant(list.checkedAt) !== null &&
    list.assignments.length <= 30 && list.assignments.every((row) => row.source.accountId === input.accountId &&
      row.source.schoolId === input.schoolId && row.source.assignmentId === row.id);
  if (!validRead && !validList) {
    return { content: '請先查詢這門課的 nuni 作業，再選擇要安排準備時間的作業。' };
  }
  if (read?.changedAssignmentId) return { content: '作業已更新，請先重新核對這門課的作業。', courseworkRead: read };
  const rows: readonly { id: string; title: string }[] = read?.result.kind === 'assignments'
    ? read.result.assignments : list!.assignments;
  const source = read ? { courseworkRead: read } : { courseworkList: list! };
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  if (byId.size !== rows.length) return { content: '無法分辨這次查到的作業，請重新查詢。', ...source };
  const visibleIds = input.previous?.assignmentIds ?? read?.view?.ids ?? rows.map((row) => row.id);
  const visible = visibleIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  if (!visible.length) return { content: '剛才的清單沒有可安排的作業，請重新查詢這門課的作業。', ...source };
  const selected = input.choice && visible.find((row) => row.id === input.choice!.assignmentId);
  if (input.choice && !selected) return { content: '這份作業不在剛才的選項中，請重新選擇。', ...source };

  const ref = selected ? '' : requestReference ?? (ordinalFollowUp ? text : '');
  const ordinal = assignmentOrdinal(ref);
  let candidates = selected ? [selected] : visible;
  if (!selected && ref.startsWith('第') && ordinal === null) candidates = [];
  else if (!selected && ordinal !== null) candidates = visible.slice(ordinal - 1, ordinal);
  else if (!selected && /^[「『]/u.test(ref)) {
    const title = ref.slice(1, -1).normalize('NFKC').trim();
    candidates = rows.filter((row) => row.title.normalize('NFKC').trim() === title);
  } else if (!selected && (!ref || referenceOnly.test(ref))) {
    const opened = visible.find((row) => row.id === read?.openedAssignmentId);
    if (opened) candidates = [opened];
  }
  const notFound = !candidates.length;
  if (notFound) candidates = visible;
  let time = input.choice || ordinalFollowUp ? input.previous?.time : undefined;
  let suggestTime = !notFound && (!!finding || !!((input.choice || ordinalFollowUp) && input.previous?.suggestTime));
  let suggestDate = suggestTime && (input.choice || ordinalFollowUp) ? input.previous?.suggestDate : undefined;
  let timeError: string | undefined;
  if (finding?.groups?.day) {
    suggestDate = requestedDate(finding.groups.day, input.now ?? Date.now());
    if (!suggestDate) {
      suggestTime = false;
      timeError = '目前可尋找今天起七天內的課間空堂，請重新指定有效日期，或自行填寫準備時段。';
    }
  }
  const parts = selectedTime ? selectedTime.slice(1) : dated
    ? (datedIndex === 1 || datedIndex === 2 ? dated.slice(1, 4) : dated.slice(2, 5)) : undefined;
  if (parts) {
    suggestTime = false;
    suggestDate = undefined;
    const parsed = parseAssistantCalendarIntent(`安排 ${parts[0]} ${parts[1]} 到 ${parts[2]} 作業準備`, input.now ?? Date.now());
    if (parsed?.kind === 'draft') time = {
      date: parsed.event.date, startTime: parsed.event.startTime!, endTime: parsed.event.endTime!,
    };
    else { time = undefined; timeError = parsed?.kind === 'invalid' ? parsed.message : '請填寫有效日期與起訖時間。'; }
  }
  // An unrecognized partial phrase may open the form, but cannot silently pick
  // a source or reuse an earlier time as a complete newly reviewed instruction.
  const incomplete = !input.choice && !simple && !finding && !dated && !ordinalFollowUp && !selectedTime;
  if (incomplete) {
    time = undefined;
    suggestTime = false;
    suggestDate = undefined;
    candidates = visible;
  }
  const assignmentIds = candidates.map((row) => row.id);
  let content = notFound ? '找不到指定的作業，請依名稱與期限重新選擇。' : timeError ??
      (assignmentIds.length > 1 ? '要替哪一份作業安排準備時間？請依清單選擇。'
        : time ? '請核對作業來源與準備時段，再確認建立個人行程。'
          : suggestTime ? `會依這台手機已存課表與個人行程尋找${suggestDate ? ` ${suggestDate} 的` : ''} 30 分鐘空堂，請選擇時段後再確認建立。` : instructions);
  if (list && assignmentIds.length > 1) content += '\n' + candidates.map((row, index) => {
    const item = list.assignments.find((entry) => entry.id === row.id)!;
    return `${index + 1}. ${item.title}（${item.courseName}）`;
  }).join('\n') + '\n可以回覆「第一份」或「第二份」，我會重新核對選定的原作業。';
  return {
    content, ...source,
    courseworkStudy: { assignmentIds, ...(time && { time }), ...(suggestTime && { suggestTime: true }),
      ...(suggestTime && suggestDate && { suggestDate }), ...(list && (notFound || incomplete) && { chooseSource: true }) },
  };
}
