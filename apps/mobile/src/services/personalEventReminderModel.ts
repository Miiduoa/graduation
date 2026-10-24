import type { PersonalImportRecord } from '@campus/shared';
import type { PersonalImportScope } from './personalImports';

/** Unique local feature type; remote push must never claim this. */
export const PERSONAL_EVENT_REMINDER_TYPE = 'personal_event_reminder_v1';
export const PERSONAL_EVENT_REMINDER_PAYLOAD_VERSION = 1;
export const PERSONAL_EVENT_REMINDER_JOURNAL_VERSION = 1;
export const PERSONAL_EVENT_REMINDER_CHANNEL_ID = 'personal-event-reminders';
/** Enumerable OS identifier namespace — restart can cancel orphans even if receipt write failed. */
export const PERSONAL_EVENT_REMINDER_OS_PREFIX = 'per-evtrem.';
/**
 * Conservative product budget for ALL pending OS notifications on the device
 * (this feature + other features). Not a documented platform maximum.
 */
export const PERSONAL_EVENT_REMINDER_DEVICE_BUDGET = 32;
export const PERSONAL_EVENT_REMINDER_TITLE = '個人行程提醒';
export const PERSONAL_EVENT_REMINDER_BODY =
  '你有一項個人行程即將開始，開啟查看。';

export const TIMED_LEAD_OPTIONS = [0, 10, 30, 60] as const;
export type TimedLeadMinutes = (typeof TIMED_LEAD_OPTIONS)[number];

/** Explicit all-day reminder clock in Asia/Taipei — never silent midnight. */
export const ALL_DAY_REMINDER_HOUR = 9;
export const ALL_DAY_REMINDER_MINUTE = 0;

export type PersonalEventReminderPreference =
  | { enabled: false }
  | { enabled: true; mode: 'timed'; leadMinutes: TimedLeadMinutes }
  | {
      enabled: true;
      mode: 'allDay';
      hour: typeof ALL_DAY_REMINDER_HOUR;
      minute: typeof ALL_DAY_REMINDER_MINUTE;
    };

export type PersonalEventReminderStatus =
  | 'off'
  | 'pending'
  | 'scheduled'
  | 'error'
  | 'permission_needed'
  | 'elapsed'
  | 'unsupported'
  | 'corrupt_blocked'
  /** Preference retained; not scheduled because the shared device budget is full. */
  | 'limit_deferred';

export type PersonalEventReminderEntry = {
  eventId: string;
  /** Ledger revision fingerprint; tap/OS work is revoked when this no longer matches. */
  revision: string;
  preference: PersonalEventReminderPreference;
  lookupToken: string;
  osIdentifier: string;
  intentGeneration: number;
  status: PersonalEventReminderStatus;
  lastError?: string;
  updatedAt: string;
  /** Absolute trigger ms when last successfully scheduled (for display/debug only). */
  scheduledTriggerAt?: number;
};

export type PersonalEventReminderPendingCancel = {
  osIdentifier: string;
  lookupToken: string;
  intentGeneration: number;
  scopeOwner: string;
  scopeSchoolId: string;
};

export type PersonalEventReminderJournal = {
  version: typeof PERSONAL_EVENT_REMINDER_JOURNAL_VERSION;
  scope: PersonalImportScope;
  entries: Record<string, PersonalEventReminderEntry>;
  pendingCancels: PersonalEventReminderPendingCancel[];
};

export type PersonalEventReminderPayload = {
  type: typeof PERSONAL_EVENT_REMINDER_TYPE;
  v: typeof PERSONAL_EVENT_REMINDER_PAYLOAD_VERSION;
  /** Opaque local lookup; never event title/location/owner. */
  t: string;
  /** Intent generation at schedule time. */
  g: number;
};

export type PersonalEventReminderOsRegistry = {
  version: 1;
  identifiers: string[];
};

export function personalEventReminderJournalKey(scope: PersonalImportScope): string {
  return `campus.personal-event-reminders.journal.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
}

export function personalEventReminderCorruptKey(scope: PersonalImportScope): string {
  return `${personalEventReminderJournalKey(scope)}:corrupt`;
}

export const PERSONAL_EVENT_REMINDER_REGISTRY_KEY =
  'campus.personal-event-reminders.os-registry.v1';

export const PERSONAL_EVENT_REMINDER_REGISTRY_CORRUPT_KEY =
  'campus.personal-event-reminders.os-registry.v1:corrupt';

/** Cross-scope durable cancel intents that must settle before new identity schedules. */
export const PERSONAL_EVENT_REMINDER_CLEANUP_KEY =
  'campus.personal-event-reminders.cleanup.v1';

export type PersonalEventReminderCleanupStore = {
  version: 1;
  pending: PersonalEventReminderPendingCancel[];
};

export function isPersonalEventReminderOsId(identifier: string): boolean {
  return identifier.startsWith(PERSONAL_EVENT_REMINDER_OS_PREFIX);
}

export function isPersonalEventReminderPayload(data: unknown): data is PersonalEventReminderPayload {
  if (!data || typeof data !== 'object') return false;
  const row = data as Record<string, unknown>;
  return (
    row.type === PERSONAL_EVENT_REMINDER_TYPE &&
    row.v === PERSONAL_EVENT_REMINDER_PAYLOAD_VERSION &&
    typeof row.t === 'string' &&
    row.t.length > 0 &&
    typeof row.g === 'number' &&
    Number.isFinite(row.g)
  );
}

export function buildPersonalEventReminderPayload(
  entry: Pick<PersonalEventReminderEntry, 'lookupToken' | 'intentGeneration'>,
): PersonalEventReminderPayload {
  return {
    type: PERSONAL_EVENT_REMINDER_TYPE,
    v: PERSONAL_EVENT_REMINDER_PAYLOAD_VERSION,
    t: entry.lookupToken,
    g: entry.intentGeneration,
  };
}

/** Stable fingerprint of the event timing revision — id/importedAt alone is insufficient. */
export function personalEventReminderRevision(row: PersonalImportRecord): string {
  return [
    row.id,
    row.batchId,
    row.kind,
    row.schoolId,
    row.date || '',
    row.endDate || '',
    row.allDay ? '1' : '0',
    row.startTime || '',
    row.endTime || '',
  ].join('\u001f');
}

export function defaultOffPreference(): PersonalEventReminderPreference {
  return { enabled: false };
}

export function timedPreference(leadMinutes: TimedLeadMinutes): PersonalEventReminderPreference {
  return { enabled: true, mode: 'timed', leadMinutes };
}

export function allDayPreference(): PersonalEventReminderPreference {
  return {
    enabled: true,
    mode: 'allDay',
    hour: ALL_DAY_REMINDER_HOUR,
    minute: ALL_DAY_REMINDER_MINUTE,
  };
}

export function emptyReminderJournal(scope: PersonalImportScope): PersonalEventReminderJournal {
  return {
    version: PERSONAL_EVENT_REMINDER_JOURNAL_VERSION,
    scope: { owner: scope.owner, schoolId: scope.schoolId },
    entries: {},
    pendingCancels: [],
  };
}

/**
 * Interpret personal-event date/time as an absolute Asia/Taipei instant.
 * Taiwan does not observe DST; +08:00 is stable and independent of phone timezone.
 * Rejects calendar-impossible dates (e.g. 2027-02-31) — never JS Date rollover.
 */
export function asiaTaipeiInstant(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null;
  }
  const instant = new Date(`${date}T${time}:00+08:00`);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/**
 * Desired trigger instant from ledger + preference.
 * All-day uses the event start date at the explicit Taiwan clock — never exclusive DTEND.
 */
export function computePersonalEventReminderTrigger(
  row: PersonalImportRecord,
  preference: PersonalEventReminderPreference,
  now: Date = new Date(),
): { ok: true; triggerAt: Date } | { ok: false; reason: 'disabled' | 'invalid' | 'elapsed' } {
  if (!preference.enabled) return { ok: false, reason: 'disabled' };
  if (row.kind !== 'events' || !row.date) return { ok: false, reason: 'invalid' };

  let start: Date | null = null;
  if (preference.mode === 'allDay') {
    if (!row.allDay) return { ok: false, reason: 'invalid' };
    const hh = String(preference.hour).padStart(2, '0');
    const mm = String(preference.minute).padStart(2, '0');
    start = asiaTaipeiInstant(row.date, `${hh}:${mm}`);
  } else {
    if (row.allDay) return { ok: false, reason: 'invalid' };
    if (!row.startTime) return { ok: false, reason: 'invalid' };
    start = asiaTaipeiInstant(row.date, row.startTime);
    if (start) {
      start = new Date(start.getTime() - preference.leadMinutes * 60_000);
    }
  }
  if (!start || !Number.isFinite(start.getTime())) return { ok: false, reason: 'invalid' };
  if (start.getTime() <= now.getTime()) return { ok: false, reason: 'elapsed' };
  return { ok: true, triggerAt: start };
}

export function reminderPreferenceLabel(preference: PersonalEventReminderPreference): string {
  if (!preference.enabled) return '此裝置提醒：關閉';
  if (preference.mode === 'allDay') {
    return `此裝置提醒：當天 ${String(ALL_DAY_REMINDER_HOUR).padStart(2, '0')}:${String(ALL_DAY_REMINDER_MINUTE).padStart(2, '0')}（台灣時間）`;
  }
  if (preference.leadMinutes === 0) return '此裝置提醒：開始時';
  return `此裝置提醒：提前 ${preference.leadMinutes} 分鐘`;
}

export const PERSONAL_EVENT_REMINDER_DEVICE_NOTE =
  '提醒只在這部裝置生效；系統省電或通知設定可能讓提醒延後。';

export const PERSONAL_EVENT_REMINDER_LIMIT_COPY =
  '此裝置可排程的通知數量已滿，提醒設定仍保留。請在開啟 App 或手動重試時再同步；無法保證 App 關閉期間自動補上。';

export function reminderStatusCopy(status: PersonalEventReminderStatus, lastError?: string): string {
  switch (status) {
    case 'off':
      return '提醒已關閉（此裝置）。';
    case 'pending':
      return '提醒設定已儲存，正在與系統通知同步…';
    case 'scheduled':
      return `已在此裝置排程。${PERSONAL_EVENT_REMINDER_DEVICE_NOTE}`;
    case 'permission_needed':
      return '行程已儲存；要在此裝置提醒，請允許通知或到系統設定開啟。';
    case 'elapsed':
      return '提醒時間已過，不會再發送。';
    case 'unsupported':
      return '此環境不支援本機提醒（例如網頁）。設定仍保留在此裝置。';
    case 'corrupt_blocked':
      return '此裝置的提醒設定讀取異常，已保留原資料，請稍後重試。';
    case 'limit_deferred':
      return PERSONAL_EVENT_REMINDER_LIMIT_COPY;
    case 'error':
      return lastError
        ? `行程已儲存，但提醒需要重試：${lastError}`
        : '行程已儲存，但提醒需要重試。';
    default:
      return '';
  }
}

export function createOpaqueToken(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${time}${rand}`;
}

export function osIdentifierForToken(lookupToken: string): string {
  return `${PERSONAL_EVENT_REMINDER_OS_PREFIX}${lookupToken}`;
}
