export type NotificationPreferences = {
  enabled: boolean;
  announcements: boolean;
  events: boolean;
  groups: boolean;
  assignments: boolean;
  grades: boolean;
  messages: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  announcements: true,
  events: true,
  groups: true,
  assignments: true,
  grades: true,
  messages: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

export function normalizeNotificationPreferences(
  value?: Partial<NotificationPreferences> | null,
): NotificationPreferences {
  return {
    ...defaultNotificationPreferences,
    ...(value ?? {}),
  };
}

export const quietHoursTimeKeys = ['quietHoursStart', 'quietHoursEnd'] as const;
export type QuietHoursTimeKey = (typeof quietHoursTimeKeys)[number];

const notificationTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A complete 24-hour `HH:MM` time, the only form the notification service accepts. */
export function isValidNotificationTime(value: unknown): value is string {
  return typeof value === 'string' && notificationTimePattern.test(value);
}

/** The known preference values only; unrelated stored fields (such as `updatedAt`) are dropped. */
export function pickNotificationPreferences(
  value?: Partial<NotificationPreferences> | null,
): NotificationPreferences {
  const normalized = normalizeNotificationPreferences(value);
  return {
    enabled: normalized.enabled,
    announcements: normalized.announcements,
    events: normalized.events,
    groups: normalized.groups,
    assignments: normalized.assignments,
    grades: normalized.grades,
    messages: normalized.messages,
    quietHoursEnabled: normalized.quietHoursEnabled,
    quietHoursStart: normalized.quietHoursStart,
    quietHoursEnd: normalized.quietHoursEnd,
  };
}

/** A write sends every preference, so a partial receipt cannot confirm even a default value. */
export function confirmsNotificationPreferences(
  receipt: Partial<NotificationPreferences> | null | undefined,
  expected: NotificationPreferences,
): boolean {
  const keys = Object.keys(defaultNotificationPreferences) as Array<keyof NotificationPreferences>;
  return !!receipt && keys.every((key) => receipt[key] === expected[key]);
}

export type PreparedNotificationPreferences =
  | { ok: true; preferences: NotificationPreferences }
  | { ok: false; invalidTimes: QuietHoursTimeKey[] };

/** Keep valid edits to inactive hours, restoring only unfinished fields from the saved schedule. */
export function prepareNotificationPreferencesForSave(
  draft: Partial<NotificationPreferences>,
  baseline?: Partial<NotificationPreferences> | null,
): PreparedNotificationPreferences {
  const preferences = pickNotificationPreferences(draft);
  if (preferences.enabled && preferences.quietHoursEnabled) {
    const invalidTimes = quietHoursTimeKeys.filter(
      (key) => !isValidNotificationTime(preferences[key]),
    );
    return invalidTimes.length ? { ok: false, invalidTimes } : { ok: true, preferences };
  }
  for (const key of quietHoursTimeKeys) {
    if (isValidNotificationTime(preferences[key])) continue;
    const previous = baseline?.[key];
    preferences[key] = isValidNotificationTime(previous)
      ? previous
      : defaultNotificationPreferences[key];
  }
  return { ok: true, preferences };
}
