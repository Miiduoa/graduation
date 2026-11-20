import { httpsCallable } from 'firebase/functions';
import { collection, doc } from 'firebase/firestore';
import { getAuth, getDb, getFunctionsInstance, isFirebaseConfigured } from './firebase';
import type { CampusEventSource } from './campusEvents';

export type EventRegistrationStatus = 'registered' | 'cancelled' | 'not_registered';
export type EventRegistrationAvailability =
  | 'unavailable'
  | 'not_open'
  | 'closed'
  | 'full'
  | 'open';

export type EventRegistrationState = {
  eventId: string;
  policyConfirmed: boolean;
  status: EventRegistrationStatus;
  availability: EventRegistrationAvailability;
  count: number | null;
  capacity: number | null;
  canRegister: boolean;
  canCancel: boolean;
  opensAt: string | null;
  closesAt: string | null;
  cancellationClosesAt: string | null;
};

export type EventRegistrationScope = { uid: string; schoolId: string };

export type EventRegistrationMutationResult = {
  state: EventRegistrationState;
  reused: boolean;
};

export type EventRegistrationMutationClaims = {
  uid: string;
  schoolId: string;
  eventId: string;
  action: 'register' | 'cancel';
  requestId: string;
};

const STATUSES: EventRegistrationStatus[] = ['registered', 'cancelled', 'not_registered'];
const AVAILABILITIES: EventRegistrationAvailability[] = [
  'unavailable',
  'not_open',
  'closed',
  'full',
  'open',
];
const REQUEST_ID = /^[A-Za-z0-9_-]{16,160}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_UID_LENGTH = 128;
const MAX_BATCH = 40;

const mutationReceipts = new WeakMap<object, EventRegistrationMutationClaims>();

function isPrototypeHazardKey(value: string): boolean {
  return value === '__proto__' || value === 'constructor' || value === 'prototype';
}

function assertUid(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('/') ||
    value.length > MAX_UID_LENGTH ||
    isPrototypeHazardKey(value)
  ) {
    throw new Error('Event registration session changed');
  }
  return value;
}

function assertStableScopeId(value: string, name: string): string {
  if (!value || value.includes('/') || !EVENT_ID.test(value) || isPrototypeHazardKey(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function assertEventId(eventId: string): string {
  if (
    typeof eventId !== 'string' ||
    !EVENT_ID.test(eventId) ||
    eventId.includes('/') ||
    isPrototypeHazardKey(eventId)
  ) {
    throw new Error('Event registration status not confirmed');
  }
  return eventId;
}

export function assertEventRegistrationCurrent(
  scope: EventRegistrationScope,
  current: () => boolean,
): void {
  assertUid(scope.uid);
  assertStableScopeId(scope.schoolId, 'schoolId');
  if (!current() || !isFirebaseConfigured() || getAuth()?.currentUser?.uid !== scope.uid) {
    throw new Error('Event registration session changed');
  }
}

function finiteDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function mintMutationReceipt(
  result: EventRegistrationMutationResult,
  claims: EventRegistrationMutationClaims,
): EventRegistrationMutationResult {
  mutationReceipts.set(result, {
    uid: claims.uid,
    schoolId: claims.schoolId,
    eventId: claims.eventId,
    action: claims.action,
    requestId: claims.requestId,
  });
  return result;
}

/** Runtime-only verifier: accepts the exact object minted after a validated mutation callable. */
export function verifyEventRegistrationMutationResult(
  result: unknown,
  claims: EventRegistrationMutationClaims,
): result is EventRegistrationMutationResult {
  if (!result || typeof result !== 'object') return false;
  const recorded = mutationReceipts.get(result);
  if (!recorded) return false;
  return (
    recorded.uid === claims.uid &&
    recorded.schoolId === claims.schoolId &&
    recorded.eventId === claims.eventId &&
    recorded.action === claims.action &&
    recorded.requestId === claims.requestId
  );
}

export function validateEventRegistrationState(value: unknown): EventRegistrationState {
  const state = value as EventRegistrationState;
  if (
    !state ||
    typeof state !== 'object' ||
    typeof state.eventId !== 'string' ||
    !EVENT_ID.test(state.eventId) ||
    state.eventId.includes('/') ||
    isPrototypeHazardKey(state.eventId) ||
    !STATUSES.includes(state.status) ||
    !AVAILABILITIES.includes(state.availability) ||
    typeof state.policyConfirmed !== 'boolean' ||
    typeof state.canRegister !== 'boolean' ||
    typeof state.canCancel !== 'boolean' ||
    !(state.count === null || (Number.isSafeInteger(state.count) && state.count >= 0)) ||
    !(state.capacity === null || (Number.isSafeInteger(state.capacity) && state.capacity > 0)) ||
    [state.opensAt, state.closesAt, state.cancellationClosesAt].some(
      (date) => date !== null && !finiteDate(date),
    )
  ) {
    throw new Error('Event registration status not confirmed');
  }

  const registerAllowed = state.status !== 'registered' && state.availability === 'open';
  if (state.canRegister !== registerAllowed) {
    throw new Error('Event registration status not confirmed');
  }
  if (state.canCancel && state.status !== 'registered') {
    throw new Error('Event registration status not confirmed');
  }
  if (state.availability !== 'unavailable' && !state.policyConfirmed) {
    throw new Error('Event registration status not confirmed');
  }
  if (state.policyConfirmed) {
    if (state.count === null || !finiteDate(state.opensAt) || !finiteDate(state.closesAt)) {
      throw new Error('Event registration status not confirmed');
    }
    if (Date.parse(state.opensAt) >= Date.parse(state.closesAt)) {
      throw new Error('Event registration status not confirmed');
    }
  } else if (
    (state.opensAt !== null || state.closesAt !== null) &&
    (!finiteDate(state.opensAt) ||
      !finiteDate(state.closesAt) ||
      Date.parse(state.opensAt) >= Date.parse(state.closesAt))
  ) {
    throw new Error('Event registration status not confirmed');
  }
  if (state.availability === 'full') {
    if (state.capacity === null || state.count === null || state.count < state.capacity) {
      throw new Error('Event registration status not confirmed');
    }
  }
  if (
    state.availability === 'open' &&
    state.capacity !== null &&
    (state.count === null || state.count >= state.capacity)
  ) {
    throw new Error('Event registration status not confirmed');
  }
  if (state.canCancel) {
    if (state.count === null || !finiteDate(state.cancellationClosesAt)) {
      throw new Error('Event registration status not confirmed');
    }
  }

  return {
    eventId: state.eventId,
    policyConfirmed: state.policyConfirmed,
    status: state.status,
    availability: state.availability,
    count: state.count,
    capacity: state.capacity,
    canRegister: state.canRegister,
    canCancel: state.canCancel,
    opensAt: state.opensAt,
    closesAt: state.closesAt,
    cancellationClosesAt: state.cancellationClosesAt,
  };
}

export function createCampusEventRegistrationRequestId(): string {
  if (!isFirebaseConfigured()) throw new Error('Event registration session changed');
  const id = doc(collection(getDb(), 'eventRegistrationRequests')).id;
  if (!REQUEST_ID.test(id)) throw new Error('Event registration status not confirmed');
  return id;
}

export function campusEventRegistrationCallableSupported(
  source: CampusEventSource,
): source is 'school-club-events' {
  return source === 'school-club-events';
}

function uniqueEventIds(eventIds: string[]): string[] {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error('Event registration status not confirmed');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const eventId of eventIds) {
    assertEventId(eventId);
    if (seen.has(eventId)) throw new Error('Event registration status not confirmed');
    seen.add(eventId);
    ids.push(eventId);
  }
  return ids;
}

export async function loadEventRegistrationStates(
  scope: EventRegistrationScope,
  eventIds: string[],
  current: () => boolean,
): Promise<EventRegistrationState[]> {
  const ids = uniqueEventIds(eventIds);
  const states: EventRegistrationState[] = [];
  for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
    assertEventRegistrationCurrent(scope, current);
    const batch = ids.slice(offset, offset + MAX_BATCH);
    const callable = httpsCallable<
      { schoolId: string; eventIds: string[] },
      { ok: boolean; states: unknown[] }
    >(getFunctionsInstance(), 'getEventRegistrations');
    const result = await callable({ schoolId: scope.schoolId, eventIds: batch });
    assertEventRegistrationCurrent(scope, current);
    if (
      result.data?.ok !== true ||
      !Array.isArray(result.data.states) ||
      result.data.states.length !== batch.length
    ) {
      throw new Error('Event registration status not confirmed');
    }
    const next = result.data.states.map(validateEventRegistrationState);
    if (next.some((state, index) => state.eventId !== batch[index])) {
      throw new Error('Event registration scope mismatch');
    }
    states.push(...next);
  }
  return states;
}

export async function changeEventRegistration(
  scope: EventRegistrationScope,
  input: { eventId: string; requestId: string; action: 'register' | 'cancel' },
  current: () => boolean,
): Promise<EventRegistrationMutationResult> {
  assertEventRegistrationCurrent(scope, current);
  assertEventId(input.eventId);
  if (
    typeof input.requestId !== 'string' ||
    !REQUEST_ID.test(input.requestId) ||
    (input.action !== 'register' && input.action !== 'cancel')
  ) {
    throw new Error('Event registration status not confirmed');
  }

  const name =
    input.action === 'register' ? 'registerCampusEvent' : 'cancelCampusEventRegistration';
  const callable = httpsCallable<
    { schoolId: string; eventId: string; requestId: string },
    { ok: boolean; reused?: boolean; state: unknown }
  >(getFunctionsInstance(), name);
  const result = await callable({
    schoolId: scope.schoolId,
    eventId: input.eventId,
    requestId: input.requestId,
  });
  assertEventRegistrationCurrent(scope, current);
  if (result.data?.ok !== true) throw new Error('Event registration not confirmed');
  const state = validateEventRegistrationState(result.data.state);
  if (state.eventId !== input.eventId) throw new Error('Event registration scope mismatch');
  return mintMutationReceipt(
    {
      state,
      reused: result.data.reused === true,
    },
    {
      uid: scope.uid,
      schoolId: scope.schoolId,
      eventId: input.eventId,
      action: input.action,
      requestId: input.requestId,
    },
  );
}

export function eventRegistrationLabel(state?: EventRegistrationState): string {
  if (!state) return '報名狀態待確認';
  if (state.status === 'registered') return '已報名';
  if (state.status === 'cancelled') return '已取消報名';
  return {
    unavailable: '未開放線上報名',
    not_open: '尚未開始報名',
    closed: '報名已截止',
    full: '報名已額滿',
    open: '開放報名',
  }[state.availability];
}
