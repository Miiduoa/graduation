import { httpsCallable } from 'firebase/functions';
import { collection, doc } from 'firebase/firestore';
import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
export type EventRegistrationState = {
  eventId: string;
  policyConfirmed: boolean;
  status: 'registered' | 'cancelled' | 'not_registered';
  availability: 'unavailable' | 'not_open' | 'closed' | 'full' | 'open';
  count: number | null;
  capacity: number | null;
  canRegister: boolean;
  canCancel: boolean;
  opensAt: string | null;
  closesAt: string | null;
  cancellationClosesAt: string | null;
};
export type EventRegistrationScope = { uid: string; schoolId: string };
const listeners = new Set<(scope: EventRegistrationScope) => void>();
export function subscribeEventRegistrations(listener: (scope: EventRegistrationScope) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function assertCurrent(scope: EventRegistrationScope, current: () => boolean) {
  if (
    !scope.uid ||
    !scope.schoolId ||
    !current() ||
    isFirebaseMockMode() ||
    getAuthInstance().currentUser?.uid !== scope.uid
  )
    throw new Error('Event registration session changed');
}
function validated(value: unknown): EventRegistrationState {
  const state = value as EventRegistrationState;
  if (
    !state ||
    typeof state.eventId !== 'string' ||
    !['registered', 'cancelled', 'not_registered'].includes(state.status) ||
    !['unavailable', 'not_open', 'closed', 'full', 'open'].includes(state.availability) ||
    typeof state.policyConfirmed !== 'boolean' ||
    typeof state.canRegister !== 'boolean' ||
    typeof state.canCancel !== 'boolean' ||
    !(state.count === null || (Number.isSafeInteger(state.count) && state.count >= 0)) ||
    !(state.capacity === null || (Number.isSafeInteger(state.capacity) && state.capacity > 0)) ||
    [state.opensAt, state.closesAt, state.cancellationClosesAt].some(
      (date) => date !== null && (typeof date !== 'string' || !Number.isFinite(Date.parse(date))),
    )
  )
    throw new Error('Event registration status not confirmed');
  return state;
}
export function createEventRegistrationRequestId() {
  return doc(collection(getDb(), 'eventRegistrationRequests')).id;
}
export async function loadEventRegistrationStates(
  scope: EventRegistrationScope,
  eventIds: string[],
  current: () => boolean,
): Promise<EventRegistrationState[]> {
  const states: EventRegistrationState[] = [];
  for (let offset = 0; offset < eventIds.length; offset += 40) {
    assertCurrent(scope, current);
    const ids = eventIds.slice(offset, offset + 40);
    const callable = httpsCallable<unknown, { ok: boolean; states: unknown[] }>(
      getFunctionsInstance(),
      'getEventRegistrations',
    );
    const result = await callable({ schoolId: scope.schoolId, eventIds: ids });
    assertCurrent(scope, current);
    if (
      result.data?.ok !== true ||
      !Array.isArray(result.data.states) ||
      result.data.states.length !== ids.length
    )
      throw new Error('Event registration status not confirmed');
    const next = result.data.states.map(validated);
    if (next.some((state, i) => state.eventId !== ids[i]))
      throw new Error('Event registration scope mismatch');
    states.push(...next);
  }
  return states;
}
export async function changeEventRegistration(
  scope: EventRegistrationScope,
  input: { eventId: string; requestId: string; action: 'register' | 'cancel' },
  current: () => boolean,
): Promise<EventRegistrationState> {
  assertCurrent(scope, current);
  const callable = httpsCallable<unknown, { ok: boolean; state: unknown }>(
    getFunctionsInstance(),
    input.action === 'register' ? 'registerCampusEvent' : 'cancelCampusEventRegistration',
  );
  const result = await callable({
    schoolId: scope.schoolId,
    eventId: input.eventId,
    requestId: input.requestId,
  });
  assertCurrent(scope, current);
  if (result.data?.ok !== true) throw new Error('Event registration not confirmed');
  const state = validated(result.data.state);
  if (state.eventId !== input.eventId) throw new Error('Event registration scope mismatch');
  listeners.forEach((listener) => listener(scope));
  return state;
}
export function eventRegistrationLabel(state?: EventRegistrationState) {
  if (!state) return '報名狀態待確認';
  if (state.status === 'registered') return '已報名';
  if (state.status === 'cancelled') return '已取消報名';
  return {
    unavailable: '未開放 App 報名',
    not_open: '尚未開始報名',
    closed: '報名已截止',
    full: '報名已額滿',
    open: '開放報名',
  }[state.availability];
}
