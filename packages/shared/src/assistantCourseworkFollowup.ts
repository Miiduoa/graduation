import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from './assistantExecution';
import { isPersonalImportDate } from './imports/validation';

export type AssistantCourseworkFollowupStatus =
  | 'scheduled' | 'in_progress' | 'elapsed' | 'source_changed' | 'submitted' | 'closed'
  | 'conflict' | 'event_changed' | 'event_missing' | 'unavailable' | 'not_coursework';

/** A fresh read of an earlier proposal. This response never grants write authority. */
export type AssistantCourseworkFollowup = {
  version: 1;
  operation: 'coursework.followup';
  schoolId: string;
  mutationId: string;
  checkedAt: string;
  status: AssistantCourseworkFollowupStatus;
  task: { workspaceId: string; taskId: string; kind: 'assignment' | 'quiz' } | null;
  source: {
    title: string;
    courseName: string;
    dueAt: string | null;
    state: 'open' | 'closed';
    submitted: boolean;
  } | null;
  calendar: 'matching' | 'changed' | 'missing' | 'unavailable';
  /** The original reviewed event, never an automatic replacement or moved event. */
  event: AssistantCalendarEvent;
};

const FIELDS = ['version', 'operation', 'schoolId', 'mutationId', 'checkedAt', 'status', 'task', 'source', 'calendar', 'event'];
const STATUSES: AssistantCourseworkFollowupStatus[] = [
  'scheduled', 'in_progress', 'elapsed', 'source_changed', 'submitted', 'closed',
  'conflict', 'event_changed', 'event_missing', 'unavailable', 'not_coursework',
];
function invalid(): never {
  throw new Error('這次安排的追蹤結果無法核對，原有紀錄仍保留，請重新查核。');
}
function object(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const output: Record<string, unknown> = {};
  if (Reflect.ownKeys(descriptors).length !== fields.length) return invalid();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return invalid();
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid();
    output[key] = descriptor.value;
  }
  return output;
}
function text(raw: unknown, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.length > max ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in source text while retaining tabs and line breaks.
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return invalid();
  return raw;
}
function id(raw: unknown): string {
  const result = text(raw, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) return invalid();
  return result;
}
function dueAt(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw) ||
      !isPersonalImportDate(raw.slice(0, 10)) || !Number.isFinite(Date.parse(raw))) return invalid();
  return raw;
}

export function parseAssistantCourseworkFollowup(raw: unknown, expected: {
  schoolId: string;
  mutationId: string;
  event: unknown;
}): AssistantCourseworkFollowup {
  const target = object(expected, ['schoolId', 'mutationId', 'event']);
  if (typeof target.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(target.schoolId) ||
      target.schoolId === 'personal' || typeof target.mutationId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(target.mutationId)) return invalid();
  const original = parseAssistantCalendarEvent(target.event);
  const value = object(raw, FIELDS);
  if (value.version !== 1 || value.operation !== 'coursework.followup' ||
      value.schoolId !== target.schoolId || value.mutationId !== target.mutationId ||
      typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) ||
      new Date(value.checkedAt).toISOString() !== value.checkedAt ||
      !STATUSES.includes(value.status as AssistantCourseworkFollowupStatus) ||
      !['matching', 'changed', 'missing', 'unavailable'].includes(String(value.calendar))) return invalid();
  const event = parseAssistantCalendarEvent(value.event);
  for (const key of ['title', 'date', 'allDay', 'endDate', 'startTime', 'endTime', 'location'] as const)
    if (event[key] !== original[key]) return invalid();
  let task: AssistantCourseworkFollowup['task'] = null;
  if (value.task !== null) {
    const item = object(value.task, ['workspaceId', 'taskId', 'kind']);
    if (item.kind !== 'assignment' && item.kind !== 'quiz') return invalid();
    task = { workspaceId: id(item.workspaceId), taskId: id(item.taskId), kind: item.kind };
  }
  let source: AssistantCourseworkFollowup['source'] = null;
  if (value.source !== null) {
    const item = object(value.source, ['title', 'courseName', 'dueAt', 'state', 'submitted']);
    if ((item.state !== 'open' && item.state !== 'closed') || typeof item.submitted !== 'boolean') return invalid();
    source = { title: text(item.title, 1000), courseName: text(item.courseName, 1000),
      dueAt: dueAt(item.dueAt), state: item.state, submitted: item.submitted };
  }
  const status = value.status as AssistantCourseworkFollowupStatus;
  const calendar = value.calendar as AssistantCourseworkFollowup['calendar'];
  if (status === 'not_coursework') {
    if (task !== null || source !== null || calendar !== 'unavailable') return invalid();
  } else {
    if (task === null || (status !== 'unavailable' && (source === null || calendar === 'unavailable'))) return invalid();
    if (status === 'submitted' && source?.submitted !== true) return invalid();
    if (status === 'closed' && (source?.state !== 'closed' || source.submitted)) return invalid();
    if (!['submitted', 'closed', 'unavailable'].includes(status) &&
        (source?.state !== 'open' || source.submitted !== false)) return invalid();
    if (status === 'event_changed' && calendar !== 'changed') return invalid();
    if (status === 'event_missing' && calendar !== 'missing') return invalid();
    if (['scheduled', 'in_progress', 'elapsed', 'source_changed', 'conflict'].includes(status) && calendar !== 'matching')
      return invalid();
    if (['scheduled', 'in_progress', 'elapsed'].includes(status)) {
      const start = Date.parse(`${event.date}T${event.allDay ? '00:00' : event.startTime}:00+08:00`);
      const end = event.allDay
        ? event.endDate ? Date.parse(`${event.endDate}T00:00:00+08:00`) : start + 86400000
        : Date.parse(`${event.endDate || event.date}T${event.endTime}:00+08:00`);
      const checked = Date.parse(value.checkedAt);
      if ((status === 'scheduled' && checked >= start) ||
          (status === 'in_progress' && (checked < start || checked >= end)) ||
          (status === 'elapsed' && checked < end)) return invalid();
    }
  }
  return { version: 1, operation: 'coursework.followup', schoolId: target.schoolId,
    mutationId: target.mutationId, checkedAt: value.checkedAt, status, task, source, calendar, event };
}
