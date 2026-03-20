const {
  defaultNotificationPreferences,
  isInQuietHours,
} = require("../lib/notificationService");

describe("notificationService", () => {
  test("returns default notification preferences", () => {
    expect(defaultNotificationPreferences()).toEqual({
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
    });
  });

  test("detects quiet hours within a same-day window", () => {
    const prefs = {
      ...defaultNotificationPreferences(),
      quietHoursEnabled: true,
      quietHoursStart: "09:00",
      quietHoursEnd: "18:00",
    };

    expect(isInQuietHours(prefs, new Date("2026-03-20T10:30:00"))).toBe(true);
    expect(isInQuietHours(prefs, new Date("2026-03-20T08:30:00"))).toBe(false);
  });

  test("detects overnight quiet hours", () => {
    const prefs = {
      ...defaultNotificationPreferences(),
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    };

    expect(isInQuietHours(prefs, new Date("2026-03-20T23:30:00"))).toBe(true);
    expect(isInQuietHours(prefs, new Date("2026-03-20T07:45:00"))).toBe(true);
    expect(isInQuietHours(prefs, new Date("2026-03-20T15:00:00"))).toBe(false);
  });
});
