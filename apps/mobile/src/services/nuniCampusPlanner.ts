import type { PersonalImportRecord } from '@campus/shared';
import { currentSemesterStartUtc, rocSchoolYear } from '@campus/shared/src/campusAnnouncementQuality';
import { CourseAccessError, courseScope, sameCourseScope } from '@campus/shared/src/courseAccess';
import { createCourseAccess, type CourseTransport } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { readAssistantTimetable, type PlatformTimetableAccess } from './assistantTimetableSource';
import { buildCampusStudyAgenda, formatCampusStudyAgenda, resolveStudyWindow, taipeiDayNumber } from './campusStudyAgenda';
import { scheduledSavedClasses } from './nextSavedClasses';
import type { CampusEvidencePlan, CampusPlanPriority, CampusPlanStep } from './offlineCampusPlanner';
import type { CampusPlanComparisonBasis } from './campusPlanComparison';
import { savedPlanTimestamp } from './savedCampusPlanValidation';

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
type Assignment = {
  workspaceId: string;
  id: string;
  title: string;
  groupName: string;
  dueAt: string | null;
  pending: boolean;
};
type AssignmentSource = {
  basis: CampusPlanComparisonBasis['assignments'];
  pending: Assignment[];
  limitations: string[];
};
const DAY = 86_400_000;
const MAX_WORKSPACES = 12;
const MAX_ASSIGNMENTS = 400;
const MAX_DAILY_CLASSES = 80;

export function isNuniCampusPlanningQuestion(question: string): boolean {
  const planning = /安排|規劃|計畫|今日重點|今天要做|今天要先|今天先做|今天該做|先處理|先完成|優先順序|待辦摘要|校園摘要|本週重點|這週重點|接下來七天|未來七天|讀書進度|怎麼分配/.test(question);
  const scope = /今天|明天|今日|這週|本週|下週|下星期|下禮拜|七天|7天|課表|空堂|作業|待交|待繳|截止|學習|讀書|複習|報告|待辦|校園/.test(question);
  const write = /(?:幫我|替我|直接|立刻).{0,22}(?:送出|提交|請假|下單|付款|發訊息|訂餐|報修|刪除|改成已讀)/.test(question);
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

function unavailable(detail: string): AssignmentSource {
  return {
    basis: { status: 'unavailable', checkedAt: null, total: null, items: [] },
    pending: [], limitations: [detail],
  };
}

async function readAssignments(input: PlanInput, records: PersonalImportRecord[], schoolId: string,
  terms: ReadonlySet<string>, checkedAt: string): Promise<AssignmentSource> {
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
  if (!linked.size) return unavailable('目前課表尚未連結可核對的 nuni 課程，無法判斷是否有作業待交；請先在課程頁確認連結。');
  if (!input.request || !input.bffRequest) return unavailable('目前無法連線查詢 nuni 作業；本次計畫僅能使用手機課表副本。');

  const read = input.request;
  const bff = input.bffRequest;
  let stopped = false;
  const assertReading = () => {
    assertCurrent(input);
    if (stopped) throw new NuniError(409, 'SESSION_CHANGED');
  };
  // Membership and reviewed directory use the platform API; assignments use its authorized BFF.
  const classes = createNuniClasses(async (path) => {
    assertReading();
    const result = await (path === 'class-workspaces' ? read(path) : bff(path));
    assertReading();
    return result;
  }, input.platformTimetable.accountId);
  let memberships: NuniWorkspace[];
  try {
    memberships = await classes.list();
    assertCurrent(input);
    if (new Set(memberships.map((item) => item.id)).size !== memberships.length) {
      return unavailable('nuni 課程清單含重複身分，這次無法安全核對作業來源。');
    }
  } catch (error) {
    assertCurrent(input);
    if (cancelled(error)) throw error;
    return unavailable('目前無法取得 nuni 課程成員資料，作業來源尚未確認。');
  }
  const eligible = memberships.filter((item) => linked.has(item.id) && item.state === 'active' && item.memberRole === 'student')
    .sort((a, b) => a.id.localeCompare(b.id));
  const missingLinks = currentRows.some((row) => !row.linkedCourseId);
  const missingMembership = eligible.length !== linked.size;
  const limitedWorkspaces = eligible.length > MAX_WORKSPACES;
  const selected = eligible.slice(0, MAX_WORKSPACES);
  let incomplete = missingLinks || missingMembership || limitedWorkspaces;
  let failures = 0;
  let unreviewed = 0;
  let limitedAssignments = false;
  let successful = 0;
  let cursor = 0;
  const fetched = new Map<string, Assignment[]>();
  const directory = createCourseAccess(async (path, body) => {
    assertReading();
    const result = await read(path, body);
    assertReading();
    return result;
  });
  const worker = async () => {
    while (!stopped && cursor < selected.length) {
      assertCurrent(input);
      const workspace = selected[cursor++];
      try {
        const detail = await directory.workspace(workspace.id, schoolId);
        assertCurrent(input);
        const rows = linked.get(workspace.id)!;
        if (detail.memberRole !== 'student' || (detail.status === 'reviewed' &&
            !rows.every((row) => sameCourseScope(courseScope(row), detail.course)))) {
          incomplete = true;
          failures++;
          continue;
        }
        if (detail.status === 'unreviewed') {
          unreviewed++;
          incomplete = true;
        }
        const assignments: NuniAssignment[] = await classes.assignments(workspace.id);
        assertCurrent(input);
        if (new Set(assignments.map((item) => item.id)).size !== assignments.length) {
          incomplete = true;
          failures++;
          continue;
        }
        if (assignments.length >= 100) { limitedAssignments = true; incomplete = true; }
        successful++;
        fetched.set(workspace.id, assignments.slice(0, 100).map((item) => ({
          workspaceId: workspace.id, id: item.id,
          title: label(item.title, 240), groupName: label(workspace.title, 160),
          dueAt: confirmedTime(item.dueAt),
          pending: item.state === 'open' && item.mySubmission === null,
        })));
      } catch (error) {
        assertCurrent(input);
        if (cancelled(error)) { stopped = true; throw error; }
        incomplete = true;
        failures++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  assertCurrent(input);
  const limitations: string[] = [];
  if (missingLinks) limitations.push('部分課表尚未連結 nuni 課程，未依同名自動配對；這些課程的作業未納入。');
  if (missingMembership) limitations.push('部分已連結課程目前不是有效學生課程，未讀取其作業；請至課程頁核對身分與連結。');
  if (failures) limitations.push('部分課程的學校、學期、學生身分或作業來源無法核對，未納入；缺資料不代表已完成。');
  if (unreviewed) limitations.push('部分 nuni 課程尚未經課程目錄核對，僅依你保存的連結與有效學生身分列入。');
  if (limitedWorkspaces) limitations.push(`本次最多查詢 ${MAX_WORKSPACES} 門已連結課程，其餘課程請開啟課程頁核對。`);
  if (limitedAssignments) limitations.push('部分課程已達來源 100 筆上限，沒有續頁資訊；無法確認是否仍有其他作業。');
  if (!successful) {
    const result = unavailable('這次沒有取得可核對的 nuni 作業來源，無法判斷作業是否已完成。');
    result.limitations.push(...limitations);
    return result;
  }
  const all = [...fetched.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, items]) => items)
    .sort((a, b) => Number(b.pending) - Number(a.pending) ||
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
      a.workspaceId.localeCompare(b.workspaceId) || a.id.localeCompare(b.id));
  if (all.length > MAX_ASSIGNMENTS) {
    incomplete = true;
    limitations.push(`本次保留前 ${MAX_ASSIGNMENTS} 筆作業資料，超出範圍未納入，請至課程頁核對。`);
  }
  const items = all.slice(0, MAX_ASSIGNMENTS);
  return {
    basis: {
      status: incomplete ? 'partial' : 'complete', checkedAt, total: incomplete ? null : items.length,
      items: items.map((item) => ({ identity: [item.workspaceId, item.id], title: item.title,
        groupName: item.groupName, dueAt: item.dueAt })),
    },
    pending: items.filter((item) => item.pending), limitations,
  };
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

/** Platform-only, read-only evidence. No Firebase identity, snapshot or assignment action grant is created. */
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
    const assignments = source ? await readAssignments(input, source.records, schoolId, terms, checkedAt)
      : unavailable('目前沒有可核對的課表與課程連結，尚無法確認 nuni 作業來源。');
    assertCurrent(input);
    if (source) {
      const fresh = await readAssistantTimetable('', input.schoolId, input.platformTimetable);
      assertCurrent(input);
      if (!sameSource(source, fresh)) return null;
    }
    const agenda = buildCampusStudyAgenda({ window, now, courses: null,
      assignments: assignments.basis.status === 'unavailable' ? null : assignments.pending.map(({ title, groupName, dueAt }) => ({ title, groupName, dueAt })) });
    const dated = agenda.days.map((day) => source ? scheduledSavedClasses(source.records, schoolId, day.date) : undefined);
    const hasTimetable = !!source && dated.every((entries) => entries !== undefined && entries.length <= MAX_DAILY_CLASSES);
    agenda.timetableAvailable = hasTimetable;
    if (hasTimetable) agenda.days.forEach((day, index) => {
      day.scheduledClasses = dated[index]!.map((entry) => ({
        name: label(entry.row.title, 240), room: label(entry.row.location ?? '', 240),
        startAt: new Date(entry.startAt).toISOString(), endAt: new Date(entry.endAt).toISOString(),
      }));
    });
    const limitations = [...assignments.limitations];
    if (source?.records.some((row) => !row.dayOfWeek)) limitations.push('部分課程尚未填寫上課星期，未排入每日課表；作業仍依已連結課程核對。');
    if (!hasTimetable) limitations.push(source
      ? '課表的學期、上課時間或資料筆數無法完整核對，本次不列課表，請開啟課表頁確認。'
      : '這台手機沒有可核對的本帳號、本校課表副本，請先匯入或保存課表。');
    else limitations.push('課表使用手機保存的時間與單日調整，未向校方即時查證；沒有排課不代表已確認空閒。');
    limitations.push('本次只納入已連結 nuni 課程的作業，不含小考、公告或其他校務系統；已繳交與已關閉作業不列為待辦。');
    const relevant = assignments.pending.filter((item) => {
      if (!item.dueAt) return true;
      const due = Date.parse(item.dueAt);
      const dueDay = taipeiDayNumber(due);
      return due < now || (dueDay >= window.startDay && dueDay < window.endDay);
    }).sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
      a.workspaceId.localeCompare(b.workspaceId) || a.id.localeCompare(b.id));
    const steps: CampusPlanStep[] = relevant.slice(0, 3).map((item) => ({
      id: `nuni-${item.workspaceId}-${item.id}`, title: item.title,
      detail: item.groupName + '｜' + (item.dueAt ? `截止 ${dateLabel(item.dueAt)}；${Date.parse(item.dueAt) < now ? '期限已過，請先核對補交方式' : '依期限安排作業進度'}`
        : '來源未提供可核對的截止時間，請先向課程頁確認') + '。請開啟 nuni 課程核對最新狀態。',
      priority: priority(item.dueAt, now), evidence: 'authorized-assignments', route: '/classroom',
      ...(item.dueAt ? { dueAt: item.dueAt } : {}), groupName: item.groupName,
    }));
    if (hasTimetable) {
      const first = agenda.days.find((day) => day.scheduledClasses?.length);
      if (first) steps.push({ id: 'nuni-timetable-review', title: `${first.label}課表與課前準備`,
        detail: first.scheduledClasses!.slice(0, 3).map((item) => `${item.name} ${dateLabel(item.startAt)}${item.room ? `（${item.room}）` : ''}`).join('、') +
          '。依保存的上課時間準備教材；請再核對最新停課、調課資訊。',
        priority: 'normal', evidence: 'saved-timetable', route: '/timetable' });
    }
    if (!steps.length) steps.push({ id: 'nuni-verify-course', title: '先核對課程與作業狀態',
      detail: assignments.basis.status === 'unavailable' ? '目前無法確認作業來源，請開啟 nuni 課程核對，不能據此判定沒有待辦。'
        : '本次日期範圍沒有列出尚未繳交的開放作業，請核對其他日期、已關閉作業與未連結課程。',
      priority: 'verify', evidence: 'verification', route: '/classroom' });
    const overview = `依手機課表副本與本次 nuni 來源整理（${dateLabel(checkedAt)}，台灣時間）。${assignments.basis.status === 'complete'
      ? '已取得已連結學生課程的作業清單。' : '部分資料尚未確認，請一併查看資料提醒。'}`;
    const visibleLimitations = limitations.length <= 8 ? limitations : [...limitations.slice(0, 7), limitations.slice(7).join(' ')];
    const fullContent = [window.title, overview,
      ...steps.map((step, index) => `${index + 1}. ${step.title}：${step.detail}`),
      '逐日安排（台灣時間）：', ...formatCampusStudyAgenda(agenda),
      ...(agenda.outsideWindow.length ? [`另有 ${agenda.outsideWindow.length} 項待辦期限未確認或不在本次日期範圍，請開啟課程頁核對。`] : []),
      ...visibleLimitations.map((item) => '資料提醒：' + item)].join('\n');
    const content = fullContent.length <= 119_900 ? fullContent
      : fullContent.slice(0, 119_900) + '\n文字摘要已達長度上限，請查看逐日計畫與資料提醒。';
    return { title: window.title, overview, checkedAt, steps, limitations: visibleLimitations, agenda, content,
      comparisonBasis: { assignments: assignments.basis, timetableUpdatedAt: hasTimetable ? confirmedTime(source?.updatedAt) : null } };
  } catch (error) {
    if (cancelled(error) || input.signal?.aborted || !input.platformTimetable.isCurrent() || (input.isCurrent && !input.isCurrent())) return null;
    throw error;
  }
}
