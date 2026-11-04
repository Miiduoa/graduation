import {
  isSchoolNavigationReady,
  rootNavigateNested,
  rootNavigationRef,
  subscribeSchoolNavigationReady,
} from '../app/rootNavigation';
import {
  isPublicNavigationReady,
  publicNavigatePersonalCalendar,
  publicNavigatePersonalTimetable,
  subscribePublicNavigationReady,
} from '../app/publicNavigation';
import { classDate } from '@campus/shared';
import { isClassReminderPayload, personalReminderCategory } from './personalReminderPayload';
import { resolvePersonalEventReminderTap } from './personalEventReminders';
import type { PersonalImportScope } from './personalImports';

type ReminderResponse = {
  notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
  actionIdentifier?: string;
};

type TapOptions = {
  clearLastResponse?: (expected: ReminderResponse) => Promise<void>;
};

type Destination =
  | { screen: 'PersonalCalendar'; params: { eventId: string } }
  | {
      screen: 'PersonalTimetable';
      params: { schoolId: string; courseId: string; reminderScope: string; date?: string; startAt?: number };
    };

let pendingTap: { response: ReminderResponse; key: string } | null = null;
let lastHandledResponseKey: string | null = null;
let scopeProvider: () => PersonalImportScope | null = () => null;
const readyListeners = new Set<() => void>();

export function setPersonalEventReminderScopeProvider(
  provider: () => PersonalImportScope | null,
) {
  scopeProvider = provider;
  notifyReminderNavigationReady();
}

function responseKey(response: ReminderResponse): string {
  const identifier = response.notification?.request?.identifier ?? 'unknown';
  const action = response.actionIdentifier ?? 'default';
  const data = response.notification?.request?.content?.data;
  return `${identifier}:${action}:${JSON.stringify(data ?? {})}`;
}

async function resolveDestination(payload: unknown, scope: PersonalImportScope): Promise<Destination | null> {
  if (isClassReminderPayload(payload)) {
    if (
      scope.owner === 'guest:device' ||
      payload.scope !== JSON.stringify({ owner: scope.owner, schoolId: scope.schoolId }) ||
      typeof payload.courseId !== 'string' || !payload.courseId.trim()
    ) return null;
    const params = { schoolId: scope.schoolId, courseId: payload.courseId, reminderScope: payload.scope };
    // Older notifications can still focus the course, but carry no occurrence date.
    if (payload.startAt === undefined) return { screen: 'PersonalTimetable', params };
    const { startAt } = payload;
    if (
      typeof startAt !== 'number' || !Number.isInteger(startAt) ||
      startAt < 0 || startAt > Date.parse('9999-12-31T23:59:59.999+08:00')
    ) return null;
    return { screen: 'PersonalTimetable', params: { ...params, date: classDate(new Date(startAt)), startAt } };
  }
  const event = await resolvePersonalEventReminderTap(payload, scope);
  return event.ok ? { screen: 'PersonalCalendar', params: { eventId: event.eventId } } : null;
}

function navigate(destination: Destination): boolean {
  if (isSchoolNavigationReady()) return rootNavigateNested('學習', destination.screen, destination.params);
  if (isPublicNavigationReady()) {
    return destination.screen === 'PersonalCalendar'
      ? publicNavigatePersonalCalendar(destination.params)
      : publicNavigatePersonalTimetable(destination.params);
  }
  return rootNavigationRef.isReady() && rootNavigateNested('學習', destination.screen, destination.params);
}

function navigatorsReady(): boolean {
  return isSchoolNavigationReady() || isPublicNavigationReady() || rootNavigationRef.isReady();
}

function notifyReminderNavigationReady() {
  for (const listener of [...readyListeners]) {
    try {
      listener();
    } catch {
      /* readiness fan-out must not throw */
    }
  }
}

/** Defer until scope and navigation are ready. Repeated OS responses open the destination once. */
export async function handlePersonalEventReminderResponse(
  response: ReminderResponse,
  options?: TapOptions,
): Promise<boolean> {
  if (!personalReminderCategory(response.notification?.request?.content?.data)) return false;
  const key = responseKey(response);
  if (lastHandledResponseKey === key) {
    if (options?.clearLastResponse) await options.clearLastResponse(response).catch(() => undefined);
    return true;
  }
  if (pendingTap?.key !== key) pendingTap = { response, key };
  return flushPendingPersonalEventReminderTap(options);
}

/** Cold-start and live listeners may observe the same tap while identity or navigation initializes. */
export async function flushPendingPersonalEventReminderTap(options?: TapOptions): Promise<boolean> {
  const tap = pendingTap;
  const scope = scopeProvider();
  if (!tap || !scope || !navigatorsReady()) return false;
  const destination = await resolveDestination(tap.response.notification?.request?.content?.data, scope);
  if (pendingTap !== tap) return false;
  const current = scopeProvider();
  if (!current || current.owner !== scope.owner || current.schoolId !== scope.schoolId) {
    pendingTap = null;
    return false;
  }
  if (destination && !navigate(destination)) return false;
  lastHandledResponseKey = tap.key;
  pendingTap = null;
  if (options?.clearLastResponse) await options.clearLastResponse(tap.response).catch(() => undefined);
  return destination !== null;
}

export function subscribePersonalEventReminderNavigationReady(
  onReady: () => void,
): () => void {
  readyListeners.add(onReady);
  const unsubPublic = subscribePublicNavigationReady(() => {
    notifyReminderNavigationReady();
  });
  const unsubSchool = subscribeSchoolNavigationReady(() => {
    notifyReminderNavigationReady();
  });
  if (navigatorsReady() && scopeProvider()) onReady();
  return () => {
    readyListeners.delete(onReady);
    unsubPublic();
    unsubSchool();
  };
}

/** Notify when scope becomes resolvable so queued taps can flush without polling. */
export function notifyPersonalEventReminderScopeResolved() {
  notifyReminderNavigationReady();
}

/** Test helper */
export function __resetPersonalEventReminderNavigationForTests() {
  pendingTap = null;
  lastHandledResponseKey = null;
  scopeProvider = () => null;
}
