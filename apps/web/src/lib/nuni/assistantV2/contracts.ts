import { createHash } from 'node:crypto';
import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import type { PlatformAssistantPermissions } from '@campus/shared/src/platformAssistantPermissions';
if (typeof window !== 'undefined') throw new Error('Server only');
export class V2Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
    readonly providerCode?: string,
  ) {
    super(code);
  }
}
export const fail = (code = 'INVALID_INPUT', status = 422): never => {
  throw new V2Error(status, code);
};
export type Obj = Record<string, unknown>;
export function object(raw: unknown, keys?: string[]): Obj {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const v = raw as Obj;
  if (keys && Object.keys(v).some((k) => !keys.includes(k))) return fail();
  return v;
}
export function text(raw: unknown, max = 120): string {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
  )
    return fail();
  return raw.trim();
}
export const id = (v: unknown) => {
  const s = text(v, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return fail();
  return s;
};
export function date(v: unknown): string {
  const s = text(v, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    return fail();
  return s;
}
export function clock(v: unknown): string {
  const s = text(v, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return fail();
  return s;
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((v as Obj)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
export function clip(s: string, max: number): string {
  let out = '';
  for (const c of s) {
    if (Buffer.byteLength(out + c) > max) break;
    out += c;
  }
  return out;
}
export const taipeiDate = (now: number) => new Date(now + 28800000).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) =>
  new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
export type History = { role: 'user' | 'assistant'; content: string }[];
export function history(raw: unknown): History {
  if (!Array.isArray(raw) || raw.length > 12) return fail();
  const h = raw.map((item) => {
    const v = object(item, ['role', 'content']);
    if (!['user', 'assistant'].includes(String(v.role))) return fail();
    return { role: v.role as 'user' | 'assistant', content: text(v.content, 4000) };
  });
  let remaining = 400;
  return h
    .reverse()
    .flatMap((v) => {
      const content = clip(v.content, remaining);
      remaining -= Buffer.byteLength(content);
      return content ? [{ ...v, content }] : [];
    })
    .reverse();
}
export type EventArgs = {
  title: string;
  date: string;
  endDate?: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
};
export function eventArgs(raw: unknown): EventArgs {
  const v = object(raw, ['title', 'date', 'endDate', 'allDay', 'startTime', 'endTime']);
  if (typeof v.allDay !== 'boolean') return fail();
  const out: EventArgs = { title: text(v.title), date: date(v.date), allDay: v.allDay };
  if (v.endDate !== undefined) {
    out.endDate = date(v.endDate);
    if (out.endDate < out.date || (out.allDay && out.endDate === out.date)) return fail();
  }
  if (!out.allDay) {
    out.startTime = clock(v.startTime);
    out.endTime = clock(v.endTime);
    if ((out.endDate || out.date) === out.date && out.startTime >= out.endTime) return fail();
  } else if (v.startTime !== undefined || v.endTime !== undefined) return fail();
  if (out.endDate && Date.parse(out.endDate) - Date.parse(out.date) > 31 * 86400000) return fail();
  // Every proposed event must also be representable by the shared verified
  // receipt; do not discover an invalid date or control character after writing.
  try { parseAssistantCalendarEvent(out); } catch { return fail(); }
  return out;
}
export type Binding = {
  account: string;
  session: string;
  conversationId: string;
  schoolId: string;
};
export type Card = {
  tool: 'propose_personal_event' | 'propose_open_page' | 'propose_food_order';
  args: Obj;
  token: string;
  mutationId: string;
  schoolId: string;
  destination: string;
};
export type Step = { name: string; status: 'ok' | 'error' | 'cached'; summary: string };
export type Message = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type ModelInput = {
  messages: Message[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none';
  max_completion_tokens: number;
  signal: AbortSignal;
};
export type ModelResult = {
  message: Message;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finishReason?: string;
};
export type Model = (input: ModelInput) => Promise<ModelResult>;
export type Ledger = {
  schoolId: string;
  revision: number;
  records: import('@campus/shared/src/imports/types').PersonalImportRecord[];
  updatedAt: string | null;
};
export type Course = { id: string; title: string };
export type Task = {
  id: string;
  courseId: string;
  kind?: 'assignment' | 'quiz';
  title: string;
  dueAt: string | null;
  submitted: boolean;
  state: string;
};
export type Adapter = {
  simulation: boolean;
  permissions?(): Promise<PlatformAssistantPermissions>;
  remainingApiCalls?(): number;
  food?: {
    enabled(): boolean;
    onlineEnabled?(): boolean;
    paymentRequired: boolean;
    locations(tenantId: string): Promise<unknown>;
    menu(
      tenantId: string,
      locationId: string,
    ): Promise<import('@campus/shared/src/nuniFood').NuniFoodMenuProjection>;
    submit(cart: import('./food').FoodCart, mutationId: string): Promise<unknown>;
  };
  ledger(): Promise<Ledger>;
  courses(): Promise<{ courses: Course[]; partial: boolean }>;
  work(courseId: string): Promise<Task[]>;
  materials(courseId: string, cursor?: string): Promise<unknown>;
  realms(): Promise<{ tenantId: string; schoolId?: string }[]>;
  orders(
    tenantId: string,
    cursor?: string,
    options?: { state?: string; limit?: number },
  ): Promise<{
    orders: { id: string; state: string; title?: string; locationId?: string; createdAt?: string }[];
    nextCursor?: string;
  }>;
  order(tenantId: string, orderId: string): Promise<unknown>;
  clubs(
    tenantId: string,
    membership: string,
    cursor?: string,
  ): Promise<{ communities: { id: string; title: string }[]; nextCursor?: string }>;
  feed(tenantId: string, communityId: string, cursor?: string): Promise<unknown>;
  dining(locationId?: string): Promise<{
    cafeterias?: { id: string; name: string; location?: string; openingHours?: string }[];
    [key: string]: unknown;
  }>;
  transit(args: Obj): Promise<unknown>;
  notifications(limit: number): Promise<unknown>;
  write(input: {
    schoolId: string;
    expectedRevision: number;
    records: Ledger['records'];
    mutationId: string;
  }): Promise<Ledger>;
};
export type AssistantPermissionKey = keyof PlatformAssistantPermissions;
export const ASSISTANT_PERMISSION_SETTINGS_HREF = '/settings?section=assistant';

export function proposalPermission(name: string): AssistantPermissionKey | undefined {
  if (name === 'propose_personal_event' || name === 'propose_study_plan') return 'createPersonalEvent';
  if (name === 'propose_food_order' || name === 'reorder_last_food_order') return 'prepareFoodOrder';
}

/** Read again for each proposal and execution. Missing or unusable storage keeps existing actions available. */
export async function requireAssistantPermission(adapter: Adapter, key: AssistantPermissionKey) {
  if (!adapter.permissions) return;
  let permissions: PlatformAssistantPermissions;
  try {
    permissions = await adapter.permissions();
  } catch (error) {
    if ((error as { status?: number }).status === 401) throw error;
    return;
  }
  if (!permissions) return;
  if (permissions[key] !== true) return fail('ASSISTANT_PERMISSION_DENIED', 403);
}

export function assistantPermissionRecovery(code: string) {
  if (code !== 'ASSISTANT_PERMISSION_DENIED' && code !== 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE') return;
  return {
    href: ASSISTANT_PERMISSION_SETTINGS_HREF,
    nextStep: code === 'ASSISTANT_PERMISSION_DENIED'
      ? '這項助理操作權限尚未開啟。請到設定的助理權限調整；不要自動重試或宣稱已產生確認卡。'
      : '目前無法確認助理操作權限。請到設定重新讀取；不要自動重試或宣稱已產生確認卡。',
  };
}
export async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  ms: number,
): Promise<T> {
  signal.throwIfAborted();
  const child = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => {
        child.abort();
        reject(new V2Error(499, 'ABORTED'));
      };
      timer = setTimeout(() => {
        child.abort();
        reject(new V2Error(504, 'DEADLINE_EXCEEDED'));
      }, ms);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => work(child.signal))
        .then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
