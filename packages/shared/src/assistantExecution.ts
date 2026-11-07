import type { PersonalImportRecord } from './imports/types';
import { isPersonalImportDate, isPersonalImportTime } from './imports/validation';

export type AssistantCalendarEvent = {
  title: string;
  date: string;
  allDay: boolean;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
};

export type AssistantExecutionStorage = 'synced' | 'device';
type ExecutionScope = {
  version: 1;
  operation: 'calendar.create';
  schoolId: string;
  mutationId: string;
  storage: AssistantExecutionStorage;
};

export type AssistantCalendarReceipt = ExecutionScope & {
  status: 'verified';
  verifiedAt: string;
  /** Required for synced receipts; device ledgers need not have a remote revision. */
  revision?: number;
  replay: boolean;
  record: PersonalImportRecord & { kind: 'events' };
};

type CalendarCheckScope = ExecutionScope & {
  checkedAt: string;
  revision?: number;
};

export type AssistantCalendarCheck = CalendarCheckScope & {
  status: 'absent' | 'conflict';
  /** This describes the original confirmation token, never a new authorization. */
  authorizationValid: boolean;
  /** Only a retry of the same token, arguments and mutation ID can be offered. */
  retryable: boolean;
};

export type AssistantCalendarRevocation = CalendarCheckScope & {
  status: 'revoked';
  authorizationValid: false;
  retryable: false;
  alreadyRevoked: boolean;
};

export type AssistantCalendarExecutionResult =
  | AssistantCalendarReceipt
  | AssistantCalendarCheck
  | AssistantCalendarRevocation;

export type AssistantCalendarExpected = {
  schoolId: string;
  mutationId: string;
  /** Original reviewed event arguments; request text never selects a storage owner. */
  event: unknown;
  storage?: AssistantExecutionStorage;
};

const EVENT_FIELDS = ['title', 'date', 'allDay', 'endDate', 'startTime', 'endTime', 'location'] as const;
const OPTIONAL_EVENT_FIELDS = ['endDate', 'startTime', 'endTime', 'location'] as const;
const SCOPE_FIELDS = ['version', 'operation', 'schoolId', 'mutationId', 'storage'] as const;
const RECEIPT_FIELDS = [...SCOPE_FIELDS, 'status', 'verifiedAt', 'revision', 'replay', 'record'];
const CHECK_FIELDS = [...SCOPE_FIELDS, 'status', 'checkedAt', 'revision', 'authorizationValid', 'retryable'];
const RECORD_FIELDS = [
  ...EVENT_FIELDS, 'id', 'kind', 'schoolId', 'academicYear', 'semester',
  'batchId', 'importedAt', 'source',
];

function invalid(): never {
  throw new Error('行程執行結果無法核對，請重新查核；目前不會再次建立行程。');
}

/** JSON data only: do not execute getters while validating a receipt. */
function object(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const value: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    value[key] = descriptor.value;
  }
  return value;
}

function cleanText(raw: unknown, max: number, allowEmpty = false): string {
  if (typeof raw !== 'string' || raw.length > max || raw !== raw.trim() ||
      (!allowEmpty && !raw) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw)) return invalid();
  return raw;
}

function school(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw)) return invalid();
  return raw;
}

function mutation(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(raw)) return invalid();
  return raw;
}

function instant(raw: unknown): string {
  if (typeof raw !== 'string') return invalid();
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(raw);
  if (!match || !isPersonalImportDate(match[1]) || !Number.isFinite(Date.parse(raw))) return invalid();
  return raw;
}

function storage(raw: unknown): AssistantExecutionStorage {
  if (raw !== 'synced' && raw !== 'device') return invalid();
  return raw;
}

function revision(raw: unknown, required: boolean, minimum: number): number | undefined {
  if (raw === undefined && !required) return undefined;
  if (!Number.isSafeInteger(raw) || (raw as number) < minimum) return invalid();
  return raw as number;
}

export function parseAssistantCalendarEvent(raw: unknown): AssistantCalendarEvent {
  const value = object(raw, EVENT_FIELDS);
  const title = cleanText(value.title, 200);
  const date = cleanText(value.date, 10);
  if (!isPersonalImportDate(date) || typeof value.allDay !== 'boolean') return invalid();
  const event: AssistantCalendarEvent = { title, date, allDay: value.allDay };
  for (const key of OPTIONAL_EVENT_FIELDS) {
    if (value[key] !== undefined) event[key] = cleanText(value[key], key === 'location' ? 300 : 10, key === 'location');
  }
  if (event.endDate && (!isPersonalImportDate(event.endDate) || event.endDate < event.date)) return invalid();
  if (event.allDay) {
    if (event.startTime !== undefined || event.endTime !== undefined ||
        (event.endDate !== undefined && event.endDate <= event.date)) return invalid();
  } else if (!event.startTime || !event.endTime || !isPersonalImportTime(event.startTime) ||
      !isPersonalImportTime(event.endTime) ||
      `${event.endDate || event.date}T${event.endTime}` <= `${event.date}T${event.startTime}`) return invalid();
  return event;
}

function expectation(raw: AssistantCalendarExpected) {
  const value = object(raw, ['schoolId', 'mutationId', 'event', 'storage']);
  return {
    schoolId: school(value.schoolId),
    mutationId: mutation(value.mutationId),
    event: parseAssistantCalendarEvent(value.event),
    ...(value.storage !== undefined ? { storage: storage(value.storage) } : {}),
  };
}

function executionScope(value: Record<string, unknown>, expected: ReturnType<typeof expectation>): ExecutionScope {
  if (value.version !== 1 || value.operation !== 'calendar.create' ||
      value.schoolId !== expected.schoolId || value.mutationId !== expected.mutationId) return invalid();
  const place = storage(value.storage);
  if (expected.storage && place !== expected.storage) return invalid();
  return { version: 1, operation: 'calendar.create', schoolId: expected.schoolId,
    mutationId: expected.mutationId, storage: place };
}

function calendarRecord(raw: unknown, expected: ReturnType<typeof expectation>): AssistantCalendarReceipt['record'] {
  const value = object(raw, RECORD_FIELDS);
  if (value.id !== expected.mutationId || value.batchId !== expected.mutationId ||
      value.schoolId !== expected.schoolId || value.kind !== 'events' ||
      value.academicYear !== '' || value.semester !== '') return invalid();
  const fields: Record<string, unknown> = {};
  for (const key of EVENT_FIELDS) if (value[key] !== undefined) fields[key] = value[key];
  const event = parseAssistantCalendarEvent(fields);
  for (const key of EVENT_FIELDS) if (event[key] !== expected.event[key]) return invalid();
  const source = object(value.source, ['type', 'name', 'line', 'rawText']);
  if (source.type !== 'paste' || source.line !== 1 || source.rawText !== '') return invalid();
  return {
    ...event, id: expected.mutationId, kind: 'events', schoolId: expected.schoolId,
    academicYear: '', semester: '', batchId: expected.mutationId, importedAt: instant(value.importedAt),
    source: { type: 'paste', line: 1, rawText: '',
      ...(source.name !== undefined ? { name: cleanText(source.name, 80) } : {}) },
  };
}

export function parseAssistantCalendarReceipt(raw: unknown, expected: AssistantCalendarExpected): AssistantCalendarReceipt {
  const target = expectation(expected);
  const value = object(raw, RECEIPT_FIELDS);
  const scope = executionScope(value, target);
  if (value.status !== 'verified' || typeof value.replay !== 'boolean') return invalid();
  const rev = revision(value.revision, scope.storage === 'synced', scope.storage === 'synced' ? 1 : 0);
  return {
    ...scope, status: 'verified', verifiedAt: instant(value.verifiedAt), replay: value.replay,
    ...(rev !== undefined ? { revision: rev } : {}), record: calendarRecord(value.record, target),
  };
}

export function parseAssistantCalendarExecutionResult(raw: unknown, expected: AssistantCalendarExpected): AssistantCalendarExecutionResult {
  // Validate data descriptors before examining even the discriminator.
  const value = object(raw, [...RECEIPT_FIELDS, ...CHECK_FIELDS, 'alreadyRevoked']);
  if (value.status === 'verified') return parseAssistantCalendarReceipt(value, expected);
  const target = expectation(expected);
  const checked = object(value, value.status === 'revoked' ? [...CHECK_FIELDS, 'alreadyRevoked'] : CHECK_FIELDS);
  const scope = executionScope(checked, target);
  const checkedAt = instant(checked.checkedAt);
  const rev = revision(checked.revision, scope.storage === 'synced', 0);
  const base = { ...scope, checkedAt, ...(rev !== undefined ? { revision: rev } : {}) };
  if (checked.status === 'revoked') {
    if (checked.authorizationValid !== false || checked.retryable !== false ||
        typeof checked.alreadyRevoked !== 'boolean') return invalid();
    return { ...base, status: 'revoked', authorizationValid: false, retryable: false,
      alreadyRevoked: checked.alreadyRevoked };
  }
  if ((checked.status !== 'absent' && checked.status !== 'conflict') ||
      typeof checked.authorizationValid !== 'boolean' || typeof checked.retryable !== 'boolean' ||
      (checked.retryable && (!checked.authorizationValid || checked.status !== 'absent'))) return invalid();
  return { ...base, status: checked.status, authorizationValid: checked.authorizationValid, retryable: checked.retryable };
}

/** Call only after reading the stored row; validation alone does not perform a write or read. */
export function createAssistantCalendarReceipt(input: AssistantCalendarExpected & {
  storage: AssistantExecutionStorage;
  record: unknown;
  verifiedAt: string;
  revision?: number;
  replay?: boolean;
}): AssistantCalendarReceipt {
  return parseAssistantCalendarReceipt({
    version: 1, operation: 'calendar.create', status: 'verified', schoolId: input.schoolId,
    mutationId: input.mutationId, storage: input.storage, verifiedAt: input.verifiedAt,
    replay: input.replay === undefined ? false : input.replay,
    ...(input.revision !== undefined ? { revision: input.revision } : {}), record: input.record,
  }, { schoolId: input.schoolId, mutationId: input.mutationId, event: input.event, storage: input.storage });
}
