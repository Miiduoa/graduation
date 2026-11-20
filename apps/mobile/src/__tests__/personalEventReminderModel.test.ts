import {
  ALL_DAY_REMINDER_HOUR,
  ALL_DAY_REMINDER_MINUTE,
  allDayPreference,
  asiaTaipeiInstant,
  buildPersonalEventReminderPayload,
  computePersonalEventReminderTrigger,
  isPersonalEventReminderPayload,
  personalEventReminderRevision,
  timedPreference,
} from '../services/personalEventReminderModel';
import type { PersonalImportRecord } from '../services/personalImports';

const baseEvent = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'evt-1',
  kind: 'events',
  title: '秘密會議',
  schoolId: 'pu',
  academicYear: '',
  semester: '',
  date: '2026-11-01',
  startTime: '10:00',
  endTime: '11:00',
  batchId: 'batch-a',
  importedAt: '2026-10-01T00:00:00.000Z',
  source: { type: 'paste', name: '手動新增', line: 1, rawText: '秘密會議' },
  ...overrides,
});

test('Asia/Taipei instants are absolute and independent of local timezone offset construction', () => {
  const instant = asiaTaipeiInstant('2026-11-01', '10:00');
  expect(instant).not.toBeNull();
  // 10:00+08:00 == 02:00Z
  expect(instant!.toISOString()).toBe('2026-11-01T02:00:00.000Z');
});

test('impossible calendar dates are rejected and never roll into the next month', () => {
  expect(asiaTaipeiInstant('2027-02-31', '09:00')).toBeNull();
  expect(asiaTaipeiInstant('2026-11-31', '10:00')).toBeNull();
  expect(asiaTaipeiInstant('2026-04-31', '08:00')).toBeNull();
  expect(
    computePersonalEventReminderTrigger(
      baseEvent({ date: '2027-02-31', allDay: true, startTime: undefined, endTime: undefined }),
      allDayPreference(),
      new Date('2026-10-01T00:00:00.000Z'),
    ),
  ).toEqual({ ok: false, reason: 'invalid' });
});

test('timed leads include start / 10 / 30 / 60 and reject elapsed or invalid times', () => {
  const now = new Date('2026-11-01T00:00:00.000Z'); // 08:00 Taipei
  const atStart = computePersonalEventReminderTrigger(
    baseEvent(),
    timedPreference(0),
    now,
  );
  expect(atStart.ok).toBe(true);
  if (atStart.ok) expect(atStart.triggerAt.toISOString()).toBe('2026-11-01T02:00:00.000Z');

  const lead60 = computePersonalEventReminderTrigger(
    baseEvent(),
    timedPreference(60),
    now,
  );
  expect(lead60.ok).toBe(true);
  if (lead60.ok) expect(lead60.triggerAt.toISOString()).toBe('2026-11-01T01:00:00.000Z');

  // Cross-midnight lead: 00:30 Taipei start with 60 minutes -> previous calendar day 23:30 Taipei
  const late = computePersonalEventReminderTrigger(
    baseEvent({ date: '2026-11-01', startTime: '00:30', endTime: '01:00' }),
    timedPreference(60),
    new Date('2026-10-31T00:00:00.000Z'),
  );
  expect(late.ok).toBe(true);
  if (late.ok) expect(late.triggerAt.toISOString()).toBe('2026-10-31T15:30:00.000Z');

  const past = computePersonalEventReminderTrigger(
    baseEvent(),
    timedPreference(0),
    new Date('2026-11-01T03:00:00.000Z'),
  );
  expect(past).toEqual({ ok: false, reason: 'elapsed' });

  const invalid = computePersonalEventReminderTrigger(
    baseEvent({ startTime: '99:99' }),
    timedPreference(10),
    now,
  );
  expect(invalid).toEqual({ ok: false, reason: 'invalid' });
});

test('all-day reminders require the explicit Taiwan 09:00 and never use exclusive endDate', () => {
  const row = baseEvent({
    allDay: true,
    startTime: undefined,
    endTime: undefined,
    endDate: '2026-11-03',
  });
  const now = new Date('2026-10-31T00:00:00.000Z');
  const trigger = computePersonalEventReminderTrigger(row, allDayPreference(), now);
  expect(trigger.ok).toBe(true);
  if (trigger.ok) {
    expect(trigger.triggerAt.toISOString()).toBe(
      asiaTaipeiInstant('2026-11-01', `${String(ALL_DAY_REMINDER_HOUR).padStart(2, '0')}:${String(ALL_DAY_REMINDER_MINUTE).padStart(2, '0')}`)!.toISOString(),
    );
    // Must not be midnight of start or exclusive end.
    expect(trigger.triggerAt.toISOString()).not.toBe('2026-11-01T00:00:00.000Z');
    expect(trigger.triggerAt.toISOString()).not.toContain('2026-11-03');
  }
  expect(
    computePersonalEventReminderTrigger(row, timedPreference(10), now),
  ).toEqual({ ok: false, reason: 'invalid' });
});

test('payload stays opaque and revision changes when timing or batch changes', () => {
  const payload = buildPersonalEventReminderPayload({
    lookupToken: 'tok-abc',
    intentGeneration: 3,
  });
  expect(isPersonalEventReminderPayload(payload)).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('秘密');
  expect(payload).toEqual({
    type: 'personal_event_reminder_v1',
    v: 1,
    t: 'tok-abc',
    g: 3,
  });
  expect(isPersonalEventReminderPayload({ type: 'event', id: 'x' })).toBe(false);

  const a = personalEventReminderRevision(baseEvent());
  const b = personalEventReminderRevision(baseEvent({ batchId: 'revision:new' }));
  const c = personalEventReminderRevision(baseEvent({ startTime: '11:00' }));
  expect(a).not.toBe(b);
  expect(a).not.toBe(c);
});
