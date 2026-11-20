export function nuniReminderWindow(dueAtMs: number, triggerAt: number, now = Date.now()) {
  if (!Number.isFinite(triggerAt) || triggerAt <= now + 60_000) return 'too-soon';
  if (!Number.isFinite(dueAtMs) || dueAtMs - now > 366 * 86_400_000) return 'too-far';
  return 'ready';
}
