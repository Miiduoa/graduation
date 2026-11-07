import type { PersonalImportRecord } from '@campus/shared';
import { currentSemesterStartUtc, rocSchoolYear } from '@campus/shared/src/campusAnnouncementQuality';
import { CourseAccessError, courseScope, sameCourseScope } from '@campus/shared/src/courseAccess';
import { createCourseAccess, type CourseTransport } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { readAssistantTimetable, type PlatformTimetableAccess } from './assistantTimetableSource';
import { buildCampusStudyAgenda, formatCampusStudyAgenda, resolveStudyWindow, scheduledClassTimeLabel, taipeiDayNumber } from './campusStudyAgenda';
import { inspectCampusClockAvailability, selectCampusClockStudySlot, type CampusClockInterval } from './campusClockAvailability';
import { scheduledSavedClasses } from './nextSavedClasses';
import type { CampusEvidencePlan, CampusPlanPriority, CampusPlanStep } from './offlineCampusPlanner';
import type { CampusPlanComparisonBasis } from './campusPlanComparison';
import { savedPlanTimestamp } from './savedCampusPlanValidation';
import type { NuniPlanAssignmentSource, NuniPlanQuizSource } from './nuniPlanAssignmentTarget';

type TimetableSource = Awaited<ReturnType<typeof readAssistantTimetable>>;
type PlanInput = {
  question: string;
  schoolId: string;
  platformTimetable: PlatformTimetableAccess;
  request?: CourseTransport;
  bffRequest?: (path: string) => Promise<unknown>;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  now?: number;
};
type CourseworkKind = 'assignment' | 'quiz';
type CourseworkTask = {
  kind: CourseworkKind;
  workspaceId: string;
  id: string;
  title: string;
  groupName: string;
  dueAt: string | null;
  pending: boolean;
  nuniSource?: NuniPlanAssignmentSource;
  nuniQuizSource?: NuniPlanQuizSource;
};
type CourseworkSource = {
  basis: CampusPlanComparisonBasis['assignments'];
  pending: CourseworkTask[];
  limitations: string[];
};
type CourseworkSources = {
  assignments: CourseworkSource;
  quizzes: CourseworkSource;
  limitations: string[];
};
type SourceReadState = {
  incomplete: boolean;
  failures: number;
  limited: boolean;
  successful: number;
  tasks: CourseworkTask[];
};
const DAY = 86_400_000;
const MAX_WORKSPACES = 12;
const MAX_COURSEWORK = 400;
const MAX_DAILY_CLASSES = 80;
const CLASS_BUFFER = 10 * 60_000;

export function isNuniCampusPlanningQuestion(question: string): boolean {
  const planning = /安排|規劃|計畫|今日重點|今天要做|今天要先|今天先做|今天該做|先處理|先完成|優先順序|待辦摘要|校園摘要|本週重點|這週重點|接下來七天|未來七天|讀書進度|怎麼分配/.test(question);
  const scope = /今天|明天|今日|這週|本週|下週|下星期|下禮拜|七天|7天|課表|空堂|作業|測驗|小考|待答|待交|待繳|截止|參考期限|學習|讀書|複習|報告|待辦|校園/.test(question);
  const write = /(?:幫我|替我|直接|立刻).{0,22}(?:送出|提交|交卷|代答|代考|請假|下單|付款|發訊息|訂餐|報修|刪除|改成已讀)|(?:幫我|替我|直接|自動)(?:作答|答題)/.test(question);
  return planning && scope && !write;
}

function assertCurrent(input: PlanInput): void {
  if (input.signal?.aborted || !input.platformTimetable.accountId ||
      !input.platformTimetable.isCurrent() || (input.isCurrent && !input.isCurrent())) {
    throw new NuniError(409, 'SESSION_CHANGED');
  }
}
function cancelled(error: unknown): boolean {
  return (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED')) ||
    (error instanceof CourseAccessError && error.statusCode === 401);
}
function confirmedTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try { return savedPlanTimestamp(value); } catch { return null; }
}
function label(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}
function termAt(timestamp: number): string {
  const date = new Date(timestamp);
  return `${rocSchoolYear(date)}|${currentSemesterStartUtc(date).getUTCMonth() === 7 ? '1' : '2'}`;
}
function sameSource(before: TimetableSource, after: TimetableSource): boolean {
  // Only compare in memory; raw imported text never goes into the returned plan.
  return before?.schoolId === after?.schoolId && before?.updatedAt === after?.updatedAt &&
    JSON.stringify(before?.records) === JSON.stringify(after?.records);
}

function unavailable(detail?: string): CourseworkSource {
  return {
    basis: { status: 'unavailable', checkedAt: null, total: null, items: [] },
    pending: [], limitations: detail ? [detail] : [],
  };
}

function unavailableCoursework(detail: string): CourseworkSources {
  return { assignments: unavailable(), quizzes: unavailable(), limitations: [detail] };
}

function compareCoursework(a: CourseworkTask, b: CourseworkTask): number {
  return Number(b.pending) - Number(a.pending) ||
    (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
    a.workspaceId.localeCompare(b.workspaceId) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}

async function readCoursework(input: PlanInput, records: PersonalImportRecord[], schoolId: string,
  terms: ReadonlySet<string>, checkedAt: string): Promise<CourseworkSources> {
  const currentRows = records.filter((row) => {
    try {
      const scope = courseScope(row);
      return row.kind === 'timetable' && scope.schoolId === schoolId && terms.has(`${scope.academicYear}|${scope.semester}`);
    } catch { return false; }
  });
  const linked = new Map<string, PersonalImportRecord[]>();
  for (const row of currentRows) {
    if (!row.linkedCourseId) continue;
    const rows = linked.get(row.linkedCourseId) ?? [];
    rows.push(row);
    linked.set(row.linkedCourseId, rows);
  }
  if (!linked.size) return unavailableCoursework('目前課表尚未連結可核對的 nuni 課程，無法判斷是否有作業或測驗待辦；請先在課程頁確認連結。');
  if (!input.request) return unavailableCoursework('目前無法連線查詢 nuni 作業與測驗；本次計畫僅能使用手機課表副本。');

  const read = input.request;
  const bff = input.bffRequest;
  let stopped = false;
  const assertReading = () => {
    assertCurrent(input);
    if (stopped) throw new NuniError(409, 'SESSION_CHANGED');
  };
  // Follow the course screen's transport boundary: assignments use its BFF,
  // while memberships, the course directory and quizzes use the platform API.
  const classes = createNuniClasses(async (path) => {
    assertReading();
    const transport = path.endsWith('/assignments') ? bff : read;
    if (!transport) throw new NuniError(503, 'UNAVAILABLE');
    const result = await transport(path);
    assertReading();
    return result;
  }, input.platformTimetable.accountId);
  let memberships: NuniWorkspace[];
  try {
    memberships = await classes.list();
    assertCurrent(input);
    if (new Set(memberships.map((item) => item.id)).size !== memberships.length) {
      return unavailableCoursework('nuni 課程清單含重複身分，這次無法安全核對作業與測驗來源。');
    }
  } catch (error) {
    assertCurrent(input);
    if (cancelled(error)) throw error;
    return unavailableCoursework('目前無法取得 nuni 課程成員資料，作業與測驗來源尚未確認。');
  }
  const eligible = memberships.filter((item) => linked.has(item.id) && item.state === 'active' && item.memberRole === 'student')
    .sort((a, b) => a.id.localeCompare(b.id));
  const missingLinks = currentRows.some((row) => !row.linkedCourseId);
  const missingMembership = eligible.length !== linked.size;
  const limitedWorkspaces = eligible.length > MAX_WORKSPACES;
  const selected = eligible.slice(0, MAX_WORKSPACES);
  const initialState = (): SourceReadState => ({
    incomplete: missingLinks || missingMembership || limitedWorkspaces,
    failures: 0, limited: false, successful: 0, tasks: [],
  });
  const sources = { assignment: initialState(), quiz: initialState() };
  let bindingFailures = 0;
  let unreviewed = 0;
  let cursor = 0;
  const directory = createCourseAccess(async (path, body) => {
    assertReading();
    const result = await read(path, body);
    assertReading();
    return result;
  });
  const worker = async () => {
    while (!stopped && cursor < selected.length) {
      assertReading();
      const workspace = selected[cursor++];
      const rows = linked.get(workspace.id)!;
      try {
        const detail = await directory.workspace(workspace.id, schoolId);
        assertReading();
        if (detail.memberRole !== 'student' || (detail.status === 'reviewed' &&
            !rows.every((row) => sameCourseScope(courseScope(row), detail.course)))) {
          sources.assignment.incomplete = sources.quiz.incomplete = true;
          bindingFailures++;
          continue;
        }
        if (detail.status === 'unreviewed') {
          unreviewed++;
          sources.assignment.incomplete = sources.quiz.incomplete = true;
        }
      } catch (error) {
        assertCurrent(input);
        if (cancelled(error)) { stopped = true; throw error; }
        sources.assignment.incomplete = sources.quiz.incomplete = true;
        bindingFailures++;
        continue;
      }

      const scope = courseScope(rows[0]);
      const oneScope = rows.every((row) => sameCourseScope(courseScope(row), scope));
      const target = {
        accountId: input.platformTimetable.accountId, schoolId,
        academicYear: scope.academicYear, semester: scope.semester, workspaceId: workspace.id,
      };
      // Keep the two sources independent: a failed quiz read must not erase confirmed
      // assignments, while an expired session revokes all workers and both sources.
      for (const kind of ['assignment', 'quiz'] as const) {
        const state = sources[kind];
        try {
          assertReading();
          const tasks: CourseworkTask[] = kind === 'assignment'
            ? (await classes.assignments(workspace.id)).map((item) => ({
              kind, workspaceId: workspace.id, id: item.id,
              title: label(item.title, 240), groupName: label(workspace.title, 160),
              dueAt: confirmedTime(item.dueAt), pending: item.state === 'open' && item.mySubmission === null,
              ...(oneScope ? { nuniSource: { ...target, assignmentId: item.id } } : {}),
            }))
            : (await classes.quizzes(workspace.id)).map((item) => ({
              kind, workspaceId: workspace.id, id: item.id,
              title: label(item.title, 240), groupName: label(workspace.title, 160),
              dueAt: confirmedTime(item.dueAt), pending: item.state === 'open' && item.myResponse === null,
              ...(oneScope ? { nuniQuizSource: { ...target, quizId: item.id } } : {}),
            }));
          assertReading();
          if (new Set(tasks.map((item) => item.id)).size !== tasks.length) {
            state.incomplete = true;
            state.failures++;
            continue;
          }
          if (tasks.length >= 100) { state.limited = true; state.incomplete = true; }
          state.successful++;
          state.tasks.push(...tasks.slice(0, 100));
        } catch (error) {
          assertCurrent(input);
          if (cancelled(error)) { stopped = true; throw error; }
          state.incomplete = true;
          state.failures++;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  assertCurrent(input);
  const limitations: string[] = [];
  if (missingLinks) limitations.push('部分課表尚未連結 nuni 課程，未依同名自動配對；這些課程的作業與測驗未納入。');
  if (missingMembership) limitations.push('部分已連結課程目前不是有效學生課程，未讀取其作業與測驗；請至課程頁核對身分與連結。');
  if (bindingFailures) limitations.push('部分課程的學校、學期、學生身分或課程來源無法核對，未納入；缺資料不代表已完成。');
  if (unreviewed) limitations.push('部分 nuni 課程尚未經課程目錄核對，僅依你保存的連結與有效學生身分列入。');
  if (limitedWorkspaces) limitations.push(`本次最多查詢 ${MAX_WORKSPACES} 門已連結課程，其餘課程請開啟課程頁核對。`);
  const all = [...sources.assignment.tasks, ...sources.quiz.tasks].sort(compareCoursework);
  if (all.length > MAX_COURSEWORK) {
    limitations.push(`本次保留前 ${MAX_COURSEWORK} 筆作業與測驗資料，超出範圍未納入，請至課程頁核對。`);
  }
  const retained = all.slice(0, MAX_COURSEWORK);
  const finishSource = (kind: CourseworkKind): CourseworkSource => {
    const state = sources[kind];
    const name = kind === 'assignment' ? '作業' : '測驗';
    const notes: string[] = [];
    if (state.failures) notes.push(`部分課程的${name}來源無法核對，未納入；缺資料不代表已完成。`);
    if (state.limited) notes.push(`部分課程的${name}已達來源 100 筆上限，沒有續頁資訊；無法確認是否仍有其他${name}。`);
    if (!state.successful) {
      const result = unavailable(`這次沒有取得可核對的 nuni ${name}來源，無法判斷${name}是否已完成。`);
      result.limitations.push(...notes);
      return result;
    }
    const items = retained.filter((item) => item.kind === kind);
    const incomplete = state.incomplete || items.length !== state.tasks.length;
    if (items.length !== state.tasks.length) notes.push(`${name}資料超出本次保留範圍，清單與變動比對均不完整。`);
    return {
      basis: {
        status: incomplete ? 'partial' : 'complete', checkedAt, total: incomplete ? null : items.length,
        items: items.map((item) => ({ identity: [item.workspaceId, item.id], title: item.title,
          groupName: item.groupName, dueAt: item.dueAt })),
      },
      pending: items.filter((item) => item.pending), limitations: notes,
    };
  };
  return { assignments: finishSource('assignment'), quizzes: finishSource('quiz'), limitations };
}

function priority(dueAt: string | null, now: number): CampusPlanPriority {
  if (!dueAt) return 'verify';
  const remaining = Date.parse(dueAt) - now;
  return remaining < 0 ? 'overdue' : remaining <= DAY ? 'urgent' : remaining <= 3 * DAY ? 'soon' : 'normal';
}
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

/** Platform-only, read-only evidence. No Firebase identity, snapshot or coursework action grant is created. */
export async function buildNuniCampusPlan(input: PlanInput): Promise<CampusEvidencePlan | null> {
  try {
    assertCurrent(input);
    const now = input.now ?? Date.now();
    const window = resolveStudyWindow(input.question, now);
    const schoolId = toPublicSchoolId(input.schoolId) || input.schoolId;
    if (!window || !schoolId) return null;
    const checkedAt = new Date(now).toISOString();
    let source: TimetableSource = null;
    try { source = await readAssistantTimetable('', input.schoolId, input.platformTimetable); }
    catch { assertCurrent(input); }
    assertCurrent(input);
    if (source?.schoolId !== schoolId || source.records.some((row) => row.schoolId !== schoolId)) source = null;
    const terms = new Set<string>();
    for (let day = window.startDay; day < window.endDay; day++) terms.add(termAt(day * DAY + 4 * 3_600_000));
    const coursework = source ? await readCoursework(input, source.records, schoolId, terms, checkedAt)
      : unavailableCoursework('目前沒有可核對的課表與課程連結，尚無法確認 nuni 作業與測驗來源。');
    const { assignments, quizzes } = coursework;
    assertCurrent(input);
    if (source) {
      const fresh = await readAssistantTimetable('', input.schoolId, input.platformTimetable);
      assertCurrent(input);
      if (!sameSource(source, fresh)) return null;
    }
    const agendaRows = (value: CourseworkSource) => value.basis.status === 'unavailable' ? null
      : value.pending.map(({ kind, title, groupName, dueAt, nuniSource, nuniQuizSource }) => ({
        kind, title, groupName, dueAt,
        ...(nuniSource ? { nuniSource } : {}), ...(nuniQuizSource ? { nuniQuizSource } : {}),
      }));
    const agenda = buildCampusStudyAgenda({ window, now, courses: null,
      assignments: agendaRows(assignments), quizzes: agendaRows(quizzes) });
    const dated = agenda.days.map((day) => source ? scheduledSavedClasses(source.records, schoolId, day.date) : undefined);
    const hasTimetable = !!source && dated.every((entries) => entries !== undefined && entries.length <= MAX_DAILY_CLASSES);
    agenda.timetableAvailable = hasTimetable;
    if (hasTimetable) agenda.days.forEach((day, index) => {
      day.scheduledClasses = dated[index]!.map((entry) => ({
        name: label(entry.row.title, 240), room: label(entry.row.location ?? '', 240),
        startAt: new Date(entry.startAt).toISOString(), endAt: new Date(entry.endAt).toISOString(),
      }));
    });
    const unplacedCourses = source?.records.filter((row) => {
      if (row.kind !== 'timetable' || row.dayOfWeek) return false;
      try {
        const scope = courseScope(row);
        return scope.schoolId === schoolId && terms.has(`${scope.academicYear}|${scope.semester}`);
      } catch { return false; }
    }).length ?? 0;
    agenda.ignoredCourses = Math.min(unplacedCourses, MAX_DAILY_CLASSES);
    const clockDays = agenda.days.map((day) => ({
      day, availability: inspectCampusClockAvailability(day.scheduledClasses, day.date),
    }));
    const canSuggestStudy = hasTimetable && !unplacedCourses && clockDays.every(({ availability }) => availability.valid);
    // Only time between known classes is considered. Leave room to move between classes,
    // keep suggestions in daytime, and never treat a blank day as permission to fill it.
    let studyGaps: CampusClockInterval[] = canSuggestStudy ? clockDays.flatMap(({ day, availability }) =>
      availability.gaps.flatMap((gap) => {
        const start = Math.max(Date.parse(gap.startAt) + CLASS_BUFFER, Date.parse(day.date + 'T08:00:00+08:00'));
        const end = Math.min(Date.parse(gap.endAt) - CLASS_BUFFER, Date.parse(day.date + 'T22:00:00+08:00'));
        return end > start ? [{ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }] : [];
      })) : [];
    const limitations = [...coursework.limitations, ...assignments.limitations, ...quizzes.limitations];
    if (unplacedCourses) limitations.push('部分本期課程尚未填寫上課星期，未排入每日課表，本次不建議準備時段；作業與測驗仍依已連結課程核對。');
    if (!hasTimetable) limitations.push(source
      ? '課表的學期、上課時間或資料筆數無法完整核對，本次不列課表，請開啟課表頁確認。'
      : '這台手機沒有可核對的本帳號、本校課表副本，請先匯入或保存課表。');
    else limitations.push('課表使用手機保存的時間與單日調整，未向校方即時查證；沒有排課不代表已確認空閒。');
    if (canSuggestStudy) limitations.push('準備建議只取 08:00–22:00 的課間時段，課前後各保留 10 分鐘，每次先安排 30 分鐘；未核對通勤與私人行程，也不代表能在 30 分鐘內完成作業或測驗複習。這些是建議，尚未建立行事曆事件。');
    limitations.push('本次納入已連結 nuni 課程的作業與線上測驗，不含公告或其他校務系統；已繳交、已作答與已關閉項目不列為待辦。測驗依參考期限安排複習，正式作答請至原測驗頁核對規則。');
    const relevant = [...assignments.pending, ...quizzes.pending].filter((item) => {
      if (!item.dueAt) return true;
      const due = Date.parse(item.dueAt);
      const dueDay = taipeiDayNumber(due);
      return due < now || (dueDay >= window.startDay && dueDay < window.endDay);
    }).sort(compareCoursework);
    const steps: CampusPlanStep[] = relevant.slice(0, 3).map((item) => {
      const due = item.dueAt ? Date.parse(item.dueAt) : NaN;
      let preparation = '';
      if (canSuggestStudy && due > now) {
        const slot = selectCampusClockStudySlot({ valid: true, gaps: studyGaps, conflicts: [] }, now, due);
        if (slot) {
          const day = agenda.days.find((entry) => taipeiDayNumber(Date.parse(slot.startAt)) ===
            Date.parse(entry.date + 'T00:00:00Z') / DAY)!;
          preparation = `建議先用 ${day.label} ${scheduledClassTimeLabel({ ...slot, name: '', room: '' }, day.date)}（30 分鐘）${item.kind === 'quiz' ? '複習這份測驗的課程內容' : '準備這份作業'}，再依進度調整。`;
          // Consume the selected slot so distinct tasks never receive the same time.
          studyGaps = studyGaps.map((gap) => Date.parse(gap.startAt) <= Date.parse(slot.startAt) &&
            Date.parse(gap.endAt) >= Date.parse(slot.endAt) ? { ...gap, startAt: slot.endAt } : gap)
            .filter((gap) => Date.parse(gap.endAt) > Date.parse(gap.startAt));
        } else preparation = '本次沒有找到符合條件的 30 分鐘課間準備時段，請另行安排。';
      }
      const timing = item.kind === 'quiz'
        ? item.dueAt ? `參考期限 ${dateLabel(item.dueAt)}；${due < now ? '參考期限已過，請先核對是否仍可作答' : '依參考期限安排複習進度'}`
          : '來源未提供可核對的參考期限，請先向測驗頁確認'
        : item.dueAt ? `截止 ${dateLabel(item.dueAt)}；${due < now ? '期限已過，請先核對補交方式' : '依期限安排作業進度'}`
          : '來源未提供可核對的截止時間，請先向課程頁確認';
      return {
        id: `nuni-${item.kind}-${item.workspaceId}-${item.id}`, kind: item.kind, title: item.title,
        detail: item.groupName + '｜' + timing + '。' + preparation + '請開啟 nuni 課程核對最新狀態。',
        priority: priority(item.dueAt, now), evidence: item.kind === 'quiz' ? 'authorized-quizzes' : 'authorized-assignments', route: '/classroom',
        ...(item.dueAt ? { dueAt: item.dueAt } : {}), groupName: item.groupName,
        ...(item.nuniSource ? { nuniSource: item.nuniSource } : {}),
        ...(item.nuniQuizSource ? { nuniQuizSource: item.nuniQuizSource } : {}),
      };
    });
    const conflicts = canSuggestStudy ? clockDays.flatMap(({ day, availability }) => availability.conflicts
      .map((interval) => `${day.label} ${scheduledClassTimeLabel({ ...interval, name: '', room: '' }, day.date)}`)) : [];
    if (conflicts.length) {
      // Keep elapsed and imminent deadlines ahead of timetable housekeeping.
      const afterUrgent = steps.findIndex((step) => step.priority !== 'overdue' && step.priority !== 'urgent');
      steps.splice(afterUrgent < 0 ? steps.length : afterUrgent, 0, {
        id: 'nuni-timetable-conflicts', title: '先核對課表重疊時段',
        detail: conflicts.slice(0, 3).join('、') + (conflicts.length > 3 ? `，另有 ${conflicts.length - 3} 段重疊` : '') +
          '。保存的課程在這些時間重疊，請先確認調課或重複匯入；準備建議已避開所有已排課程。',
        priority: 'verify', evidence: 'saved-timetable', route: '/timetable',
      });
    }
    if (hasTimetable) {
      const first = agenda.days.find((day) => day.scheduledClasses?.length);
      if (first) steps.push({ id: 'nuni-timetable-review', title: `${first.label}課表與課前準備`,
        detail: first.scheduledClasses!.slice(0, 3).map((item) => `${item.name} ${dateLabel(item.startAt)}${item.room ? `（${item.room}）` : ''}`).join('、') +
          '。依保存的上課時間準備教材；請再核對最新停課、調課資訊。',
        priority: 'normal', evidence: 'saved-timetable', route: '/timetable' });
    }
    if (!steps.length) steps.push({ id: 'nuni-verify-course', title: '先核對課程與課業狀態',
      detail: assignments.basis.status === 'unavailable' && quizzes.basis.status === 'unavailable'
        ? '目前無法確認作業與測驗來源，請開啟 nuni 課程核對，不能據此判定沒有待辦。'
        : '本次日期範圍沒有列出尚待繳交或作答的開放項目，請核對資料提醒、其他日期、已關閉項目與未連結課程。',
      priority: 'verify', evidence: 'verification', route: '/classroom' });
    const overview = `依手機課表副本與本次 nuni 來源整理（${dateLabel(checkedAt)}，台灣時間）。${assignments.basis.status === 'complete' && quizzes.basis.status === 'complete'
      ? '已取得已連結學生課程的作業與測驗清單。' : '部分資料尚未確認，請一併查看資料提醒。'}`;
    const visibleLimitations = limitations.length <= 8 ? limitations : [...limitations.slice(0, 7), limitations.slice(7).join(' ')];
    const fullContent = [window.title, overview,
      ...steps.map((step, index) => `${index + 1}. ${step.title}：${step.detail}`),
      '逐日安排（台灣時間）：', ...formatCampusStudyAgenda(agenda),
      ...(agenda.outsideWindow.length ? [`另有 ${agenda.outsideWindow.length} 項待辦期限未確認或不在本次日期範圍，請開啟課程頁核對。`] : []),
      ...visibleLimitations.map((item) => '資料提醒：' + item)].join('\n');
    const content = fullContent.length <= 119_900 ? fullContent
      : fullContent.slice(0, 119_900) + '\n文字摘要已達長度上限，請查看逐日計畫與資料提醒。';
    return { title: window.title, overview, checkedAt, steps, limitations: visibleLimitations, agenda, content,
      comparisonBasis: { assignments: assignments.basis, quizzes: quizzes.basis,
        timetableUpdatedAt: hasTimetable ? confirmedTime(source?.updatedAt) : null } };
  } catch (error) {
    if (cancelled(error) || input.signal?.aborted || !input.platformTimetable.isCurrent() || (input.isCurrent && !input.isCurrent())) return null;
    throw error;
  }
}
