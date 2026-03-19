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
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

export function normalizeNotificationPreferences(
  value?: Partial<NotificationPreferences> | null
): NotificationPreferences {
  return {
    ...defaultNotificationPreferences,
    ...(value ?? {}),
  };
}
