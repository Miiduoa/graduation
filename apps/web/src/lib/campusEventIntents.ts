import {
  assertEventId,
  assertEventRegistrationCurrent,
  changeEventRegistration,
  createCampusEventRegistrationRequestId,
  verifyEventRegistrationMutationResult,
  type EventRegistrationMutationResult,
  type EventRegistrationScope,
} from './campusEventRegistration';

export type CampusEventIntentAction = 'register' | 'cancel';

export type CampusEventRegistrationIntent = {
  version: 1;
  uid: string;
  schoolId: string;
  eventId: string;
  action: CampusEventIntentAction;
  requestId: string;
  createdAt: string;
};

const INTENT_VERSION = 1 as const;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,160}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const LOCK_UNSUPPORTED =
  '目前瀏覽器無法安全儲存待確認操作。請用最新版瀏覽器開啟 HTTPS 網站後重試。';
const STORAGE_FAILURE =
  '這次沒有存成報名紀錄，可能是裝置空間不足或瀏覽器禁止儲存。尚未送出網路請求。';
const CORRUPT_FAILURE =
  '這份待確認操作暫時讀不到，原始資料仍保留。請勿清除瀏覽器資料，稍後再試。';
const CLEANUP_UNRESOLVED =
  '報名已確認，但此裝置的紀錄尚未更新，請重試';

export function campusEventIntentsStorageKey(scope: EventRegistrationScope): string {
  return `campus.event-registration-intents.v1:${encodeURIComponent(scope.uid)}:${encodeURIComponent(scope.schoolId)}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPrototypeHazardKey(value: string): boolean {
  return value === '__proto__' || value === 'constructor' || value === 'prototype';
}

function validIntent(
  value: unknown,
  scope: EventRegistrationScope,
  eventId?: string,
): value is CampusEventRegistrationIntent {
  if (
    !object(value) ||
    value.version !== INTENT_VERSION ||
    value.uid !== scope.uid ||
    value.schoolId !== scope.schoolId ||
    typeof value.eventId !== 'string' ||
    !EVENT_ID.test(value.eventId) ||
    value.eventId.includes('/') ||
    isPrototypeHazardKey(value.eventId) ||
    (eventId != null && value.eventId !== eventId) ||
    (value.action !== 'register' && value.action !== 'cancel') ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    return false;
  }
  return true;
}

function parseLedger(
  raw: string | null,
  scope: EventRegistrationScope,
): Record<string, CampusEventRegistrationIntent> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(CORRUPT_FAILURE);
  }
  if (!object(data) || data.version !== INTENT_VERSION || !object(data.intents)) {
    throw new Error(CORRUPT_FAILURE);
  }
  const intents: Record<string, CampusEventRegistrationIntent> = {};
  for (const [key, value] of Object.entries(data.intents)) {
    if (isPrototypeHazardKey(key)) {
      throw new Error(CORRUPT_FAILURE);
    }
    if (!validIntent(value, scope) || value.eventId !== key) {
      throw new Error(CORRUPT_FAILURE);
    }
    intents[key] = {
      version: INTENT_VERSION,
      uid: value.uid,
      schoolId: value.schoolId,
      eventId: value.eventId,
      action: value.action,
      requestId: value.requestId,
      createdAt: value.createdAt,
    };
  }
  return intents;
}

function serializeLedger(
  scope: EventRegistrationScope,
  intents: Record<string, CampusEventRegistrationIntent>,
): string {
  const cleaned: Record<string, CampusEventRegistrationIntent> = {};
  for (const [eventId, intent] of Object.entries(intents)) {
    if (isPrototypeHazardKey(eventId) || !validIntent(intent, scope, eventId)) {
      throw new Error(CORRUPT_FAILURE);
    }
    cleaned[eventId] = {
      version: INTENT_VERSION,
      uid: intent.uid,
      schoolId: intent.schoolId,
      eventId: intent.eventId,
      action: intent.action,
      requestId: intent.requestId,
      createdAt: intent.createdAt,
    };
  }
  return JSON.stringify({ version: INTENT_VERSION, intents: cleaned });
}

function requireLocks(): NonNullable<LockManager> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error(LOCK_UNSUPPORTED);
  }
  return navigator.locks;
}

function readRaw(scope: EventRegistrationScope): string | null {
  try {
    return localStorage.getItem(campusEventIntentsStorageKey(scope));
  } catch {
    throw new Error(CORRUPT_FAILURE);
  }
}

function writeRaw(
  scope: EventRegistrationScope,
  serialized: string,
  failureMessage: string,
): void {
  try {
    localStorage.setItem(campusEventIntentsStorageKey(scope), serialized);
  } catch {
    throw new Error(failureMessage);
  }
}

function readback(
  scope: EventRegistrationScope,
  expected: Record<string, CampusEventRegistrationIntent>,
): void {
  const actual = parseLedger(readRaw(scope), scope);
  const expectedJson = serializeLedger(scope, expected);
  const actualJson = serializeLedger(scope, actual);
  if (expectedJson !== actualJson) {
    throw new Error(CORRUPT_FAILURE);
  }
}

function sameIntent(
  left: CampusEventRegistrationIntent,
  right: CampusEventRegistrationIntent,
): boolean {
  return (
    left.version === right.version &&
    left.uid === right.uid &&
    left.schoolId === right.schoolId &&
    left.eventId === right.eventId &&
    left.action === right.action &&
    left.requestId === right.requestId &&
    left.createdAt === right.createdAt
  );
}

/**
 * Restore a prior ledger after a failed cleanup/prepare write verification.
 * Never overwrites a newer/different pending intent for the same event.
 */
function restoreLedger(
  scope: EventRegistrationScope,
  previous: Record<string, CampusEventRegistrationIntent>,
  protectedIntent: CampusEventRegistrationIntent | null,
): void {
  let current: Record<string, CampusEventRegistrationIntent>;
  try {
    current = parseLedger(readRaw(scope), scope);
  } catch {
    throw new Error(CLEANUP_UNRESOLVED);
  }
  if (protectedIntent) {
    const existing = current[protectedIntent.eventId];
    if (existing && !sameIntent(existing, protectedIntent)) {
      throw new Error(CLEANUP_UNRESOLVED);
    }
  }
  const serialized = serializeLedger(scope, previous);
  try {
    writeRaw(scope, serialized, CLEANUP_UNRESOLVED);
    readback(scope, previous);
  } catch {
    throw new Error(CLEANUP_UNRESOLVED);
  }
}

function commitLedger(
  scope: EventRegistrationScope,
  previous: Record<string, CampusEventRegistrationIntent>,
  next: Record<string, CampusEventRegistrationIntent>,
  protectedIntent: CampusEventRegistrationIntent | null,
): void {
  const serialized = serializeLedger(scope, next);
  // Prepare failures must not claim a network send; finalize cleanup failures
  // must keep the confirmed-result / device-record distinction.
  const writeFailure = protectedIntent ? CLEANUP_UNRESOLVED : STORAGE_FAILURE;
  try {
    writeRaw(scope, serialized, writeFailure);
  } catch (error) {
    throw error;
  }
  try {
    readback(scope, next);
  } catch (error) {
    restoreLedger(scope, previous, protectedIntent);
    if (error instanceof Error && error.message === CLEANUP_UNRESOLVED) {
      throw error;
    }
    // Readback tamper after a successful write: pending restored for retry.
    // Quota/write failures use writeFailure above (prepare vs finalize copy).
    throw new Error(CORRUPT_FAILURE);
  }
}

async function withIntentLock<T>(
  scope: EventRegistrationScope,
  current: () => boolean,
  action: (intents: Record<string, CampusEventRegistrationIntent>) => Promise<T> | T,
): Promise<T> {
  assertEventRegistrationCurrent(scope, current);
  const locks = requireLocks();
  return locks.request(campusEventIntentsStorageKey(scope), async () => {
    assertEventRegistrationCurrent(scope, current);
    const intents = parseLedger(readRaw(scope), scope);
    return action(intents);
  });
}

function copyIntent(intent: CampusEventRegistrationIntent): CampusEventRegistrationIntent {
  return {
    version: INTENT_VERSION,
    uid: intent.uid,
    schoolId: intent.schoolId,
    eventId: intent.eventId,
    action: intent.action,
    requestId: intent.requestId,
    createdAt: intent.createdAt,
  };
}

export async function readPendingCampusEventIntent(
  scope: EventRegistrationScope,
  eventId: string,
  current: () => boolean = () => true,
): Promise<CampusEventRegistrationIntent | null> {
  assertEventId(eventId);
  return withIntentLock(scope, current, (intents) => {
    const pending = intents[eventId];
    return pending ? copyIntent(pending) : null;
  });
}

export async function prepareCampusEventIntent(
  scope: EventRegistrationScope,
  input: { eventId: string; action: CampusEventIntentAction },
  current: () => boolean = () => true,
): Promise<CampusEventRegistrationIntent> {
  assertEventId(input.eventId);
  if (input.action !== 'register' && input.action !== 'cancel') {
    throw new Error('Event registration status not confirmed');
  }

  return withIntentLock(scope, current, (intents) => {
    const existing = intents[input.eventId];
    if (existing) {
      if (existing.action !== input.action) {
        throw new Error('已有尚未完成的相反報名操作，請先完成這次待確認操作後再試。');
      }
      return copyIntent(existing);
    }

    const intent: CampusEventRegistrationIntent = {
      version: INTENT_VERSION,
      uid: scope.uid,
      schoolId: scope.schoolId,
      eventId: input.eventId,
      action: input.action,
      requestId: createCampusEventRegistrationRequestId(),
      createdAt: new Date().toISOString(),
    };
    if (!validIntent(intent, scope, input.eventId)) {
      throw new Error('Event registration status not confirmed');
    }

    const previous = { ...intents };
    const next = { ...intents, [input.eventId]: intent };
    commitLedger(scope, previous, next, null);
    return copyIntent(intent);
  });
}

/**
 * Submits the exact immutable intent the caller holds. Under the lock the stored
 * pending record must match; a different pending operation is never sent.
 */
export async function submitCampusEventIntent(
  scope: EventRegistrationScope,
  intent: CampusEventRegistrationIntent,
  current: () => boolean = () => true,
): Promise<EventRegistrationMutationResult> {
  if (!validIntent(intent, scope)) {
    throw new Error('Event registration status not confirmed');
  }

  const stored = await withIntentLock(scope, current, (intents) => {
    const pending = intents[intent.eventId];
    if (!pending || !sameIntent(pending, intent)) {
      throw new Error('找不到可送出的待確認操作。');
    }
    return copyIntent(pending);
  });

  assertEventRegistrationCurrent(scope, current);
  return changeEventRegistration(
    scope,
    {
      eventId: stored.eventId,
      requestId: stored.requestId,
      action: stored.action,
    },
    current,
  );
}

export async function finalizeCampusEventIntent(
  scope: EventRegistrationScope,
  intent: CampusEventRegistrationIntent,
  result: EventRegistrationMutationResult,
  current: () => boolean = () => true,
): Promise<boolean> {
  if (!validIntent(intent, scope)) {
    throw new Error('Event registration status not confirmed');
  }
  if (
    !verifyEventRegistrationMutationResult(result, {
      uid: intent.uid,
      schoolId: intent.schoolId,
      eventId: intent.eventId,
      action: intent.action,
      requestId: intent.requestId,
    })
  ) {
    throw new Error('Event registration not confirmed');
  }
  if (result.state.eventId !== intent.eventId) {
    throw new Error('Event registration scope mismatch');
  }

  return withIntentLock(scope, current, (intents) => {
    const pending = intents[intent.eventId];
    if (!pending || !sameIntent(pending, intent)) {
      return false;
    }

    const previous = { ...intents };
    const next = { ...intents };
    delete next[intent.eventId];
    commitLedger(scope, previous, next, intent);
    return true;
  });
}
