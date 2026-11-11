import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { courseScope } from '@campus/shared/src/courseAccess';
import { isPersonalImportDate } from '@campus/shared/src/imports/validation';
import { nuniId } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { assistantCalendarEventIdentity } from './assistantCalendarJournal';
import type { NuniPlanAssignmentSource } from './nuniPlanAssignmentTarget';
import type { PersonalImportScope } from './personalImports';

export const ASSISTANT_CALENDAR_BATCH_MAX_STEPS = 4;
export const ASSISTANT_CALENDAR_BATCH_MAX_PLANS = 64;
export const ASSISTANT_CALENDAR_BATCH_MAX_BYTES = 256 * 1024;
export const ASSISTANT_CALENDAR_COURSE_IDENTITY_MAX_LENGTH = 2048;
export const ASSISTANT_CALENDAR_COURSEWORK_PLAN_PREFIX = 'acb_coursework_';
export const ASSISTANT_CALENDAR_COURSEWORK_STEP_PREFIX = 'acs_coursework_';
const WAIT_MS = 20_000;
const locks = new Map<string, Promise<unknown>>();

export type AssistantCalendarBatchErrorCode =
  | 'batch-invalid' | 'batch-unavailable' | 'batch-corrupt' | 'batch-full'
  | 'batch-write-unverified' | 'batch-timeout' | 'batch-busy' | 'batch-conflict' | 'session-changed';
const messages: Record<AssistantCalendarBatchErrorCode, string> = {
  'batch-invalid': '請提供二至四筆有效行程，每筆都需要明確的日期、起訖時間與名稱。',
  'batch-unavailable': '目前無法完整讀取行程計畫或操作紀錄。請稍後重新核對，這次不會新增行程。',
  'batch-corrupt': '儲存的行程計畫無法安全核對。已保留原資料，這次不會新增行程。',
  'batch-full': '這台手機的批次行程計畫已達保存上限。既有紀錄仍可核對，這次沒有新增計畫。',
  'batch-write-unverified': '尚未確認行程計畫已完整保存。這次不會開始新的行程操作，請稍後重新核對。',
  'batch-timeout': '這次行程處理已逾時，後續安排已停止。處理中的行程仍須核對，不會自動重送。',
  'batch-busy': '目前已有一批行程正在處理，請先等候或停止該批次，再重新確認。',
  'batch-conflict': '相同名稱與時段已有不同內容的行程計畫，請先核對原計畫；這次不會覆寫或新增。',
  'session-changed': '帳號或學校已切換，這次行程處理已停止。',
};
export class AssistantCalendarBatchError extends Error {
  constructor(readonly code: AssistantCalendarBatchErrorCode) {
    super(messages[code]);
    this.name = 'AssistantCalendarBatchError';
  }
}

export type AssistantCalendarBatchStepSource = Readonly<{
  kind: 'nuni-assignment';
  locator: Readonly<NuniPlanAssignmentSource>;
  expected: Readonly<{ title: string; courseName: string; dueAt: string; courseIdentity: string }>;
}>;
export type AssistantCalendarBatchStep = Readonly<{
  id: string;
  event: AssistantCalendarEvent;
  source?: AssistantCalendarBatchStepSource;
}>;
export type AssistantCalendarBatchPlan = Readonly<{
  id: string;
  owner: string;
  schoolId: string;
  createdAt: string;
  kind?: 'coursework-study';
  steps: ReadonlyArray<AssistantCalendarBatchStep>;
  cancelledAt?: string;
}>;
type Store = { version: 1; owner: string; schoolId: string; plans: AssistantCalendarBatchPlan[] };

function invalid(): never { throw new AssistantCalendarBatchError('batch-corrupt'); }
function object(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const result: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function scopeValue(raw: unknown): PersonalImportScope {
  const value = object(raw, ['owner', 'schoolId']);
  if (typeof value.owner !== 'string' || !/^(?:firebase|nuni):.+$/u.test(value.owner) ||
      value.owner.length > 520 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.owner) ||
      typeof value.schoolId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.schoolId)) return invalid();
  try { encodeURIComponent(value.owner); } catch { return invalid(); }
  return { owner: value.owner, schoolId: value.schoolId };
}
function requireActive(scope: PersonalImportScope, active: () => boolean) {
  scopeValue(scope);
  let valid = false;
  try { valid = active(); } catch { /* A failed guard grants no access. */ }
  if (!valid) throw new AssistantCalendarBatchError('session-changed');
}
function identifier(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw)) return invalid();
  return raw;
}
function instant(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) return invalid();
  return raw;
}
function sourceText(raw: unknown, max: number, canonical = false): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max ||
      (canonical && raw !== raw.trim()) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw)) return invalid();
  try { encodeURIComponent(raw); } catch { return invalid(); }
  return raw;
}
function sourceDueAt(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 40) return invalid();
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(raw);
  if (!match || !isPersonalImportDate(match[1]) || !Number.isFinite(Date.parse(raw))) return invalid();
  return raw;
}
function stepSource(raw: unknown, scope: PersonalImportScope): AssistantCalendarBatchStepSource {
  const value = object(raw, ['kind', 'locator', 'expected']);
  if (value.kind !== 'nuni-assignment') return invalid();
  const locator = object(value.locator, ['accountId', 'schoolId', 'academicYear', 'semester', 'workspaceId', 'assignmentId']);
  let parsed: NuniPlanAssignmentSource;
  try {
    const term = courseScope(locator);
    if (term.schoolId !== locator.schoolId || term.academicYear !== locator.academicYear ||
        term.semester !== locator.semester || (toPublicSchoolId(term.schoolId) || term.schoolId) !== term.schoolId) return invalid();
    parsed = { ...term, accountId: nuniId(locator.accountId, 'pa'), workspaceId: nuniId(locator.workspaceId, 'cw'),
      assignmentId: nuniId(locator.assignmentId, 'cwa') };
  } catch { return invalid(); }
  if (scope.owner !== `nuni:${parsed.accountId}` || scope.schoolId !== parsed.schoolId) return invalid();
  const expected = object(value.expected, ['title', 'courseName', 'dueAt', 'courseIdentity']);
  return Object.freeze({ kind: 'nuni-assignment', locator: Object.freeze(parsed), expected: Object.freeze({
    title: sourceText(expected.title, 200), courseName: sourceText(expected.courseName, 200),
    dueAt: sourceDueAt(expected.dueAt),
    courseIdentity: sourceText(expected.courseIdentity, ASSISTANT_CALENDAR_COURSE_IDENTITY_MAX_LENGTH, true),
  }) });
}
export function parseAssistantCalendarBatchPlan(raw: unknown, expectedScope?: PersonalImportScope): AssistantCalendarBatchPlan {
  const value = object(raw, ['id', 'owner', 'schoolId', 'createdAt', 'kind', 'steps', 'cancelledAt']);
  const scope = scopeValue({ owner: value.owner, schoolId: value.schoolId });
  if (expectedScope && (scope.owner !== expectedScope.owner || scope.schoolId !== expectedScope.schoolId)) return invalid();
  if (value.kind !== undefined && value.kind !== 'coursework-study') return invalid();
  const coursework = value.kind === 'coursework-study';
  const id = identifier(value.id);
  // These persisted IDs retain the mode if a damaged JSON document loses its
  // kind/source fields. Old generic IDs and their storage format stay valid.
  if (id.startsWith(ASSISTANT_CALENDAR_COURSEWORK_PLAN_PREFIX) !== coursework) return invalid();
  if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > ASSISTANT_CALENDAR_BATCH_MAX_STEPS ||
      Array.from(value.steps).some((step) => !step || typeof step !== 'object')) return invalid();
  const steps = value.steps.map((item) => {
    const step = object(item, ['id', 'event', 'source']);
    const stepId = identifier(step.id);
    if (stepId.startsWith(ASSISTANT_CALENDAR_COURSEWORK_STEP_PREFIX) !== coursework ||
        (!coursework && step.source !== undefined)) return invalid();
    let event: AssistantCalendarEvent;
    try { event = parseAssistantCalendarEvent(step.event); } catch { return invalid(); }
    return Object.freeze({ id: stepId, event: Object.freeze(event),
      ...(coursework ? { source: stepSource(step.source, scope) } : {}),
    });
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length ||
      new Set(steps.map((step) => assistantCalendarEventIdentity(step.event))).size !== steps.length) return invalid();
  if (coursework && new Set(steps.map((step) => JSON.stringify([
    step.source!.locator.accountId, step.source!.locator.schoolId,
    step.source!.locator.workspaceId, step.source!.locator.assignmentId,
  ]))).size !== steps.length) return invalid();
  return Object.freeze({
    id, ...scope, createdAt: instant(value.createdAt),
    ...(coursework ? { kind: 'coursework-study' as const } : {}), steps: Object.freeze(steps),
    ...(value.cancelledAt !== undefined ? { cancelledAt: instant(value.cancelledAt) } : {}),
  });
}
export function assistantCalendarBatchPlanKey(plan: AssistantCalendarBatchPlan): string {
  return JSON.stringify(plan.steps.map((step) => assistantCalendarEventIdentity(step.event)));
}
/** cancelledAt is deliberately separate: the original reviewed plan never changes. */
export function sameAssistantCalendarBatchPlan(first: AssistantCalendarBatchPlan, second: AssistantCalendarBatchPlan): boolean {
  return first.id === second.id && first.owner === second.owner && first.schoolId === second.schoolId &&
    first.createdAt === second.createdAt && first.kind === second.kind && JSON.stringify(first.steps) === JSON.stringify(second.steps);
}
function sameEvents(first: AssistantCalendarBatchPlan, second: AssistantCalendarBatchPlan) {
  return first.kind === second.kind && JSON.stringify(first.steps.map(({ event, source }) => ({ event, source }))) ===
    JSON.stringify(second.steps.map(({ event, source }) => ({ event, source })));
}
function utf8Bytes(raw: string) {
  let length = 0;
  for (const char of raw) {
    const code = char.codePointAt(0)!;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}
function checkSize(raw: string) {
  if (raw.length > ASSISTANT_CALENDAR_BATCH_MAX_BYTES || utf8Bytes(raw) > ASSISTANT_CALENDAR_BATCH_MAX_BYTES)
    throw new AssistantCalendarBatchError('batch-full');
}
function storeValue(raw: string | null, scope: PersonalImportScope): Store {
  if (raw === null) return { version: 1, ...scope, plans: [] };
  checkSize(raw);
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return invalid(); }
  const value = object(decoded, ['version', 'owner', 'schoolId', 'plans']);
  if (value.version !== 1 || value.owner !== scope.owner || value.schoolId !== scope.schoolId || !Array.isArray(value.plans)) return invalid();
  if (value.plans.length > ASSISTANT_CALENDAR_BATCH_MAX_PLANS) throw new AssistantCalendarBatchError('batch-full');
  const plans = value.plans.map((plan) => parseAssistantCalendarBatchPlan(plan, scope));
  const active = plans.filter((plan) => !plan.cancelledAt);
  if (new Set(plans.map((plan) => plan.id)).size !== plans.length ||
      new Set(active.map(assistantCalendarBatchPlanKey)).size !== active.length) return invalid();
  return { version: 1, ...scope, plans };
}

export function assistantCalendarBatchStorageKey(scope: PersonalImportScope): string {
  const target = scopeValue(scope);
  return 'campus.assistant-calendar-batches.v1:' + encodeURIComponent(target.owner) + ':' + encodeURIComponent(target.schoolId);
}
function locked<T>(scope: PersonalImportScope, work: () => Promise<T>): Promise<T> {
  const key = assistantCalendarBatchStorageKey(scope);
  const task = (locks.get(key) || Promise.resolve()).catch(() => undefined).then(work);
  locks.set(key, task);
  void task.finally(() => { if (locks.get(key) === task) locks.delete(key); }).catch(() => undefined);
  return task;
}
async function bounded<T>(scope: PersonalImportScope, active: () => boolean,
  work: (current: () => boolean) => Promise<T>): Promise<T> {
  requireActive(scope, active);
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => running && active();
  try {
    const result = await Promise.race([
      work(current),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { running = false; reject(new AssistantCalendarBatchError('batch-timeout')); }, WAIT_MS);
      }),
    ]);
    requireActive(scope, active);
    return result;
  } finally {
    running = false;
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function read(scope: PersonalImportScope, active: () => boolean): Promise<Store> {
  requireActive(scope, active);
  let raw: string | null;
  try { raw = await AsyncStorage.getItem(assistantCalendarBatchStorageKey(scope)); }
  catch { requireActive(scope, active); throw new AssistantCalendarBatchError('batch-unavailable'); }
  requireActive(scope, active);
  return storeValue(raw, scope);
}
async function write(store: Store, active: () => boolean): Promise<void> {
  const scope = { owner: store.owner, schoolId: store.schoolId };
  const serialized = JSON.stringify(store);
  checkSize(serialized);
  requireActive(scope, active);
  try {
    const key = assistantCalendarBatchStorageKey(scope);
    await AsyncStorage.setItem(key, serialized);
    requireActive(scope, active);
    const saved = await AsyncStorage.getItem(key);
    requireActive(scope, active);
    if (saved !== serialized) throw new AssistantCalendarBatchError('batch-write-unverified');
    storeValue(saved, scope);
  } catch (error) {
    requireActive(scope, active);
    if (error instanceof AssistantCalendarBatchError) throw error;
    throw new AssistantCalendarBatchError('batch-write-unverified');
  }
}

export function readAssistantCalendarBatchPlans(scope: PersonalImportScope, active: () => boolean): Promise<AssistantCalendarBatchPlan[]> {
  const target = scopeValue(scope);
  return bounded(target, active, (current) => locked(target, async () => (await read(target, current)).plans));
}

/** Saving a plan grants no operation authority and creates no single-operation journal entries. */
export function saveAssistantCalendarBatchPlan(rawPlan: AssistantCalendarBatchPlan,
  active: () => boolean): Promise<AssistantCalendarBatchPlan> {
  const plan = parseAssistantCalendarBatchPlan(rawPlan);
  const scope = { owner: plan.owner, schoolId: plan.schoolId };
  return bounded(scope, active, (current) => locked(scope, async () => {
    const store = await read(scope, current);
    const sameId = store.plans.find((candidate) => candidate.id === plan.id);
    if (sameId) {
      if (!sameAssistantCalendarBatchPlan(sameId, plan)) return invalid();
      return sameId; // Never clear or replace an existing cancellation.
    }
    const existing = store.plans.find((candidate) => !candidate.cancelledAt &&
      assistantCalendarBatchPlanKey(candidate) === assistantCalendarBatchPlanKey(plan));
    if (existing) {
      if (!sameEvents(existing, plan)) throw new AssistantCalendarBatchError('batch-conflict');
      return existing;
    }
    if (store.plans.length >= ASSISTANT_CALENDAR_BATCH_MAX_PLANS) throw new AssistantCalendarBatchError('batch-full');
    await write({ ...store, plans: [...store.plans, plan] }, current);
    return plan;
  }));
}

/** Cancellation only stops remaining work. It never removes a plan or an operation's evidence. */
export function cancelAssistantCalendarBatchPlan(planId: string, scope: PersonalImportScope,
  active: () => boolean): Promise<AssistantCalendarBatchPlan> {
  const target = scopeValue(scope);
  identifier(planId);
  return bounded(target, active, (current) => locked(target, async () => {
    const store = await read(target, current);
    const plan = store.plans.find((candidate) => candidate.id === planId);
    if (!plan) return invalid();
    if (plan.cancelledAt) return plan;
    const cancelled = Object.freeze({ ...plan, cancelledAt: new Date().toISOString() });
    await write({ ...store, plans: store.plans.map((candidate) => candidate.id === planId ? cancelled : candidate) }, current);
    return cancelled;
  }));
}
