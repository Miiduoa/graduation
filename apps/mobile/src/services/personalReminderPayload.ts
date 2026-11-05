import { isPersonalEventReminderPayload } from './personalEventReminderModel';

export const PERSONAL_CLASS_REMINDER_CATEGORY = 'personal_class_occurrence';

export function isClassReminderPayload(data: unknown): data is {
  category: typeof PERSONAL_CLASS_REMINDER_CATEGORY;
  scope?: unknown;
  courseId?: unknown;
  startAt?: unknown;
} {
  return typeof data === 'object' && data !== null && 'category' in data &&
    data.category === PERSONAL_CLASS_REMINDER_CATEGORY;
}

/** Class and event taps share a scope-aware consumer. Never log their contents. */
export function personalReminderCategory(data: unknown) {
  if (isClassReminderPayload(data)) return 'personal_class_reminder_local';
  if (isPersonalEventReminderPayload(data)) return 'personal_event_reminder_local';
  return null;
}
