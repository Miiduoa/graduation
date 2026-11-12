import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { createCourseAccess } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { loadNuniStudyAgenda, studyTaskStatus } from '@campus/shared/src/nuniStudyAgenda';
import { readAssistantTimetable } from './assistantTimetableSource';
import { outsideAssignmentNames, parseAssignmentDeadlineWindow, type AssignmentDeadlineWindow } from './assignmentDeadlineWindow';
import { scheduledClassTimeLabel, taipeiDayNumber } from './campusStudyAgenda';
import { scheduledSavedClasses } from './nextSavedClasses';
import type { buildNuniCampusPlan } from './nuniCampusPlanner';
import { isAssignmentDeadlineQuestion, queryAssignmentDeadlines } from './queryAssignmentDeadlines';

type ReadInput = Parameters<typeof buildNuniCampusPlan>[0];
type DataIntent = 'timetable' | 'assignments' | 'quizzes';
type DataReply = { content: string; tool: 'platform-data' };
const DAY = 86_400_000;
const TIMETABLE_PERIOD = /今天|今日|明天|明日|後天|昨天|昨日|(?:接下來|未來)[七7]天|[上下本這]?(?:週|周|星期|禮拜)[一二三四五六日天末]?/g;

/** Every remaining word must describe the supported request, with no discarded subject or clock constraint. */
function genericDataRequest(question: string, now: number): { text: string; window: AssignmentDeadlineWindow | null } | null {
  if (!Number.isFinite(now) || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let text = question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？]+$/u, '');
  const periods = [...text.matchAll(TIMETABLE_PERIOD)];
  if (periods.length > 1) return null;
  const requested = parseAssignmentDeadlineWindow(text, now);
  if (requested === 'clarify' || (periods.length && !requested)) return null;
  if (periods.length) {
    const period = periods[0];
    text = text.slice(0, period.index!) + text.slice(period.index! + period[0].length);
  }
  text = text
    .replace(/^(?:(?:請問|請|麻煩|可以|能不能|可不可以|幫我|替我|告訴我|我想|我要|想知道|查看|查詢|查一下|查|看看|看|列出|整理|我的?|的|一下))+/u, '')
    .replace(/(?:一下|好嗎|可以嗎|嗎|呢|謝謝)$/u, '');
  return { text, window: requested };
}

function supportedTimetableWindow(question: string, now: number): AssignmentDeadlineWindow | null {
  const request = genericDataRequest(question, now);
  if (!request || !/^(?:課表(?:有哪些|是什麼|有什麼|有幾堂課?)?|(?:有|要上|上)?(?:哪些|什麼|哪幾(?:堂|門)?|幾堂)(?:的)?課(?:程)?|(?:有沒有|有|要上|上)課)$/u.test(request.text)) return null;
  const today = taipeiDayNumber(now);
  return request.window ?? { startDay: today, endDay: today + 7, label: '接下來七天' };
}

/** Data requests must reach an authorized reader before the platform help fallback. */
export function nuniAssistantDataIntent(question: string): DataIntent | null {
  // Deadline wording is shared by assignments and quizzes; keep their source kinds distinct.
  if (/測驗|小考|考試|作答|考卷|交卷/.test(outsideAssignmentNames(question.normalize('NFKC')))) {
    const request = genericDataRequest(question, Date.now());
    return request && /^(?:測驗(?:有哪些|有什麼|何時截止|什麼時候截止|哪天截止|幾點截止|截止(?:時間|日期)?(?:是什麼)?|期限(?:是什麼)?)?|(?:有|還有)?(?:哪些|什麼|幾(?:個|份|項))(?:待答|未作答|尚未作答)?測驗|(?:待答|未作答|尚未作答)的?測驗(?:有哪些|有什麼)?|(?:有|還有)測驗(?:要作答)?)$/u.test(request.text)
      ? 'quizzes' : null;
  }
  if (isAssignmentDeadlineQuestion(question)) return 'assignments';
  return supportedTimetableWindow(question, Date.now()) ? 'timetable' : null;
}

function current(input: ReadInput): boolean {
  return !input.signal?.aborted && input.platformTimetable.isCurrent() &&
    (!input.isCurrent || input.isCurrent());
}

function reply(content: string): DataReply { return { content, tool: 'platform-data' }; }

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

async function readTimetable(input: ReadInput, now: number): Promise<DataReply | null> {
  const window = supportedTimetableWindow(input.question, now);
  if (!window) return null;
  let source: Awaited<ReturnType<typeof readAssistantTimetable>>;
  try { source = await readAssistantTimetable('', input.schoolId, input.platformTimetable); }
  catch {
    return current(input) ? reply('目前讀不到這個帳號已保存的課表，請稍後再查；這次無法判斷哪些時間有課。') : null;
  }
  if (!current(input)) return null;
  const schoolId = toPublicSchoolId(input.schoolId) || input.schoolId;
  if (!source || source.schoolId !== schoolId || source.records.some((row) => row.schoolId !== schoolId)) {
    return reply('這個帳號在目前學校還沒有可核對的手機課表。先匯入或保存課表後，我就能直接列出上課時間與教室。');
  }
  const lines: string[] = [];
  let count = 0;
  for (let day = window.startDay; day < window.endDay; day++) {
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    const entries = scheduledSavedClasses(source.records, schoolId, date);
    if (!entries || entries.length > 80) {
      return reply('已保存的課表有學期或上課時間無法核對，這次不能完整列出課程。請先補齊課表中的日期與時間，再重新查詢。');
    }
    if (!entries.length) continue;
    lines.push(date + '（週' + '日一二三四五六'[new Date(day * DAY).getUTCDay()] + '）');
    for (const entry of entries) {
      count++;
      const time = scheduledClassTimeLabel({ startAt: new Date(entry.startAt).toISOString(), endAt: new Date(entry.endAt).toISOString() }, date);
      lines.push('• ' + time + '｜' + entry.row.title + '｜' + (entry.row.location || '教室未填'));
    }
  }
  return reply([
    count ? `${window.label}的課表如下：` : `${window.label}的已保存課表沒有排課。`,
    ...lines,
    '依這個帳號的手機課表與已保存的單日調整列出；校方臨時變更仍需更新課表。',
  ].join('\n'));
}

/** Read joined student courses without requiring an unrelated timetable import first. */
async function readCoursework(input: ReadInput, now: number, intent: 'assignments' | 'quizzes'): Promise<DataReply | null> {
  const quiz = intent === 'quizzes';
  const name = quiz ? '測驗' : '作業';
  const pendingName = quiz ? '待作答測驗' : '待交作業';
  const timing = quiz ? '參考期限' : '截止';
  const unavailable = () => reply(`目前無法取得這個帳號在所選校園的${name}，還不能判定是否有${pendingName}。`);
  if (!input.request || !input.bffRequest) return unavailable();
  const assertCurrent = () => { if (!current(input)) throw new NuniError(409, 'SESSION_CHANGED'); };
  const request = async (path: string, body?: Record<string, unknown>) => {
    assertCurrent();
    const value = path.endsWith('/assignments')
      ? await input.bffRequest!(path) : await input.request!(path, body);
    assertCurrent();
    return value;
  };
  let agenda: Exclude<Awaited<ReturnType<typeof loadNuniStudyAgenda>>, 'cancelled'>;
  let unchecked = 0;
  try {
    const classes = createNuniClasses(request, input.platformTimetable.accountId);
    const directory = createCourseAccess(request);
    const all = await classes.list();
    assertCurrent();
    if (new Set(all.map((item) => item.id)).size !== all.length) return unavailable();
    const memberships = all.filter((item) => item.state === 'active' && item.memberRole === 'student')
      .sort((a, b) => a.id.localeCompare(b.id));
    unchecked = Math.max(0, memberships.length - 12);
    const eligible: NuniWorkspace[] = [];
    for (const workspace of memberships.slice(0, 12)) {
      try {
        const detail = await directory.workspace(workspace.id, toPublicSchoolId(input.schoolId) || input.schoolId);
        assertCurrent();
        if (detail.status === 'reviewed' && detail.memberRole === 'student') {
          eligible.push({ ...workspace, title: detail.course.title });
        } else unchecked++;
      } catch (error) {
        assertCurrent();
        if (error && typeof error === 'object' && ('statusCode' in error && error.statusCode === 401 ||
            'status' in error && error.status === 401 || 'code' in error && error.code === 'SESSION_CHANGED')) throw error;
        unchecked++;
      }
    }
    if (!eligible.length) return memberships.length ? unavailable()
      : reply(`目前帳號沒有可讀取的學生課程。加入 nuni 課程後，就能直接查各課${pendingName}，不必先匯入課表。`);
    const loaded = await loadNuniStudyAgenda(classes, eligible, { cancelled: () => !current(input) });
    assertCurrent();
    if (loaded === 'cancelled') return null;
    agenda = loaded;
  } catch {
    return current(input) ? unavailable() : null;
  }
  const tasks = agenda.tasks.filter((item) => item.kind === (quiz ? 'quiz' : 'assignment'));
  if (!tasks.length && agenda.failedCourseIds.length === agenda.studiedCourseCount) return unavailable();
  // The shared parser verifies each receipt belongs to the current account.
  const pending = tasks.filter((item) => studyTaskStatus(item) === 'pending')
    .map((item) => ({ ...item, groupName: item.courseTitle }));
  // Quiz reads only accept generic lists above, so no course/title filter is dropped here.
  const filter = quiz ? '' : input.question;
  const result = queryAssignmentDeadlines(pending, input.question, now, filter);
  if (result.kind === 'clarify') return reply(`請指定要查哪一天或哪一週${timing}的${name}，例如「明天」、「下週五」或「未來七天」。`);
  const details = [result.scope, result.window && result.window.label + timing, result.status].filter(Boolean).join('、');
  const incomplete = unchecked + agenda.failedCourseIds.length + agenda.limitedCourseIds.length > 0;
  const heading = (incomplete ? '在本次成功讀取的範圍中，' : '') +
    (details ? `符合「${details}」的` : '') + `${pendingName}有 ${result.rows.length} 筆。`;
  const lines = result.rows.slice(0, 30).map(({ item, due }, index) =>
    `${index + 1}. ${item.title}（${item.groupName}）｜` +
    (Number.isFinite(due) ? `${due < now ? '已逾期，' : ''}${timing} ${dateTime.format(new Date(due))}` : `${quiz ? timing : '截止時間'}未提供`));
  if (result.rows.length > lines.length) lines.push(`已列出前 ${lines.length} 筆；可以指定課程或截止日期，縮小其餘 ${result.rows.length - lines.length} 筆的範圍。`);
  if (result.window && result.undated) lines.push(`另有 ${result.undated} 筆未提供${quiz ? timing : '截止時間'}，未列入這段日期。`);
  const closed = queryAssignmentDeadlines(tasks.filter((item) => studyTaskStatus(item) === 'closed')
    .map((item) => ({ ...item, groupName: item.courseTitle })), input.question, now, filter);
  if (closed.kind === 'results' && closed.rows.length) {
    lines.push(`另有 ${closed.rows.length} 筆符合條件的${name}${quiz ? '未作答' : '未交'}且已關閉，請向老師確認${quiz ? '後續安排' : '補交方式'}；關閉不代表已完成。`);
  }
  lines.push(incomplete
    ? `部分課程來源尚未確認，本次僅列出成功讀取的${pendingName}。`
    : `已核對目前帳號在所選校園的學生課程、開放${name}與${quiz ? '作答' : '繳交'}紀錄。`);
  return reply([heading, ...lines].join('\n'));
}

export async function readNuniAssistantData(input: ReadInput, intent: DataIntent): Promise<DataReply | null> {
  if (!current(input)) return null;
  const now = input.now ?? Date.now();
  return intent === 'timetable' ? readTimetable(input, now) : readCoursework(input, now, intent);
}
