import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { makeScopedStoragePrefix } from '@campus/shared/src/tenant';
import type { CampusEvidencePlan } from './offlineCampusPlanner';
import { copyCampusEvidencePlan, savedPlanTimestamp } from './savedCampusPlanValidation';

export type SavedCampusPlanScope = { owner: string; schoolId: string };
export type SavedCampusPlan = {
  id: string;
  question: string;
  plan: CampusEvidencePlan;
  savedAt: string;
  updatedAt: string;
  /** Personal checklist only; never evidence of a school submission or transaction. */
  completedStepIds: string[];
};

export const SAVED_CAMPUS_PLAN_LIMIT = 12;
const PREFIX = makeScopedStoragePrefix('assistant-plans-v1');
const MAX_PLAN_BYTES = 200_000;
// Source identities add bounded display evidence without reducing the existing plan allowance.
const MAX_COMPARISON_BYTES = 350_000;
const MAX_STORE_BYTES = 900_000;
const SESSION_EPOCH = Symbol('saved-campus-plan-session');
export type SavedCampusPlanSession = (() => boolean) & { readonly [SESSION_EPOCH]: number };

type ErrorCode = 'invalid-scope' | 'session-changed' | 'invalid-plan' | 'corrupt-storage' |
  'read-failed' | 'write-failed' | 'limit-reached' | 'storage-limit' | 'not-found' | 'invalid-step' | 'cleanup-failed';
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  'invalid-scope': '請先確認目前的帳號與學校，再使用已儲存計畫。',
  'session-changed': '帳號或學校狀態已改變，請重新開啟計畫；本次結果未套用。',
  'invalid-plan': '這份計畫的格式或內容無法儲存，請重新整理計畫。',
  'corrupt-storage': '已儲存計畫無法讀取，原資料沒有被覆寫。請稍後重新載入。',
  'read-failed': '暫時無法讀取已儲存計畫，請重新載入。',
  'write-failed': '手機未能儲存這次變更，請重試。',
  'limit-reached': '最多可儲存 12 份計畫，請先移除不再需要的計畫。',
  'storage-limit': '已儲存計畫的內容已達容量限制，請先移除不再需要的計畫。',
  'not-found': '這份計畫已被移除，請重新載入清單。',
  'invalid-step': '這個步驟已不在計畫中，請重新載入清單。',
  'cleanup-failed': '未能清除手機內的已儲存計畫，請稍後重新嘗試登出。',
};
export class SavedCampusPlansError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SavedCampusPlansError';
  }
}

let epoch = 0;
let signingOut = false;
let cleanupFlight: Promise<void> | null = null;
let cleanupFinished = false;
const pending = new Map<string, Promise<void>>();
const invalidationListeners = new Set<() => void>();

/** No plan contents are published; mounted screens only learn that their lease expired. */
export function subscribeSavedCampusPlanInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}

/** Keep one lease for a mounted account/campus. Sign-out permanently revokes it. */
export function createSavedCampusPlanSession(isCurrent: () => boolean): SavedCampusPlanSession {
  const captured = epoch;
  const session = () => {
    if (signingOut || epoch !== captured) return false;
    try { return isCurrent(); } catch { return false; }
  };
  return Object.assign(session, { [SESSION_EPOCH]: captured });
}

function scopeCopy(scope: SavedCampusPlanScope): SavedCampusPlanScope {
  const hasControl = (value: string) => Array.from(value).some((character) => {
    const point = character.charCodeAt(0);
    return point < 32 || point === 127;
  });
  if (!scope || typeof scope.owner !== 'string' || !/^(?:firebase|nuni):\S+$/.test(scope.owner) ||
      scope.owner.length > 256 || hasControl(scope.owner) || typeof scope.schoolId !== 'string' || !scope.schoolId.trim() ||
      scope.schoolId.trim() !== scope.schoolId || scope.schoolId.length > 200 || hasControl(scope.schoolId)) {
    throw new SavedCampusPlansError('invalid-scope');
  }
  return { owner: scope.owner, schoolId: scope.schoolId };
}

export function savedCampusPlansStorageKey(scope: SavedCampusPlanScope): string {
  const value = scopeCopy(scope);
  // The general scoped-key sanitizer collapses punctuation; tuples must stay exact.
  return PREFIX + JSON.stringify([value.owner, value.schoolId]);
}

function checkSession(session: SavedCampusPlanSession, expected: number): void {
  if (!session || session[SESSION_EPOCH] !== expected || expected !== epoch || signingOut || !session()) {
    throw new SavedCampusPlansError('session-changed');
  }
}

function context(scope: SavedCampusPlanScope, session: SavedCampusPlanSession) {
  const value = scopeCopy(scope);
  const expected = session?.[SESSION_EPOCH];
  const check = () => checkSession(session, expected);
  check();
  return { scope: value, key: savedCampusPlansStorageKey(value), check };
}
type Context = ReturnType<typeof context>;

function inOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => undefined, () => undefined);
  pending.set(key, settled);
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
  return result;
}

/** UTF-8 size check also works in Hermes without a TextEncoder polyfill. */
function withinBytes(value: string, limit: number): boolean {
  if (value.length > limit) return false;
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > limit) return false;
  }
  return true;
}

function questionText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1600) throw new SavedCampusPlansError('invalid-plan');
  return value;
}

function planCopy(value: unknown): CampusEvidencePlan {
  try {
    const plan = copyCampusEvidencePlan(value);
    const { comparisonBasis, ...content } = plan;
    if (!withinBytes(JSON.stringify(content), MAX_PLAN_BYTES) ||
        (comparisonBasis && !withinBytes(JSON.stringify(comparisonBasis), MAX_COMPARISON_BYTES))) {
      throw new Error('oversized-plan');
    }
    return plan;
  } catch {
    throw new SavedCampusPlansError('invalid-plan');
  }
}

function restore(raw: string, scope: SavedCampusPlanScope): SavedCampusPlan[] {
  try {
    if (!withinBytes(raw, MAX_STORE_BYTES)) throw new Error('oversized-store');
    const store = JSON.parse(raw);
    if (!store || store.version !== 1 || store.owner !== scope.owner || store.schoolId !== scope.schoolId ||
        !Array.isArray(store.plans) || store.plans.length > SAVED_CAMPUS_PLAN_LIMIT) throw new Error('invalid-store');
    const plans: SavedCampusPlan[] = store.plans.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid-entry');
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== 'string' || !/^plan-[a-f0-9-]{36}$/.test(entry.id) ||
          !Array.isArray(entry.completedStepIds) || entry.completedStepIds.length > 5) throw new Error('invalid-entry');
      const plan = planCopy(entry.plan);
      const completed = entry.completedStepIds;
      if (new Set(completed).size !== completed.length ||
          completed.some((id) => typeof id !== 'string' || !plan.steps.some((step) => step.id === id))) throw new Error('invalid-progress');
      const savedAt = savedPlanTimestamp(entry.savedAt);
      const updatedAt = savedPlanTimestamp(entry.updatedAt);
      if (Date.parse(updatedAt) < Date.parse(savedAt)) throw new Error('invalid-entry-time');
      return {
        id: entry.id,
        question: questionText(entry.question),
        plan,
        savedAt,
        updatedAt,
        completedStepIds: plan.steps.filter((step) => completed.includes(step.id)).map((step) => step.id),
      };
    });
    if (new Set(plans.map((entry) => entry.id)).size !== plans.length) throw new Error('duplicate-plan');
    return plans;
  } catch {
    throw new SavedCampusPlansError('corrupt-storage');
  }
}

async function read(context: Context): Promise<SavedCampusPlan[]> {
  context.check();
  let raw: string | null;
  try { raw = await AsyncStorage.getItem(context.key); }
  catch { context.check(); throw new SavedCampusPlansError('read-failed'); }
  context.check();
  return raw === null ? [] : restore(raw, context.scope);
}

async function write(context: Context, plans: SavedCampusPlan[]): Promise<SavedCampusPlan[]> {
  const raw = JSON.stringify({ version: 1, ...context.scope, plans });
  if (!withinBytes(raw, MAX_STORE_BYTES)) throw new SavedCampusPlansError('storage-limit');
  context.check();
  try { await AsyncStorage.setItem(context.key, raw); }
  catch { context.check(); throw new SavedCampusPlansError('write-failed'); }
  context.check();
  return plans;
}

export async function readSavedCampusPlans(scope: SavedCampusPlanScope, session: SavedCampusPlanSession): Promise<SavedCampusPlan[]> {
  const ctx = context(scope, session);
  return inOrder(ctx.key, () => read(ctx));
}

export async function saveCampusPlan(
  scope: SavedCampusPlanScope,
  input: { question: string; plan: CampusEvidencePlan },
  session: SavedCampusPlanSession,
): Promise<SavedCampusPlan[]> {
  const ctx = context(scope, session);
  // Capture before queueing: edits to a caller's object cannot change an accepted save.
  const question = questionText(input?.question);
  const plan = planCopy(input?.plan);
  const fingerprint = JSON.stringify({ question, plan });
  return inOrder(ctx.key, async () => {
    const plans = await read(ctx);
    ctx.check();
    if (plans.some((entry) => JSON.stringify({ question: entry.question, plan: entry.plan }) === fingerprint)) return plans;
    if (plans.length >= SAVED_CAMPUS_PLAN_LIMIT) throw new SavedCampusPlansError('limit-reached');
    ctx.check();
    let id: string;
    try { id = 'plan-' + randomUUID(); }
    catch { throw new SavedCampusPlansError('write-failed'); }
    if (!/^plan-[a-f0-9-]{36}$/.test(id) || plans.some((entry) => entry.id === id)) throw new SavedCampusPlansError('write-failed');
    const savedAt = new Date().toISOString();
    return write(ctx, [{ id, question, plan, savedAt, updatedAt: savedAt, completedStepIds: [] }, ...plans]);
  });
}

export async function setCampusPlanStepDone(
  scope: SavedCampusPlanScope,
  id: string,
  stepId: string,
  done: boolean,
  session: SavedCampusPlanSession,
): Promise<SavedCampusPlan[]> {
  const ctx = context(scope, session);
  return inOrder(ctx.key, async () => {
    const plans = await read(ctx);
    ctx.check();
    const entry = plans.find((item) => item.id === id);
    if (!entry) throw new SavedCampusPlansError('not-found');
    if (typeof done !== 'boolean' || !entry.plan.steps.some((step) => step.id === stepId)) throw new SavedCampusPlansError('invalid-step');
    if (entry.completedStepIds.includes(stepId) === done) return plans;
    const completed = new Set(entry.completedStepIds);
    if (done) completed.add(stepId); else completed.delete(stepId);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(entry.updatedAt))).toISOString();
    return write(ctx, plans.map((item) => item.id === id ? { ...item, updatedAt,
      completedStepIds: item.plan.steps.filter((step) => completed.has(step.id)).map((step) => step.id) } : item));
  });
}

export async function deleteSavedCampusPlan(
  scope: SavedCampusPlanScope,
  id: string,
  session: SavedCampusPlanSession,
): Promise<SavedCampusPlan[]> {
  const ctx = context(scope, session);
  return inOrder(ctx.key, async () => {
    const plans = await read(ctx);
    ctx.check();
    const remaining = plans.filter((entry) => entry.id !== id);
    return remaining.length === plans.length ? plans : write(ctx, remaining);
  });
}

/** Fence synchronously, then drain writes before deleting, even if other cleanup runs first. */
export function beginSavedCampusPlansSignOutCleanup(): Promise<void> {
  if (cleanupFlight) return cleanupFlight;
  signingOut = true;
  epoch += 1;
  cleanupFinished = false;
  cleanupFlight = (async () => {
    await Promise.allSettled([...pending.values()]);
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch { throw new SavedCampusPlansError('cleanup-failed'); }
    finally { cleanupFinished = true; }
  })();
  for (const listener of [...invalidationListeners]) {
    try { listener(); } catch { /* One view cannot interrupt account cleanup. */ }
  }
  return cleanupFlight;
}

/** Call after cleanup settles and sign-out finishes. Old mounted sessions stay invalid. */
export function endSavedCampusPlansSignOutCleanup(): void {
  if (!cleanupFlight || !cleanupFinished) return;
  epoch += 1;
  signingOut = false;
  cleanupFlight = null;
  cleanupFinished = false;
}
