import {
  getAssistantServiceCapability,
  parseAssistantTaskPlan,
  type AssistantTaskPlan,
  type AssistantTaskStep,
} from '@campus/shared/src/assistantTaskPlan';
import { assistantServiceHref, getAssistantService } from '@campus/shared/src/assistantServices';
import { formatImportedAcademicSummary, type ImportedAcademicSummary } from '@campus/shared/src/importedAcademicSummary';
import { bounded, clip, isSessionInvalidation, type Binding, type Card, type Obj, type Step, V2Error } from './contracts';
import { directReadAnswer, directReadCourseworkTargets, type DirectRead } from './directRead';
import { informationAnswer } from './information';
import { parseAssistantPublicCourseResults } from '@campus/shared/src/assistantPublicCourseResults';
import { formatPublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistant';
import { findSchoolById } from '@campus/shared/src/schools';
import { PUBLIC_COURSE_TOOL_TIMEOUT_MS } from './publicCourses';
import { formatPublicCampusRead, parsePublicCampusResult, publicCampusToolKind } from './publicCampus';
import { formatLostFoundRead, parseLostFoundResult } from './lostFound';
import { formatPublicSocialRead, parsePublicSocialResult } from './publicSocial';
import { formatSchoolInfoRead, parseSchoolInfoResult } from './schoolInfo';
import { isRoleWorkspaceTool, parseRoleWorkspaceResult, formatRoleWorkspaceResult,
  roleWorkspaceTaskStatus, ROLE_WORKSPACE_TIMEOUT_MS } from './roleWorkspaceReads';
import { formatCampusMapRead, parseCampusMapArguments, parseCampusMapResult, type CampusMapRead } from './campusMap';
import type { AssistantCampusEventTarget } from '../../assistantCampusEvent';
import { publicCampusEventTargets } from './publicCampusSelection';
import { parsePublicEventTarget, type PublicEventTarget } from './publicEvent';
import type { AssistantCourseworkTarget } from '../../assistantCoursework';
import type { createTools } from './tools';
import type { CrossServiceOperation, CrossServiceRequest } from './crossServiceRequest';

type Tools = ReturnType<typeof createTools>;
/** Server-held identities selected from a verified event reader, keyed by map step. */
export type EventMapSelections = Readonly<Record<string, PublicEventTarget>>;
export type MerchantSelections = Readonly<Record<string, import('./roleWorkspaceReads').MerchantTarget>>;
const record = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const rows = (value: unknown): Obj[] => Array.isArray(value) ? value.map(record) : [];
const unwrap = (value: unknown): Obj => {
  const object = record(value);
  return object.data && typeof object.data === 'object' ? record(object.data) : object;
};
const label = (value: unknown, fallback = '未提供') => typeof value === 'string' && value.trim()
  ? clip(value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim(), 240) : fallback;
const partial = (value: Obj) => value.partial === true || value.truncated === true ||
  value.incomplete === true || Boolean(value.nextCursor) || Number(value.unplaced || 0) > 0;

function mapStepStatus(read: CampusMapRead): AssistantTaskStep['status'] {
  if (read.status !== 'ready' || read.resolution === 'unmatched') return 'blocked';
  return read.partial || read.resolution !== 'matched' ? 'partial' : 'completed';
}
// Task-plan links have a stricter bound than a valid encoded map search URL.
// Keep the answer and original query when a long Chinese name exceeds it.
const taskMapHref = (read: CampusMapRead) => parseAssistantTaskPlan({ version: 1, steps: [{
  id: 'map-source', label: '校園地點', serviceId: 'map', dependsOn: [], status: 'completed',
  summary: '已核對地點來源。', href: read.href,
}] }) ? read.href : undefined;

function eventMapSource(value: unknown, schoolId: string, index: number, expected?: PublicEventTarget):
  { query: string; title: string; target: PublicEventTarget } | { reason: string; target?: PublicEventTarget } {
  const read = parsePublicCampusResult(value, schoolId, 'events');
  const choices = publicCampusEventTargets(read, schoolId);
  const ordered = read.items.every((item, position, items) => !position ||
    items[position - 1].startsAt!.localeCompare(item.startsAt!) < 0 ||
    (items[position - 1].startsAt === item.startsAt && items[position - 1].id.localeCompare(item.id) <= 0));
  if (read.status !== 'ready' || read.partial || choices.length !== read.items.length || !ordered ||
      !Number.isInteger(index) || index < 1 || index > 5)
    return { reason: '活動清單或來源順序尚未完整核對，沒有直接選取第幾筆活動的地點。' };
  if (expected && (expected.schoolId !== schoolId || expected.source !== read.source))
    return { reason: '原選定活動的校園或資料來源已變更，沒有改查其他活動。' };
  const selected = expected ? choices.find(choice => choice.schoolId === expected.schoolId &&
    choice.source === expected.source && choice.id === expected.id) : choices[index - 1];
  if (!selected) return { reason: expected ? '完整清單內已找不到原選定活動，沒有按新順序改查其他活動。'
    : `這次清單只有 ${choices.length} 筆，沒有第 ${index} 筆活動，沒有改選其他活動。` };
  const target = parsePublicEventTarget({ schoolId: selected.schoolId, source: selected.source, id: selected.id });
  if (!selected.location?.trim()) return { reason: '所選活動沒有提供可核對的地點，沒有改查其他活動。', target };
  return { query: selected.location.trim(), title: selected.title, target };
}

/** The calendar reader already authorizes the ledger against this binding.
 * Select from its structured, complete rows, not from an answer or model text.
 * Every date/time is checked again so a malformed earlier row cannot make a
 * later classroom look like the next class. Equal start times need a choice. */
function nextClassMapSource(value: unknown, read: DirectRead, schoolId: string, now: number):
  { query: string; title: string } | { reason: string } {
  const source = unwrap(value);
  const incomplete = { reason: '課表來源尚未完整核對，現在無法可靠選定下一堂課的教室。' };
  if (source.source !== 'personal-imports' || source.hasTimetableSource !== true || source.unplaced !== 0 ||
      partial(source) || source.unavailable || (source.schoolId !== undefined && source.schoolId !== schoolId) ||
      !Array.isArray(source.classes) || read.kind !== 'next-class' || !Number.isFinite(now)) return incomplete;
  const classes: { start: number; row: Obj }[] = [];
  for (const entry of source.classes) {
    const row = record(entry);
    if (typeof row.title !== 'string' || !row.title.trim() || typeof row.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) ||
        new Date(row.date).toISOString().slice(0, 10) !== row.date ||
        row.date < read.args.from || row.date > read.args.to ||
        typeof row.startTime !== 'string' || typeof row.endTime !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime) ||
        row.startTime >= row.endTime) return incomplete;
    const start = Date.parse(row.date + 'T' + row.startTime + ':00+08:00');
    if (start > Math.max(now, Date.parse(read.args.from + 'T00:00:00+08:00') - 1)) classes.push({ start, row });
  }
  classes.sort((left, right) => left.start - right.start);
  if (!classes.length) return { reason: '這次已同步的課表範圍內沒有下一堂課，尚未查詢教室位置。' };
  if (classes.filter(entry => entry.start === classes[0].start).length !== 1)
    return { reason: '下一個上課時段有多堂課同時開始，請先在課表選擇要去的課程，再查該教室位置。' };
  const { row } = classes[0];
  if (typeof row.location !== 'string' || !row.location.trim() || row.location.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(row.location) ||
      /^(?:未提供|未設定|待定|待公告|線上(?:教學|上課|課程)?|遠距(?:教學|上課|課程)?|online|tba|https?:)/i.test(row.location.trim()))
    return { reason: '下一堂課沒有可核對的校園教室名稱，請先補齊課表地點，沒有改查其他課程。' };
  return { query: row.location.trim(), title: row.title as string };
}

function failureMessage(error: unknown): string {
  switch ((error as { code?: string })?.code) {
    case 'PUBLIC_POST_ACTION_SOURCE_UNVERIFIED': return '公開貼文尚無可核對的行程或訂單資料；請直接提供要安排的事項、日期與時間。';
    case 'CAMPUS_EVENT_SELECTION_REQUIRED': return '公開活動需從清單明確選取並重新核對來源，這一步尚未建立行程。';
    case 'API_BUDGET_EXCEEDED': case 'TASK_BUDGET_EXCEEDED': return '這次查詢額度已用完，已保留其他完成的結果；這一步尚未完成。';
    case 'ASSISTANT_PERMISSION_DENIED': return '這項助理操作的權限尚未開啟，請到設定的助理權限確認。';
    case 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE': return '目前無法確認助理權限，這項操作尚未執行。';
    case 'FORBIDDEN_SCOPE': return '目前帳號或校園沒有可確認的單一資料範圍，請先在此服務選擇工作區。';
    case 'SCHEDULE_INCOMPLETE': case 'CALENDAR_INCOMPLETE': return '課表或行程尚有無法定位的紀錄，這次沒有據此安排時間。';
    case 'EVENT_CONFLICT': return '這個時段與已知課表或行程衝突，需要重新安排。';
    case 'WRITES_DISABLED': return '目前未開放助理新增行程，可開啟個人行事曆確認安排。';
    default: return '這個來源暫時無法完整讀取；其他不受影響的項目會繼續處理。';
  }
}

function readSummary(operation: CrossServiceOperation, value: unknown, now: number, schoolId: string): string {
  if (isRoleWorkspaceTool(operation.tool || ''))
    return formatRoleWorkspaceResult(operation.tool as import('./roleWorkspaceReads').RoleWorkspaceTool, value, schoolId, operation.args);
  if (operation.tool === 'get_public_social')
    return formatPublicSocialRead(parsePublicSocialResult(value, schoolId, operation.args));
  if (operation.tool === 'get_school_info')
    return formatSchoolInfoRead(parseSchoolInfoResult(value, schoolId, operation.args));
  if (operation.tool === 'get_lost_found')
    return formatLostFoundRead(parseLostFoundResult(value, schoolId, operation.args));
  const campusKind = publicCampusToolKind(operation.tool);
  if (campusKind) return formatPublicCampusRead(parsePublicCampusResult(value, schoolId, campusKind));
  if (unwrap(value).hasTimetableSource === false)
    return '目前沒有已同步的課表來源，還不能據此判定沒有課或可用空堂。';
  if (operation.directRead)
    return directReadAnswer([operation.directRead], [{ tool: operation.tool!, result: value }], now);
  if (operation.informationRead)
    return informationAnswer([{ read: operation.informationRead, result: value }], now);
  const result = unwrap(value);
  if (operation.tool === 'get_schedule') {
    const classes = rows(result.classes);
    return classes.length ? classes.slice(0, 5).map(row => `${label(row.title)} ${label(row.startTime)}–${label(row.endTime)}，${label(row.location)}`).join('；')
      : result.hasTimetableSource === false ? '目前沒有已同步的課表來源，還不能據此判定空堂。' : '這一天沒有已同步的上課紀錄。';
  }
  if (operation.tool === 'get_calendar') {
    const events = rows(result.events);
    return events.length ? events.slice(0, 5).map(row => `${label(row.title)} ${row.allDay ? '全天' : label(row.startTime) + '–' + label(row.endTime)}`).join('；')
      : '這一天沒有已同步的個人行程紀錄。';
  }
  if (operation.tool === 'get_due_work') {
    const pending = rows(result.pending);
    return pending.length ? pending.slice(0, 5).map(row => label(row.title)).join('、')
      : result.partial ? '已讀取的部分尚未找到待繳項目，其他課程仍待確認。' : '查詢期間內沒有尚未到期的待繳項目。';
  }
  if (operation.tool === 'get_imported_academics')
    return formatImportedAcademicSummary(result as ImportedAcademicSummary);
  if (operation.tool === 'get_dining') {
    const locations = rows(result.cafeterias);
    return locations.length ? locations.map(row => `${label(row.name)}${row.location ? '｜' + label(row.location) : ''}${row.openingHours ? '｜資料列示時段 ' + label(row.openingHours) : ''}`).join('\n')
      + '\n來源：校園餐廳目錄；這一步沒有下單或查詢即時供餐庫存。'
      : '這次餐廳目錄沒有回傳資料，尚不能據此判斷是否營業。';
  }
  return '已讀取此服務的可用資料。';
}

/** Explicit selections come only from the verified reader, never answer prose. */
function readPlanEventTargets(request: CrossServiceRequest, plan: AssistantTaskPlan,
  results: Map<string, unknown>, schoolId: string): AssistantCampusEventTarget[] {
  const targets = new Map<string, AssistantCampusEventTarget>();
  for (const operation of request.operations) {
    if (operation.kind !== 'read' || operation.tool !== 'get_campus_events' ||
        !['completed', 'partial'].includes(plan.steps.find(step => step.id === operation.id)?.status || '') ||
        !results.has(operation.id)) continue;
    const read = parsePublicCampusResult(results.get(operation.id), schoolId, 'events');
    if (read.status !== 'ready') continue;
    const selected = publicCampusEventTargets(read, schoolId);
    for (const target of selected) {
      const key = target.source + ':' + target.id;
      const previous = targets.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(target)) return [];
      targets.set(key, target);
    }
  }
  return [...targets.values()].slice(0, 5);
}

/** Selection hints for a later fresh read, never authority to reuse this task's data or cards. */
function readPlanCourseworkTargets(
  request: CrossServiceRequest,
  plan: AssistantTaskPlan,
  results: Map<string, unknown>,
  now: number,
): AssistantCourseworkTarget[] {
  // A prepared plan keeps its original confirmation/revision path. A new source
  // button must not quietly replace an existing calendar or food proposal.
  if (request.operations.some(operation => operation.kind === 'study' || operation.kind === 'event' || operation.kind === 'reorder')) return [];
  const work = request.operations.filter(operation => operation.kind === 'read' && operation.tool === 'get_due_work' &&
    (operation.directRead?.kind === 'due-work' || operation.informationRead?.kind === 'work'));
  // The existing pronoun follow-up can select a sole candidate automatically.
  // Incomplete coursework cannot establish that it is the only requested source.
  if (!work.length || work.some(operation => !results.has(operation.id) ||
      plan.steps.find(step => step.id === operation.id)?.status !== 'completed')) return [];
  const observed = new Map<string, string>();
  const targets = new Map<string, AssistantCourseworkTarget>();
  for (const operation of work) {
    const value = unwrap(results.get(operation.id));
    if (partial(value) || value.unavailable || typeof value.from !== 'string' || typeof value.to !== 'string') return [];
    const from = typeof operation.args.from === 'string' ? operation.args.from : value.from;
    const to = typeof operation.args.to === 'string' ? operation.args.to : value.to;
    const start = Date.parse(from + 'T00:00:00+08:00'), end = Date.parse(to + 'T00:00:00+08:00') + 86400000;
    if (value.from !== from || value.to !== to || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    for (const task of [...rows(value.pending), ...rows(value.undated), ...rows(value.submitted), ...rows(value.overdue)]) {
      if (typeof task.id !== 'string') continue;
      const identity = JSON.stringify([task.courseId, task.kind, task.title, task.courseTitle,
        task.dueAt, task.submitted, task.state]);
      if (observed.has(task.id) && observed.get(task.id) !== identity) return [];
      observed.set(task.id, identity);
    }
    const read: DirectRead = { kind: 'due-work', tool: 'get_due_work', args: { from, to },
      taskKind: operation.directRead?.taskKind || operation.informationRead?.taskKind };
    const pending = rows(value.pending).filter(task => typeof task.dueAt === 'string' &&
      Date.parse(task.dueAt) >= start && Date.parse(task.dueAt) < end);
    // Pass one node and its own evidence together: another date/kind's cached
    // get_due_work result is not a substitute for this requested source.
    for (const target of directReadCourseworkTargets([read], [{ tool: 'get_due_work', result: { ...value, pending } }], now))
      targets.set(JSON.stringify([target.workspaceId, target.kind, target.taskId]), target);
  }
  return [...targets.values()].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)).slice(0, 12);
}

/** Execute a bounded dependency plan using the same scoped dispatcher as chat.
 * There is no direct writer here: every mutation remains a signed proposal.
 */
export async function runCrossService(input: {
  request: CrossServiceRequest;
  tools: Tools;
  binding: Binding;
  signal: AbortSignal;
  now: number;
  /** Retry may preserve an earlier date but must not suggest an elapsed slot. */
  availableAfter?: number;
  /** Only verified retry proofs may populate these exact event identities. */
  eventMapSelections?: EventMapSelections;
  /** Issued from a previous verified merchant read, never selected by model text. */
  merchantSelections?: MerchantSelections;
  onMerchantSelection?: (stepId: string, target: import('./roleWorkspaceReads').MerchantTarget) => void;
  /** Captures a selected identity before its map lookup can fail. Never client data. */
  onEventMapSelection?: (stepId: string, target: PublicEventTarget) => void;
}) {
  const { request, tools, binding, signal, now } = input;
  const foreignPublicSource = request.operations.some(operation =>
    operation.publicCourseIntent?.kind === 'search' && operation.publicCourseIntent.schoolId !== binding.schoolId);
  const scopeName = findSchoolById(binding.schoolId)?.name || binding.schoolId;
  const taskPlan: AssistantTaskPlan = { version: 1, steps: [] };
  const steps: Step[] = [];
  const results = new Map<string, unknown>();
  const pendingTasks = (operation: CrossServiceOperation, includeUndated = false) => {
    const selected = new Map<string, Obj>();
    for (const dependency of operation.dependsOn) {
      const source = request.operations.find(previous => previous.id === dependency);
      if (source?.tool !== 'get_due_work') continue;
      const value = unwrap(results.get(dependency));
      const taskKind = source.directRead?.taskKind || source.informationRead?.taskKind;
      for (const task of [...rows(value.pending), ...(includeUndated ? rows(value.undated) : [])]) {
        if (task.submitted !== false || task.state !== 'open' || typeof task.id !== 'string' ||
            typeof task.courseId !== 'string' || (taskKind && task.kind !== taskKind)) continue;
        if (!includeUndated && (typeof task.dueAt !== 'string' || Date.parse(task.dueAt) <= now)) continue;
        selected.set(task.courseId + ':' + task.kind + ':' + task.id, task);
      }
    }
    return [...selected.values()].sort((a, b) => String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999')));
  };
  let calls = 0;
  const call = async (name: string, args: Obj, question?: string) => {
    signal.throwIfAborted();
    if (++calls > 16) throw new V2Error(429, 'TASK_BUDGET_EXCEEDED');
    try {
      const result = await bounded(child => tools.withSignal(child, () => tools.call(name, args, question)), signal,
        name === 'get_public_courses' ? PUBLIC_COURSE_TOOL_TIMEOUT_MS : isRoleWorkspaceTool(name) ? ROLE_WORKSPACE_TIMEOUT_MS : 4000);
      signal.throwIfAborted();
      steps.push({ name, status: result.cached ? 'cached' : 'ok', summary: '已核對此步驟的資料' });
      return result.value;
    } catch (error) {
      if (isSessionInvalidation(error) || signal.aborted) throw error;
      const code = (error as { code?: string })?.code;
      steps.push({ name, status: 'error', summary: typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'SOURCE_UNAVAILABLE' });
      throw error;
    }
  };
  for (const operation of request.operations) {
    signal.throwIfAborted();
    const service = getAssistantService(operation.serviceId)!;
    const step: AssistantTaskStep = { id: operation.id, label: operation.label || service.label,
      serviceId: operation.serviceId, dependsOn: [...operation.dependsOn], status: 'blocked', summary: '' };
    if (foreignPublicSource && ['timetable', 'calendar', 'classroom', 'merchant', 'bus', 'cafeteria', 'orders', 'clubs', 'import', 'announcements', 'events', 'lost-found', 'map', 'public-social', 'school-info'].includes(operation.serviceId))
      step.label += `（${scopeName}）`;
    taskPlan.steps.push(step);
    const dependencies = operation.dependsOn.map(id => taskPlan.steps.find(previous => previous.id === id));
    if (dependencies.some(previous => !previous || previous.status === 'blocked' || previous.status === 'handoff' ||
      (operation.kind !== 'materials' && previous.status !== 'completed'))) {
      step.summary = '前面需要的資料尚未完整核對，這一步沒有執行；其他獨立項目不受影響。';
      continue;
    }
    const beforeCards = tools.cards.length;
    try {
      if (operation.kind === 'handoff') {
        step.status = 'handoff';
        step.href = assistantServiceHref(service.id, binding.schoolId, 'platform') || undefined;
        step.summary = (getAssistantServiceCapability(service.id)?.summary || service.summary) + '。這項需求尚未代為完成，請在服務內接續。';
        continue;
      }
      if (operation.kind === 'public-course') {
        if (operation.publicCourseIntent?.kind !== 'search') {
          step.summary = operation.publicCourseIntent?.kind === 'clarify'
            ? operation.publicCourseIntent.content : '公開課程條件尚未確認，這一步尚未查詢。';
          continue;
        }
        const value = await call('get_public_courses', operation.args);
        const reads = parseAssistantPublicCourseResults([value]);
        const read = reads?.[0];
        if (!read || read.status !== 'ready') throw new V2Error(502, 'INVALID_PUBLIC_COURSE_RESULT');
        results.set(operation.id, value);
        step.status = read.truncated || Number(read.unresolvedCount || 0) > 0 ? 'partial' : 'completed';
        step.summary = formatPublicCourseAssistantRead(read);
        step.href = read.href;
      } else if (operation.kind === 'read') {
        const value = await call(operation.tool!, operation.args);
        results.set(operation.id, value);
        if (isRoleWorkspaceTool(operation.tool!)) {
          const target = input.merchantSelections?.[operation.id];
          const read = parseRoleWorkspaceResult(operation.tool, value, binding.schoolId, operation.args, target);
          step.status = roleWorkspaceTaskStatus(read);
          step.summary = formatRoleWorkspaceResult(operation.tool, read, binding.schoolId, operation.args, target);
          step.href = read.href;
          if ('selected' in read && read.selected) input.onMerchantSelection?.(operation.id,
            { tenantId: read.selected.tenantId, locationId: read.selected.locationId });
        } else if (operation.tool === 'get_campus_map') {
          const read = parseCampusMapResult(value, binding.schoolId, parseCampusMapArguments(operation.args));
          step.status = mapStepStatus(read);
          step.summary = formatCampusMapRead(read);
          const href = taskMapHref(read);
          if (href) step.href = href;
        } else {
          const result = unwrap(value);
          step.status = result.unavailable ? 'blocked' : partial(result) || result.hasTimetableSource === false ? 'partial' : 'completed';
          const sourceSummary = publicCampusToolKind(operation.tool) ||
            ['get_lost_found', 'get_public_social', 'get_school_info'].includes(operation.tool || '');
          step.summary = result.unavailable && !sourceSummary
            ? '目前沒有接通可讀取的來源，這項查詢尚未完成。' : readSummary(operation, value, now, binding.schoolId);
          if (operation.tool === 'get_lost_found') step.href = parseLostFoundResult(value, binding.schoolId, operation.args).href;
          else if (operation.tool === 'get_public_social') step.href = parsePublicSocialResult(value, binding.schoolId, operation.args).href;
          else if (operation.tool === 'get_school_info') step.href = parseSchoolInfoResult(value, binding.schoolId, operation.args).href;
          else if (sourceSummary) step.href = assistantServiceHref(operation.serviceId, binding.schoolId) || undefined;
          if (partial(result) && !sourceSummary) step.summary += '\n資料尚未完整讀取，這一步保留為部分完成。';
        }
      } else if (operation.kind === 'map-location') {
        const source = operation.dependsOn.length === 1
          ? request.operations.find(previous => previous.id === operation.dependsOn[0]) : undefined;
        if (!source || !results.has(source.id) || (operation.mapSource?.kind === 'event'
          ? source.tool !== 'get_campus_events' : !source.directRead || source.tool !== 'get_schedule')) {
          step.summary = '尚未確認這次地點查詢對應的來源，沒有猜測地點。';
          continue;
        }
        const boundEvent = input.eventMapSelections?.[operation.id];
        if (operation.mapSource?.kind === 'event' && boundEvent) step.label = '查原選定活動的位置';
        const selected = operation.mapSource?.kind === 'event'
          ? eventMapSource(results.get(source.id), binding.schoolId, operation.mapSource.index, boundEvent)
          : nextClassMapSource(results.get(source.id), source.directRead!, binding.schoolId, now);
        if ('target' in selected && selected.target)
          input.onEventMapSelection?.(operation.id, parsePublicEventTarget(selected.target));
        if ('reason' in selected) {
          step.summary = selected.reason;
          continue;
        }
        const args = parseCampusMapArguments({ query: selected.query, limit: 5 });
        const value = await call('get_campus_map', args);
        const read = parseCampusMapResult(value, binding.schoolId, args);
        results.set(operation.id, value);
        step.status = mapStepStatus(read);
        step.summary = `${label(selected.title)}｜${operation.mapSource?.kind === 'event' ? '活動地點' : '課表教室'}：${label(selected.query)}\n` + formatCampusMapRead(read);
        const href = taskMapHref(read);
        if (href) step.href = href;
      } else if (operation.kind === 'free-time') {
        const value = await call('find_free_time', operation.args, operation.question);
        const originalSlots = rows(unwrap(value).slots);
        const slots = input.availableAfter === undefined ? originalSlots : originalSlots.filter(row =>
          typeof row.date === 'string' && typeof row.startTime === 'string' &&
          Date.parse(row.date + 'T' + row.startTime + ':00+08:00') >= input.availableAfter!);
        results.set(operation.id, input.availableAfter === undefined ? value : { ...unwrap(value), slots });
        step.status = slots.length ? 'completed' : 'blocked';
        step.summary = slots.length ? '已核對同步課表與個人行程，可用時段：' + slots.slice(0, 5)
          .map(row => `${label(row.date)} ${label(row.startTime)}–${label(row.endTime)}`).join('、')
          : originalSlots.length ? '原查詢時段已經過去，沒有可接續安排的未來空檔。'
          : '指定日期與時段內沒有符合長度的空檔，尚未安排。';
      } else if (operation.kind === 'study') {
        const pending = pendingTasks(operation);
        if (!pending.length) {
          step.summary = '目前讀取的期間沒有可安排的待繳作業；沒有新增行程。';
          continue;
        }
        const { taskLimit, ...args } = operation.args;
        // The legacy proposal dispatcher identifies tasks by id. If different
        // verified courses reuse one id, do not let its cache select a source.
        if (new Set(pending.map(task => task.id)).size !== pending.length) {
          step.summary = '對應課程的作業識別有重複，請從課程頁選擇精確作業後再安排。';
          continue;
        }
        const value = unwrap(await call('propose_study_plan', { ...args,
          taskIds: pending.slice(0, Number(taskLimit)).map(row => row.id) }, operation.question));
        results.set(operation.id, value);
        const cards = tools.cards.slice(beforeCards);
        if (!cards.length) {
          step.status = rows(value.planned).some(row => row.unavailable === 'WRITES_DISABLED') ? 'handoff' : 'blocked';
          step.summary = step.status === 'handoff' ? '目前未開放助理新增行程，可在個人行事曆確認安排。'
            : '目前沒有能在截止前完整排入的準備時段，尚未新增行程。';
          step.href = assistantServiceHref('calendar', binding.schoolId) || undefined;
        } else {
          step.status = Number(value.unplanned || 0) || pending.length > Number(taskLimit) ? 'partial' : 'ready';
          step.cardIds = cards.map(card => card.mutationId);
          step.summary = `已準備 ${cards.length} 筆行程，確認後才會儲存：` + cards.map(card =>
            `${label(card.args.title)}｜${label(card.args.date)} ${label(card.args.startTime)}–${label(card.args.endTime)}`).join('；') +
            (Number(value.unplanned || 0) ? `。另有 ${Number(value.unplanned)} 份未排入。` : '') +
            (pending.length > Number(taskLimit) ? `。本次先處理最早到期的 ${Number(taskLimit)} 份，其餘 ${pending.length - Number(taskLimit)} 份保留待辦。` : '');
        }
      } else if (operation.kind === 'materials') {
        const sources = operation.dependsOn.map(id => unwrap(results.get(id))).filter(result => Array.isArray(result.pending));
        if (!sources.length && /相關|對應|這些/.test(operation.question || '') &&
            request.operations.some(source => source.kind === 'public-course')) {
          step.summary = '公開開課資料尚未對應到可存取的私人課程，無法核對相關教材；請先選擇原課程。';
          continue;
        }
        let courseIds = [...new Set(pendingTasks(operation, true).map(row => String(row.courseId)))];
        if (!sources.length) {
          const courses = unwrap(await call('list_courses', {}));
          courseIds = rows(courses.courses).map(row => row.id).filter((id): id is string => typeof id === 'string');
          if (courses.truncated) step.status = 'partial';
        }
        if (!courseIds.length) { step.summary = '尚未讀到可存取的對應課程，沒有猜測教材來源。'; continue; }
        const titles: string[] = [];
        let readCourses = 0;
        let incomplete = courseIds.length > 3 || sources.some(source => source.partial === true) || step.status === 'partial';
        for (const workspaceId of courseIds.slice(0, 3)) {
          try {
            const value = unwrap(await call('get_materials', { workspaceId }));
            readCourses++;
            incomplete ||= partial(value);
            titles.push(...rows(value.materials).map(row => label(row.title)));
          } catch (error) {
            if (isSessionInvalidation(error) || signal.aborted) throw error;
            incomplete = true;
          }
        }
        step.status = !readCourses ? 'blocked' : incomplete ? 'partial' : 'completed';
        step.summary = (titles.length ? '對應課程教材：' + titles.slice(0, 10).join('、') : readCourses ? '已讀取的課程未列出教材。' : '對應課程的教材來源暫時無法讀取。') +
          (incomplete ? ' 部分課程或其餘頁面尚未查完，請在課程頁接續。' : '') + ' 本次取得教材目錄，沒有代讀附件全文。';
      } else if (operation.kind === 'clubs') {
        const value = unwrap(await call('list_clubs', { membership: operation.args.membership }));
        results.set(operation.id, value);
        const clubs = rows(value.communities);
        step.status = partial(value) ? 'partial' : 'completed';
        step.summary = clubs.length ? clubs.map(row => label(row.title)).join('、') : '目前可讀取的清單沒有列出社團。';
        if (operation.args.feed && clubs.length === 1 && typeof clubs[0].id === 'string') {
          const feed = unwrap(await call('get_club_feed', { communityId: clubs[0].id }));
          if (partial(feed)) step.status = 'partial';
          // Untrusted posts are displayed as titles only and are never sent to a
          // model, parsed into more tasks, or used as authorization.
          step.summary += '\n最近動態：' + (rows(feed.posts).map(row => label(row.title, '未命名貼文')).join('、') || '未回傳貼文');
          if (partial(feed)) step.summary += '。其餘動態尚未查完，請在社團頁接續。';
        } else if (operation.args.feed && clubs.length > 1) {
          step.status = 'partial'; step.summary += '。已找到多個社團，請在社團頁選擇要看的動態。';
        }
      } else if (operation.kind === 'transit') {
        let value = unwrap(await call('get_transit', operation.args));
        if (value.kind === 'stops' && rows(value.stops).length === 1) {
          const stop = rows(value.stops)[0];
          if (typeof stop.city === 'string' && typeof stop.id === 'string')
            value = unwrap(await call('get_transit', { action: 'arrivals', city: stop.city, stopId: stop.id }));
        }
        results.set(operation.id, value);
        if (value.status !== 'ready') {
          step.summary = '公車來源目前未回傳可核對的即時資料，請在公車頁接續。';
        } else if (value.kind === 'arrivals') {
          step.status = value.limited ? 'partial' : 'completed';
          step.summary = rows(value.arrivals).map(row => `${label(row.route)} 往 ${label(row.destination)}：${typeof row.minutes === 'number' ? '預估 ' + row.minutes + ' 分鐘' : '尚無可靠到站預估'}`).join('\n') || '這次來源沒有回傳到站預估。';
          step.summary += '\n本輪查詢時間：' + new Date(now + 28800000).toISOString().slice(0, 16).replace('T', ' ') + '（台北）；以當次來源為準。';
        } else {
          step.status = 'handoff';
          step.summary = '已找到站點：' + (rows(value.stops).map(row => label(row.name)).join('、') || '請開啟公車頁選擇') + '。尚未取得指定站牌的到站資訊。';
        }
        step.href = assistantServiceHref('bus', binding.schoolId) || undefined;
      } else if (operation.kind === 'event') {
        if (operation.eventIssue) {
          step.summary = operation.eventIssue;
          continue;
        }
        // The complete clause supplies its own title and time. It does not infer
        // a work action from teacher, store or public-source text.
        await call('propose_personal_event', operation.args, operation.question);
        const cards = tools.cards.slice(beforeCards);
        if (cards.length) step.cardIds = cards.map(card => card.mutationId);
        step.status = cards.length ? 'ready' : 'blocked';
        const actual = cards[0]?.args ?? operation.args;
        step.summary = cards.length
          ? `已核對 ${actual.date} ${actual.startTime}–${actual.endTime}「${label(actual.title)}」，請確認下方個人行程；目前尚未儲存。`
          : '已整理指定時段，目前尚未開放新增個人行程，尚未儲存。';
      } else if (operation.kind === 'reorder') {
        await call('reorder_last_food_order', operation.args, operation.question);
        const cards = tools.cards.slice(beforeCards);
        if (cards.length) step.cardIds = cards.map(card => card.mutationId);
        step.status = cards.length ? 'ready' : 'blocked';
        step.summary = cards.length ? '已依最近一筆可讀訂單重新核對菜單並備好內容，請逐項確認卡片；尚未下單。'
          : '沒有取得可確認的備餐內容，尚未下單。';
      }
    } catch (error) {
      if (isSessionInvalidation(error) || signal.aborted) throw error;
      const cards = tools.cards.slice(beforeCards);
      const priorSummary = ['completed', 'partial'].includes(step.status) ? step.summary : '';
      step.status = cards.length || priorSummary ? 'partial' : 'blocked';
      if (cards.length) step.cardIds = cards.map(card => card.mutationId);
      step.summary = (priorSummary ? priorSummary + '。' : '') + failureMessage(error) + (cards.length ? ' 已備好的部分仍須逐項確認。' : '');
    }
    step.summary = step.summary.slice(0, 1200);
  }
  signal.throwIfAborted();
  const cards: Card[] = [...tools.cards];
  const activeCards = new Set(cards.map(card => card.mutationId));
  for (const step of taskPlan.steps) {
    if (!step.cardIds?.some(id => !activeCards.has(id))) continue;
    const remaining = step.cardIds.filter(id => activeCards.has(id));
    step.status = remaining.length ? 'partial' : 'blocked';
    if (remaining.length) step.cardIds = remaining;
    else delete step.cardIds;
    step.summary = '這項提議的部分或全部確認內容已失效，請重新準備；尚未執行。';
  }
  const unresolved = taskPlan.steps.filter(step => ['partial', 'blocked', 'handoff'].includes(step.status));
  const answer = '已依這次需求逐項處理：\n\n' + taskPlan.steps.map(step => `${step.label}\n${step.summary}`).join('\n\n') +
    (cards.length ? '\n\n新增或備餐內容仍在下方確認卡；確認並核對結果後才算執行完成。' : '');
  for (const step of taskPlan.steps) step.summary = step.summary.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 1200);
  return { taskPlan, answer, cards, steps, dataRead: true as const,
    courseworkTargets: readPlanCourseworkTargets(request, taskPlan, results, now),
    eventTargets: readPlanEventTargets(request, taskPlan, results, binding.schoolId),
    ...(tools.publicCourseResults.length ? { publicCourseResults: tools.publicCourseResults } : {}),
    stopReason: unresolved.length ? 'TASKS_INCOMPLETE' : '' };
}
