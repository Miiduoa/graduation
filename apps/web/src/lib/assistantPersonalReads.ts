'use client';

import { buildPersonalToday } from '@campus/shared/src/imports/today';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { manualClassRecords, withClassExceptions, classDate, validClassDate } from '@campus/shared/src/timetable/classExceptions';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { resolveAssistantServiceIntent } from '@campus/shared/src/assistantServices';
import { createNuniClasses, type NuniWorkspace } from '@campus/shared/src/nuni';
import { courseScope } from '@campus/shared/src/courseAccess';
import { currentSemesterStartUtc, rocSchoolYear } from '@campus/shared/src/campusAnnouncementQuality';
import { createCourseAccess } from '@campus/shared/src/courseAccessClient';
import { loadNuniStudyAgenda, sortStudyTasks, studyTaskStatus } from '@campus/shared/src/nuniStudyAgenda';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { browserRequest } from '@/features/nuni/Session';
import { readPersonalImports, type PersonalImportScope } from './personalImports';
import { loadPersonalTimetable } from './timetable/store';
import type { LocalAssistantResult } from './assistantLocalActions';

type ReadIntent = {
  kind: 'schedule' | 'calendar' | 'coursework';
  next: boolean;
  current: boolean;
  submitted: boolean;
  taskKind?: 'assignment' | 'quiz';
  hours?: [number, number];
  from?: string;
  to?: string;
};
const DAY = 86400000;
const addDays = (day: string, offset: number) => classDate(new Date(Date.parse(day + 'T12:00:00+08:00') + offset * DAY));
const clean = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');

/** Recognizes direct reads only. Mixed requests and mutations stay with the action engine. */
export function personalAssistantReadIntent(question: string, now = new Date()): ReadIntent | null {
  if (question.length > 500 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question) || !Number.isFinite(now.getTime())) return null;
  const text = question.normalize('NFKC').trim();
  if (!text || resolveAssistantServiceIntent(text) ||
      /[「」『』“”"`]|不要|不用|不必|別查|不是要|假設|翻譯|新增|建立|刪除|修改|安排|幫我排|替我排|加入|送出|提交|提醒我|幫我(?:交|繳)|預約|下單|訂餐|順便|然後|並且|另外/.test(text)) return null;
  // Do not answer only one half of a question that also asks for another service.
  if (/公車|餐廳|圖書館|訂單|社團|訊息|公告|成績|學分/.test(text)) return null;
  const coursework = /作業|測驗|待辦|要交|要繳/.test(text);
  const schedule = /課表|下一堂|下堂課|什麼課|哪些課|幾堂|有課|上課|課在哪|教室/.test(text);
  const calendar = /行事曆|行程|個人活動/.test(text);
  if (Number(coursework) + Number(schedule) + Number(calendar) !== 1) return null;
  if (!/查|看|列|整理|哪些|什麼|多少|幾|何時|哪|有沒有|還有|未交|沒交|待交|待辦|要交|要繳|交了|已交|已繳|截止|期限|我的|下一堂|下堂課|課表/.test(text)) return null;
  const today = classDate(now);
  const temporal = text.match(/後天|明天|明日|今天|今日|今晚|(?:這|本|下)(?:週|周|禮拜|星期)|未來(?:七|7)天|接下來(?:七|7)天|\d{4}[-/]\d{1,2}[-/]\d{1,2}/g) ?? [];
  if (temporal.length > 1 || /(?:週|周|禮拜|星期)[一二三四五六日天1-7]|\d{1,2}[:：]\d{2}|昨天|前天/.test(text)) return null;
  const submitted = coursework && /已交|已繳|交了|交過|已完成|已作答/.test(text) && !/未交|沒交|還沒/.test(text);
  // Submitted-on and due-on are different questions; keep dated submission requests with the full engine.
  if (submitted && temporal.length) return null;
  const generic = text.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '')
    .replace(/(?:這|本|下)(?:週|周|禮拜|星期)|未來(?:七|7)天|接下來(?:七|7)天|後天|明天|明日|今天|今日|今晚/g, '')
    .replace(/早上|上午|中午|下午|晚上/g, '')
    .replace(/什麼時候|截止日期|已繳交|未繳交|還沒交|還沒繳|已作答|已完成|個人活動|個人|行事曆|下一堂課|下一堂|下堂課|有沒有|要完成|多少|幾堂|幾節|哪些|什麼|何時|哪裡|幾點|截止|期限|要交|要繳|要做|交了|交過|已交|已繳|未交|沒交|待交|待辦|課表|課程|上課|教室|作業|測驗|行程|我的|幫我|請問|麻煩|請|查詢|查看|查|看看|看|一下|整理|列出|告訴我|現在|目前|正在|還有|全部|所有|剩下|幾個|幾份|多少份|時間|開始|結束|我|的|有|在|到|嗎|呢|是|課|了|要|得|哪|上/g, '')
    .replace(/[\s?!.。！？,，、]/g, '');
  if (generic) return null;
  let from: string | undefined;
  let to: string | undefined;
  const explicit = [...text.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)];
  if (explicit.length > 1) return null;
  if (explicit.length) {
    from = explicit[0][0].split(/[-/]/).map((part, index) => index ? part.padStart(2, '0') : part).join('-');
    if (!validClassDate(from)) return null;
    to = from;
  } else if (/(?:這|本|下)(?:週|周|禮拜|星期)/.test(text)) {
    const weekday = new Date(today + 'T12:00:00+08:00').getUTCDay() || 7;
    from = addDays(today, 1 - weekday + (/下(?:週|周|禮拜|星期)/.test(text) ? 7 : 0));
    to = addDays(from, 6);
  } else if (/未來(?:七|7)天|接下來(?:七|7)天/.test(text)) {
    from = today;
    to = addDays(today, 6);
  } else if (/後天|明天|明日|今天|今日|今晚/.test(text)) {
    from = addDays(today, /後天/.test(text) ? 2 : /明天|明日/.test(text) ? 1 : 0);
    to = from;
  } else if (/昨天|前天|\d+月|\d+\/\d+|星期[一二三四五六日天]|週[一二三四五六日天]|下個月|下月|本月|這個月/.test(text)) return null;
  if (!coursework && !from) from = to = today;
  const next = schedule && /下一堂|下堂課/.test(text);
  const current = schedule && /現在(?:在)?(?:上|有|是)|目前(?:正)?在上|正在上/.test(text);
  if (current && (next || from !== today || to !== today)) return null;
  if ((text.match(/早上|上午|中午|下午|晚上|今晚/g) ?? []).length > 1) return null;
  if (next && from === today) to = addDays(today, 7);
  const hours: [number, number] | undefined = /早上|上午/.test(text) ? [0, 12] : /中午/.test(text) ? [11, 14] :
    /下午/.test(text) ? [12, 18] : /晚上|今晚/.test(text) ? [18, 24] : undefined;
  if (coursework && hours) return null;
  return {
    kind: coursework ? 'coursework' : schedule ? 'schedule' : 'calendar',
    next,
    current,
    submitted,
    ...(coursework && /作業/.test(text) && !/測驗/.test(text) ? { taskKind: 'assignment' as const } : {}),
    ...(coursework && /測驗/.test(text) && !/作業/.test(text) ? { taskKind: 'quiz' as const } : {}),
    from, to, hours,
  };
}

export function canAnswerAssistantPersonalQuestion(question: string): boolean {
  return personalAssistantReadIntent(question) !== null;
}

const sessionFailure = (error: unknown) => {
  const value = error as { status?: number; code?: string };
  return value?.status === 401 || value?.code === 'SESSION_CHANGED';
};

/** Uses the same account-scoped stores and API contracts as the destination screens. No model call or write. */
export async function answerAssistantPersonalQuestion(
  question: string,
  scope: PersonalImportScope,
  options: { context: string; signal: AbortSignal; now?: Date; fallbackOnMissing?: boolean },
): Promise<LocalAssistantResult | null> {
  const now = options.now ?? new Date();
  const intent = personalAssistantReadIntent(question, now);
  if (!intent) return null;
  const assertActive = () => { if (options.signal.aborted) throw new DOMException('已取消', 'AbortError'); };
  assertActive();
  if (!/^platform:[^\s:][^\r\n]{0,199}$/.test(scope.owner) || !scope.schoolId || !options.context)
    throw new Error('請先確認登入帳號與校園，再查詢個人資料。');
  const result = (content: string, serviceIds: LocalAssistantResult['serviceIds']): LocalAssistantResult => ({
    kind: 'personal', content, serviceIds,
  });
  if (intent.kind === 'coursework') {
    const account = scope.owner.slice(9);
    // A read may use POST for its scoped query, but only these read contracts are reachable.
    const request = async (path: string, input?: Record<string, unknown>) => {
      assertActive();
      const value = await browserRequest(path, options.context, input);
      assertActive();
      return value;
    };
    const classes = createNuniClasses(request, account);
    const access = createCourseAccess(request);
    try {
      const memberships = (await classes.list()).filter((course) => course.state === 'active' && course.memberRole === 'student');
      assertActive();
      const eligible: NuniWorkspace[] = [];
      let unchecked = Math.max(0, memberships.length - 12);
      // Bound requests and retain uncertainty for courses whose campus binding is unavailable.
      for (const workspace of memberships.slice(0, 12)) {
        try {
          const receipt = await access.workspace(workspace.id, scope.schoolId);
          assertActive();
          if (receipt.status === 'reviewed' && receipt.memberRole === 'student')
            eligible.push({ ...workspace, title: receipt.course.title });
          else unchecked++;
        } catch (error) {
          assertActive();
          if (sessionFailure(error)) throw error;
          unchecked++;
        }
      }
      const agenda = await loadNuniStudyAgenda(classes, eligible, { cancelled: () => options.signal.aborted });
      assertActive();
      if (agenda === 'cancelled') throw new DOMException('已取消', 'AbortError');
      const partial = unchecked + agenda.failedCourseIds.length + agenda.limitedCourseIds.length > 0;
      const tasks = sortStudyTasks(agenda.tasks, now).filter((task) => {
        const submitted = ['submitted', 'feedback'].includes(studyTaskStatus(task));
        const day = task.dueAt ? classDate(new Date(task.dueAt)) : null;
        return submitted === intent.submitted && (!intent.taskKind || task.kind === intent.taskKind) &&
          (!intent.from || (day !== null && day >= intent.from && day <= intent.to!));
      });
      const range = intent.from ? `${intent.from}${intent.to !== intent.from ? '～' + intent.to : ''} 截止的` : '';
      const heading = `${range}${intent.submitted ? '已繳交／作答' : '未繳交／作答'}項目`;
      const lines = [`已查詢此帳號在所選校園可核對的 ${eligible.length} 門 nuni 課程。`];
      if (tasks.length) {
        lines.push(`${heading}共 ${tasks.length} 項：`);
        for (const task of tasks.slice(0, 12)) {
          const status = intent.submitted ? '已交' : task.state === 'closed' ? '已停止收件，未交' : '未交';
          const due = task.dueAt ? formatTaipeiDateTime(task.dueAt, { seconds: false }) : '未設定截止時間';
          const overdue = !intent.submitted && task.dueAt && Date.parse(task.dueAt) < now.getTime() ? '，已過截止時間' : '';
          lines.push(`- ${clean(task.courseTitle)}｜${clean(task.title)}（${task.kind === 'quiz' ? '測驗' : '作業'}）：${status}；${due}${overdue}。`);
        }
        if (tasks.length > 12) lines.push(`先列出 12 項，其餘 ${tasks.length - 12} 項可在課程與作業查看。`);
      } else if (partial) lines.push(`已取得的資料中沒有符合的${heading}；仍有課程未查完整，不能判定全部完成。`);
      else if (!eligible.length) lines.push('目前沒有可核對的學生課程，請先加入或連結課程。');
      else lines.push(`這次查詢沒有符合的${heading}。`);
      if (partial && tasks.length) lines.push('部分課程的來源尚未查完整；以上只列已核對的項目。');
      if (intent.from && agenda.tasks.some((task) => !task.dueAt && !task.submittedAt))
        lines.push('另有未設定截止日期的項目，未列入這段日期。');
      lines.push(`查詢時間：${formatTaipeiDateTime(now, { seconds: false })}。`);
      return result(lines.join('\n'), ['classroom']);
    } catch (error) {
      assertActive();
      if (sessionFailure(error)) throw new Error('登入狀態已變更，請重新登入後再查詢。');
      return result('這次無法讀取課程與作業資料，尚未確認有哪些未交項目。請稍後重試；不會把讀取失敗當成沒有作業。', ['classroom']);
    }
  }
  let imported: PersonalImportRecord[] = [];
  let unavailable = false;
  try { imported = readPersonalImports(scope); } catch { unavailable = true; }
  assertActive();
  if (intent.kind === 'calendar') {
    if (unavailable) return result('目前無法讀取這個帳號的個人行程，尚未確認這段時間是否有安排。原始資料仍保留。', ['calendar']);
    const events = imported.filter((row) => row.kind === 'events');
    if (!events.length && options.fallbackOnMissing) return null;
    const matches = events.filter((row) => {
      if (!row.date) return false;
      const start = Date.parse(`${row.date}T${row.allDay ? '00:00' : row.startTime}:00+08:00`);
      const endDate = row.allDay ? exclusiveAllDayEnd(row.date, row.endDate) : row.endDate || row.date;
      const end = Date.parse(`${endDate}T${row.allDay ? '00:00' : row.endTime}:00+08:00`);
      for (let day = intent.from!; day <= intent.to!; day = addDays(day, 1)) {
        const midnight = Date.parse(day + 'T00:00:00+08:00');
        if (start < midnight + (intent.hours?.[1] ?? 24) * 3600000 && end > midnight + (intent.hours?.[0] ?? 0) * 3600000) return true;
      }
      return false;
    })
      .sort((a, b) => (a.date! + (a.startTime || '')).localeCompare(b.date! + (b.startTime || '')));
    const lines = [`${intent.from}${intent.to !== intent.from ? '～' + intent.to : ''} 的個人行程：`];
    for (const row of matches.slice(0, 15))
      lines.push(`- ${row.date} ${row.allDay ? '全天' : `${row.startTime}–${row.endTime}`}${row.endDate && row.endDate !== row.date ? `（${row.allDay ? '結束日不含當天：' : '至'}${row.endDate}）` : ''}｜${clean(row.title)}${row.location ? '｜' + clean(row.location) : ''}`);
    if (!matches.length) lines.push('這個帳號在此瀏覽器保存的個人行程中，沒有這段日期的紀錄。');
    if (matches.length > 15) lines.push(`另有 ${matches.length - 15} 項，請在個人行事曆查看。`);
    lines.push('資料來源：此帳號在此瀏覽器保存的個人行程。');
    return result(lines.join('\n'), ['calendar']);
  }
  try {
    const manual = await loadPersonalTimetable(null, scope.schoolId, scope.owner);
    assertActive();
    imported = withClassExceptions([...imported, ...manualClassRecords(manual)], manual.classExceptions);
  } catch {
    assertActive();
    unavailable = true;
  }
  const courses = imported.filter((row) => row.kind === 'timetable');
  if (!courses.length && !unavailable && options.fallbackOnMissing) return null;
  const entries: ReturnType<typeof buildPersonalToday>['today'] = [];
  let unplaced = 0;
  let term = '';
  const seen = new Set<string>();
  for (let day = intent.from!; day <= intent.to!; day = addDays(day, 1)) {
    const date = new Date(day + 'T12:00:00+08:00');
    term = `${rocSchoolYear(date)}|${currentSemesterStartUtc(date).getUTCMonth() === 7 ? '1' : '2'}`;
    const termRows = courses.flatMap((row) => {
      try {
        const normalized = courseScope(row);
        return `${normalized.academicYear}|${normalized.semester}` === term
          ? [{ ...row, academicYear: normalized.academicYear, semester: normalized.semester }] : [];
      } catch { return []; }
    });
    if (!termRows.length) { unavailable = courses.length > 0 || unavailable; continue; }
    const summary = buildPersonalToday(termRows, {
      schoolId: scope.schoolId, now: day === classDate(now) ? now : new Date(day + 'T00:00:00+08:00'),
    });
    term = summary.termKey;
    unplaced = Math.max(unplaced, summary.unplacedCount);
    const midnight = Date.parse(day + 'T00:00:00+08:00');
    for (const entry of summary.today) {
      const key = JSON.stringify([entry.row.id, entry.startAt, entry.endAt]);
      if (seen.has(key) || (intent.next && entry.startAt < now.getTime()) ||
          (intent.current && !(entry.startAt <= now.getTime() && entry.endAt > now.getTime())) ||
          (intent.hours && (entry.endAt <= midnight + intent.hours[0] * 3600000 || entry.startAt >= midnight + intent.hours[1] * 3600000))) continue;
      entries.push(entry);
      seen.add(key);
    }
  }
  const visible = intent.next ? entries.slice(0, 1) : entries.slice(0, 20);
  const lines = [`${intent.current ? '目前時段的課程' : intent.next ? '接下來的課程' : `${intent.from}${intent.to !== intent.from ? '～' + intent.to : ''} 的課表`}：`];
  for (const entry of visible) {
    const startDay = classDate(new Date(entry.startAt)), endDay = classDate(new Date(entry.endAt));
    lines.push(`- ${startDay} ${entry.startTime}–${endDay !== startDay ? endDay + ' ' : ''}${entry.endTime}｜${clean(entry.row.title)}｜${clean(entry.row.location || '教室未填寫')}${entry.conflict ? '（時段重疊）' : ''}`);
  }
  if (!visible.length) lines.push(unavailable ? '課表來源尚未完整取得，或沒有這段日期所屬學期的課表，現在無法確認是否有課。' :
    !courses.length ? '這個帳號還沒有保存可讀取的課表。' : unplaced ? '有課程尚缺上課時間，現在無法完整列出。' :
      intent.current ? '目前保存的課表在這個時間沒有排課。' : intent.next ? '這段日期內沒有尚未開始的課程。' : '目前保存的課表在這段日期沒有排課。');
  if (unavailable && visible.length) lines.push('部分課表來源暫時讀不到，以上只列已讀到的內容。');
  if (unplaced) lines.push(`另有 ${unplaced} 門課缺少可判定的時間，未列入。`);
  if (!intent.next && entries.length > 20) lines.push(`先列出 20 堂，其餘 ${entries.length - 20} 堂可在課表查看。`);
  lines.push(`資料來源：此帳號在此瀏覽器保存的課表${term ? `（${clean(term.replace('|', ' 學年第 '))} 學期）` : ''}，已套用保存的停課與調課紀錄。`);
  return result(lines.join('\n'), ['timetable']);
}
