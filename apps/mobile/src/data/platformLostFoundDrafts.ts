import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  NUNI_LOST_FOUND_CATEGORIES,
  validateNuniLostFoundRequest,
  type NuniLostFoundCreateInput,
  type NuniLostFoundMutationInput,
  type NuniLostFoundUpdateInput,
} from '@campus/shared/src/nuniLostFound';
import type { LostFoundWriteFields } from '@campus/shared/src/lostFoundFields';

export type PlatformLostFoundScope = { accountId: string; schoolId: string };
export type PlatformLostFoundDraft = {
  mode: 'create' | 'update';
  id: string;
  expectedVersion?: number;
  fields: LostFoundWriteFields;
};
export type PlatformLostFoundPending =
  | { action: 'create'; input: NuniLostFoundCreateInput }
  | { action: 'update'; input: NuniLostFoundUpdateInput }
  | { action: 'resolve' | 'remove'; input: NuniLostFoundMutationInput };
export type PlatformLostFoundDeviceState = {
  draft: PlatformLostFoundDraft | null;
  pending: PlatformLostFoundPending | null;
};

const PREFIX = 'campus-one:platform-lost-found:v1:';
const queues = new Map<string, Promise<void>>();
const itemId = /^plf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const empty = (): PlatformLostFoundDeviceState => ({ draft: null, pending: null });

export class PlatformLostFoundStorageError extends Error {
  constructor(message = '這台手機暫時無法保存待確認操作。內容仍在畫面上，請重試後再送出。') {
    super(message);
    this.name = 'PlatformLostFoundStorageError';
  }
}

export class PlatformLostFoundScopeChanged extends Error {
  constructor() {
    super('帳號、校園或畫面已變更。');
    this.name = 'PlatformLostFoundScopeChanged';
  }
}

export function platformLostFoundStorageKey(scope: PlatformLostFoundScope) {
  if (
    !/^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(scope.accountId) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(scope.schoolId) ||
    ['personal', 'all', 'unavailable-campus'].includes(scope.schoolId)
  ) {
    throw new PlatformLostFoundStorageError('無法確認這份草稿的帳號與校園。');
  }
  return `${PREFIX}${scope.accountId}:${scope.schoolId}`;
}

function assertCurrent(current: () => boolean) {
  if (!current()) throw new PlatformLostFoundScopeChanged();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid record');
  return value as Record<string, unknown>;
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
}

function draft(value: unknown): PlatformLostFoundDraft | null {
  if (value === null) return null;
  const row = record(value);
  const fields = record(row.fields);
  if (
    !['create', 'update'].includes(String(row.mode)) ||
    typeof row.id !== 'string' ||
    !itemId.test(row.id) ||
    (row.mode === 'create'
      ? row.expectedVersion !== undefined
      : !Number.isSafeInteger(row.expectedVersion) ||
        Number(row.expectedVersion) < 1 ||
        Number(row.expectedVersion) > 2_147_483_646) ||
    !['lost', 'found'].includes(String(fields.type)) ||
    !NUNI_LOST_FOUND_CATEGORIES.includes(
      fields.category as (typeof NUNI_LOST_FOUND_CATEGORIES)[number],
    )
  ) {
    throw new Error('Invalid draft');
  }
  for (const [field, limit] of [
    ['title', 80],
    ['description', 2000],
    ['location', 120],
    ['date', 10],
    ['contactInfo', 200],
  ] as const) {
    if (
      typeof fields[field] !== 'string' ||
      fields[field].length > limit ||
      hasControlCharacters(fields[field])
    )
      throw new Error('Invalid field');
  }
  return {
    mode: row.mode as 'create' | 'update',
    id: row.id,
    ...(row.mode === 'update' ? { expectedVersion: Number(row.expectedVersion) } : {}),
    fields: {
      type: fields.type as 'lost' | 'found',
      category: fields.category as string,
      title: fields.title as string,
      description: fields.description as string,
      location: fields.location as string,
      date: fields.date as string,
      contactInfo: fields.contactInfo as string,
    },
  };
}

function pending(value: unknown, scope: PlatformLostFoundScope): PlatformLostFoundPending | null {
  if (value === null) return null;
  const row = record(value);
  if (!['create', 'update', 'resolve', 'remove'].includes(String(row.action)))
    throw new Error('Invalid action');
  const action = row.action as PlatformLostFoundPending['action'];
  const input = validateNuniLostFoundRequest(action, row.input);
  if (input.schoolId !== scope.schoolId) throw new Error('Wrong school');
  return { action, input } as PlatformLostFoundPending;
}

async function read(scope: PlatformLostFoundScope): Promise<PlatformLostFoundDeviceState> {
  const raw = await AsyncStorage.getItem(platformLostFoundStorageKey(scope));
  if (raw === null) return empty();
  try {
    if (raw.length > 32_000) throw new Error('Oversized record');
    const row = record(JSON.parse(raw));
    if (row.version !== 1 || row.accountId !== scope.accountId || row.schoolId !== scope.schoolId) {
      throw new Error('Wrong scope');
    }
    return { draft: draft(row.draft), pending: pending(row.pending, scope) };
  } catch {
    throw new PlatformLostFoundStorageError(
      '這台手機的失物招領草稿無法讀取。請先重試，或確認後清除本機紀錄。',
    );
  }
}

/** Serializes read-modify-write operations from screens sharing this device scope. */
async function serial<T>(scope: PlatformLostFoundScope, operation: () => Promise<T>): Promise<T> {
  const key = platformLostFoundStorageKey(scope);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  try {
    return await run;
  } catch (error) {
    if (
      error instanceof PlatformLostFoundStorageError ||
      error instanceof PlatformLostFoundScopeChanged
    )
      throw error;
    throw new PlatformLostFoundStorageError();
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

function samePending(a: PlatformLostFoundPending | null, b: PlatformLostFoundPending) {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

async function write(
  scope: PlatformLostFoundScope,
  state: PlatformLostFoundDeviceState,
  current: () => boolean,
) {
  assertCurrent(current);
  const key = platformLostFoundStorageKey(scope);
  const raw = JSON.stringify({ version: 1, ...scope, ...state });
  await AsyncStorage.setItem(key, raw);
  assertCurrent(current);
  if ((await AsyncStorage.getItem(key)) !== raw) throw new PlatformLostFoundStorageError();
  assertCurrent(current);
  return state;
}

export async function readPlatformLostFoundDeviceState(
  scope: PlatformLostFoundScope,
  current: () => boolean,
) {
  const result = await serial(scope, async () => {
    assertCurrent(current);
    const state = await read(scope);
    assertCurrent(current);
    return state;
  });
  assertCurrent(current);
  return result;
}

export async function savePlatformLostFoundDraft(
  scope: PlatformLostFoundScope,
  value: PlatformLostFoundDraft,
  current: () => boolean,
) {
  let parsed: PlatformLostFoundDraft;
  try {
    parsed = draft(value)!;
  } catch {
    throw new PlatformLostFoundStorageError('草稿欄位無法保存，請檢查內容長度與特殊字元。');
  }
  const result = await serial(scope, async () => {
    assertCurrent(current);
    const state = await read(scope);
    if (state.pending)
      throw new PlatformLostFoundStorageError('還有一則操作待確認，請先重試確認。');
    if (state.draft && (state.draft.id !== parsed.id || state.draft.mode !== parsed.mode)) {
      throw new PlatformLostFoundStorageError('這個校園已有另一份本機草稿，請先繼續編輯或捨棄。');
    }
    return write(scope, { ...state, draft: parsed }, current);
  });
  assertCurrent(current);
  return result;
}

export async function savePlatformLostFoundPending(
  scope: PlatformLostFoundScope,
  value: PlatformLostFoundPending,
  current: () => boolean,
) {
  const parsed = pending(value, scope)!;
  const result = await serial(scope, async () => {
    assertCurrent(current);
    const state = await read(scope);
    if (state.pending && !samePending(state.pending, parsed)) {
      throw new PlatformLostFoundStorageError('這個校園已有另一則操作待確認，請先重試確認。');
    }
    return write(scope, { ...state, pending: parsed }, current);
  });
  assertCurrent(current);
  return result;
}

export async function finishPlatformLostFoundPending(
  scope: PlatformLostFoundScope,
  value: PlatformLostFoundPending,
  current: () => boolean,
  keepDraft = false,
) {
  const parsed = pending(value, scope)!;
  const result = await serial(scope, async () => {
    assertCurrent(current);
    const state = await read(scope);
    if (!state.pending) return state;
    if (state.pending && !samePending(state.pending, parsed)) {
      throw new PlatformLostFoundStorageError('待確認操作已變更，請重新讀取。');
    }
    return write(
      scope,
      {
        pending: null,
        draft: !keepDraft && state.draft?.id === parsed.input.id ? null : state.draft,
      },
      current,
    );
  });
  assertCurrent(current);
  return result;
}

export async function discardPlatformLostFoundDraft(
  scope: PlatformLostFoundScope,
  id: string,
  current: () => boolean,
) {
  const result = await serial(scope, async () => {
    assertCurrent(current);
    const state = await read(scope);
    if (state.pending) throw new PlatformLostFoundStorageError('操作仍待確認，請先重試確認。');
    if (state.draft && state.draft.id !== id)
      throw new PlatformLostFoundStorageError('草稿已變更，請重新讀取。');
    return write(scope, empty(), current);
  });
  assertCurrent(current);
  return result;
}

/** Only called after the user explicitly confirms clearing this account's local scope. */
export async function clearPlatformLostFoundDeviceState(
  scope: PlatformLostFoundScope,
  current: () => boolean,
) {
  await serial(scope, async () => {
    assertCurrent(current);
    const key = platformLostFoundStorageKey(scope);
    await AsyncStorage.removeItem(key);
    assertCurrent(current);
    if ((await AsyncStorage.getItem(key)) !== null) throw new PlatformLostFoundStorageError();
    assertCurrent(current);
  });
  assertCurrent(current);
}
