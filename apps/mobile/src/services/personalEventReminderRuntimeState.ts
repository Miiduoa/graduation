import type { PersonalImportScope } from './personalImports';

/**
 * Scope-fenced, in-memory reminder I/O failure surface for Calendar UI.
 * Does not write AsyncStorage — publishing here must never feed reconcile.
 */
export type PersonalEventReminderRuntimeFailure = {
  owner: string;
  schoolId: string;
  message: string;
  updatedAt: number;
};

type Listener = (failure: PersonalEventReminderRuntimeFailure | null) => void;

let published: PersonalEventReminderRuntimeFailure | null = null;
const listeners = new Set<Listener>();

export const PERSONAL_EVENT_REMINDER_STORAGE_FAILURE_MESSAGE =
  '此裝置的提醒設定暫時無法讀取或寫入，行程本身不受影響。請稍後重試。';

export function personalEventReminderScopeFenceKey(
  scope: PersonalImportScope | null | undefined,
): string {
  if (!scope) return '';
  return `${scope.owner}\u0000${scope.schoolId}`;
}

function sameFailureScope(
  failure: PersonalEventReminderRuntimeFailure | null,
  scope: PersonalImportScope | null | undefined,
): boolean {
  if (!failure || !scope) return false;
  return failure.owner === scope.owner && failure.schoolId === scope.schoolId;
}

function emit() {
  for (const listener of listeners) {
    try {
      listener(published);
    } catch {
      /* A view cannot invalidate service state. */
    }
  }
}

/** Synchronously drop any published failure (e.g. account/school switch). */
export function clearPersonalEventReminderRuntimeFailure(
  scope?: PersonalImportScope | null,
): void {
  if (!published) return;
  if (scope && !sameFailureScope(published, scope)) {
    // Clearing a different scope must not leave a stale foreign failure visible.
    published = null;
    emit();
    return;
  }
  if (!scope || sameFailureScope(published, scope)) {
    published = null;
    emit();
  }
}

/**
 * Invalidate any prior publication immediately when the active fence changes.
 * Delayed failures from an old scope must not appear under a new identity.
 */
export function fencePersonalEventReminderRuntimeFailure(
  scope: PersonalImportScope | null,
): void {
  if (!published) return;
  if (!scope || !sameFailureScope(published, scope)) {
    published = null;
    emit();
  }
}

export function publishPersonalEventReminderRuntimeFailure(
  scope: PersonalImportScope | null,
  message?: string,
): void {
  if (!scope) {
    published = null;
    emit();
    return;
  }
  published = {
    owner: scope.owner,
    schoolId: scope.schoolId,
    message: message || PERSONAL_EVENT_REMINDER_STORAGE_FAILURE_MESSAGE,
    updatedAt: Date.now(),
  };
  emit();
}

export function getPersonalEventReminderRuntimeFailure(
  scope: PersonalImportScope | null,
): PersonalEventReminderRuntimeFailure | null {
  if (!scope || !sameFailureScope(published, scope)) return null;
  return published;
}

export function subscribePersonalEventReminderRuntimeFailure(listener: Listener): () => void {
  listeners.add(listener);
  listener(published);
  return () => {
    listeners.delete(listener);
  };
}

export function userFacingReminderFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message && !/native|AsyncStorage|expo|per-evtrem|journal|registry|cleanup|owner|firebase|nuni/i.test(error.message)) {
    // Prefer existing natural Chinese service messages; strip implementation jargon.
    if (/[\u4e00-\u9fff]/.test(error.message)) return error.message;
  }
  return PERSONAL_EVENT_REMINDER_STORAGE_FAILURE_MESSAGE;
}

/** Test helper. */
export function __resetPersonalEventReminderRuntimeStateForTests() {
  published = null;
}
