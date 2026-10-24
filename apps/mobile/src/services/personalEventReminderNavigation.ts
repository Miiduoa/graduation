import {
  isSchoolNavigationReady,
  rootNavigateNested,
  rootNavigationRef,
  subscribeSchoolNavigationReady,
} from '../app/rootNavigation';
import {
  isPublicNavigationReady,
  publicNavigatePersonalCalendar,
  subscribePublicNavigationReady,
} from '../app/publicNavigation';
import { isPersonalEventReminderPayload } from './personalEventReminderModel';
import { resolvePersonalEventReminderTap } from './personalEventReminders';
import type { PersonalImportScope } from './personalImports';

type PendingTap = {
  responseKey: string;
  /** Exact QUEUED response identity for safe last-response clear. */
  response: {
    notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
    actionIdentifier?: string;
  };
  payload: unknown;
  queuedAt: number;
};

let pendingTap: PendingTap | null = null;
let lastHandledResponseKey: string | null = null;
let scopeProvider: () => PersonalImportScope | null = () => null;
const readyListeners = new Set<() => void>();

export function setPersonalEventReminderScopeProvider(
  provider: () => PersonalImportScope | null,
) {
  scopeProvider = provider;
  notifyReminderNavigationReady();
}

function responseKey(response: {
  notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
  actionIdentifier?: string;
}): string {
  const identifier = response.notification?.request?.identifier ?? 'unknown';
  const action = response.actionIdentifier ?? 'default';
  const data = response.notification?.request?.content?.data;
  return `${identifier}:${action}:${JSON.stringify(data ?? {})}`;
}

function navigateToFocusedEvent(eventId: string): boolean {
  if (rootNavigationRef.isReady() && isSchoolNavigationReady()) {
    return rootNavigateNested('學習', 'PersonalCalendar', { eventId });
  }
  if (isPublicNavigationReady()) {
    return publicNavigatePersonalCalendar({ eventId });
  }
  // School container may be ready via ref before our mark helper in older call sites.
  if (rootNavigationRef.isReady()) {
    return rootNavigateNested('學習', 'PersonalCalendar', { eventId });
  }
  return false;
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

/**
 * Revalidate immediately before navigation. Never auto-switch account/school.
 * Idempotent tap replay must not repeatedly navigate.
 * Mark handled only after successful actual navigation.
 */
export async function handlePersonalEventReminderResponse(
  response: {
    notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
    actionIdentifier?: string;
  },
  options?: {
    clearLastResponse?: (expected: {
      notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
      actionIdentifier?: string;
    }) => Promise<void>;
  },
): Promise<boolean> {
  const payload = response.notification?.request?.content?.data;
  if (!isPersonalEventReminderPayload(payload)) return false;

  const key = responseKey(response);
  if (lastHandledResponseKey === key) {
    if (options?.clearLastResponse) await options.clearLastResponse(response).catch(() => undefined);
    return true;
  }

  const scope = scopeProvider();
  if (!navigatorsReady() || !scope) {
    pendingTap = { responseKey: key, response, payload, queuedAt: Date.now() };
    return false;
  }

  const resolved = await resolvePersonalEventReminderTap(payload, scopeProvider());
  // Re-read scope after async work — never navigate a foreign event into a new identity.
  const scopeNow = scopeProvider();
  if (!scopeNow || scopeNow.owner !== scope.owner || scopeNow.schoolId !== scope.schoolId) {
    pendingTap = null;
    return false;
  }
  if (!resolved.ok) {
    // Denied/invalid taps: clear the exact response, do not navigate, do not mark as handled
    // for a successful navigation path — but consume so cold-start does not loop.
    lastHandledResponseKey = key;
    pendingTap = null;
    if (options?.clearLastResponse) await options.clearLastResponse(response).catch(() => undefined);
    return false;
  }

  if (!navigatorsReady()) {
    pendingTap = { responseKey: key, response, payload, queuedAt: Date.now() };
    return false;
  }

  const navigated = navigateToFocusedEvent(resolved.eventId);
  if (!navigated) {
    pendingTap = { responseKey: key, response, payload, queuedAt: Date.now() };
    return false;
  }

  lastHandledResponseKey = key;
  pendingTap = null;
  if (options?.clearLastResponse) await options.clearLastResponse(response).catch(() => undefined);
  return true;
}

/** Flush a queued cold-start tap once canonical scope + the active navigator are ready. */
export async function flushPendingPersonalEventReminderTap(
  options?: {
    clearLastResponse?: (expected: {
      notification?: { request?: { identifier?: string; content?: { data?: unknown } } };
      actionIdentifier?: string;
    }) => Promise<void>;
  },
): Promise<boolean> {
  if (!pendingTap) return false;
  if (!navigatorsReady()) return false;
  const scope = scopeProvider();
  if (!scope) return false;
  const queued = pendingTap;
  const resolved = await resolvePersonalEventReminderTap(queued.payload, scopeProvider());
  const scopeNow = scopeProvider();
  if (!scopeNow || scopeNow.owner !== scope.owner || scopeNow.schoolId !== scope.schoolId) {
    pendingTap = null;
    return false;
  }
  if (!resolved.ok) {
    lastHandledResponseKey = queued.responseKey;
    pendingTap = null;
    if (options?.clearLastResponse) {
      await options.clearLastResponse(queued.response).catch(() => undefined);
    }
    return false;
  }
  if (lastHandledResponseKey === queued.responseKey) {
    pendingTap = null;
    return true;
  }
  const navigated = navigateToFocusedEvent(resolved.eventId);
  if (!navigated) return false;
  lastHandledResponseKey = queued.responseKey;
  pendingTap = null;
  if (options?.clearLastResponse) {
    await options.clearLastResponse(queued.response).catch(() => undefined);
  }
  return true;
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
