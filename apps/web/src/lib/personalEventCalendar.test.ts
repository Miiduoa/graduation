import { describe, expect, it } from 'vitest';
import {
  buildPersonalEventsCalendar,
  exclusiveAllDayEnd,
  personalEventDraftIssues,
  personalEventRowFromDraft,
  emptyPersonalEventDraft,
  type PersonalImportRecord,
} from '@campus/shared';

function event(overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord {
  return {
    id: 'evt-1',
    kind: 'events',
    title: '讀書會',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-20',
    startTime: '18:00',
    endTime: '19:30',
    location: '圖書館, 3F',
    batchId: 'batch-1',
    importedAt: '2026-10-01T00:00:00.000Z',
    source: { type: 'paste', name: '手動新增', line: 1, rawText: '讀書會' },
    ...overrides,
  };
}

describe('personal event calendar export', () => {
  it('exports timed Taipei events with escaping and CRLF folding', () => {
    const result = buildPersonalEventsCalendar([event()], {
      now: new Date('2026-10-23T04:00:00.000Z'),
    });
    expect(result.eventCount).toBe(1);
    expect(result.content).toContain('BEGIN:VCALENDAR\r\n');
    expect(result.content).toContain('X-WR-TIMEZONE:Asia/Taipei');
    expect(result.content).toContain('DTSTART;TZID=Asia/Taipei:20261020T180000');
    expect(result.content).toContain('DTEND;TZID=Asia/Taipei:20261020T193000');
    expect(result.content).toContain('LOCATION:圖書館\\, 3F');
    expect(result.content).toMatch(/\r\nEND:VCALENDAR\r\n$/);
    expect(result.content).toContain('匯出不是報名或 RSVP');
  });

  it('uses exclusive end dates for all-day and overnight ranges', () => {
    expect(exclusiveAllDayEnd('2026-10-20')).toBe('2026-10-21');
    expect(exclusiveAllDayEnd('2026-10-20', '2026-10-23')).toBe('2026-10-23');
    const allDay = buildPersonalEventsCalendar([
      event({
        id: 'all-day',
        title: '連假',
        allDay: true,
        startTime: undefined,
        endTime: undefined,
        endDate: '2026-10-23',
      }),
    ]);
    expect(allDay.content).toContain('DTSTART;VALUE=DATE:20261020');
    expect(allDay.content).toContain('DTEND;VALUE=DATE:20261023');
    const overnight = buildPersonalEventsCalendar([
      event({
        id: 'overnight',
        title: '通宵',
        date: '2026-10-20',
        endDate: '2026-10-21',
        startTime: '22:00',
        endTime: '01:00',
      }),
    ]);
    expect(overnight.content).toContain('DTSTART;TZID=Asia/Taipei:20261020T220000');
    expect(overnight.content).toContain('DTEND;TZID=Asia/Taipei:20261021T010000');
  });

  it('skips non-events and invalid rows without inventing times', () => {
    const result = buildPersonalEventsCalendar([
      event(),
      { ...event({ id: 'grade', kind: 'grades', title: '成績', credits: 3, grade: '90' }) },
      event({ id: 'bad', title: '', date: 'not-a-date' }),
    ] as PersonalImportRecord[]);
    expect(result).toMatchObject({ eventCount: 1, skipped: 2 });
  });
});

describe('personal event draft validation', () => {
  it('rejects end-before-start and all-day boundary mistakes', () => {
    const reversed = personalEventRowFromDraft(
      { ...emptyPersonalEventDraft(), title: '錯', date: '2026-10-20', startTime: '18:00', endTime: '17:00', allDay: false, endDate: '', location: '' },
      'pu',
    );
    expect(personalEventDraftIssues(reversed).some((issue) => issue.code === 'reversed-event')).toBe(
      true,
    );
    const allDayBad = personalEventRowFromDraft(
      {
        ...emptyPersonalEventDraft(),
        title: '全天',
        date: '2026-10-20',
        endDate: '2026-10-20',
        allDay: true,
        startTime: '',
        endTime: '',
        location: '',
      },
      'pu',
    );
    expect(personalEventDraftIssues(allDayBad).some((issue) => issue.code === 'reversed-event')).toBe(
      true,
    );
  });

  it('preserves id, source and course metadata when revising location', () => {
    const original = event({
      id: 'stable-id',
      courseCode: 'IM201',
      teacher: '王老師',
      className: '資管二A',
      linkedCourseId: 'ws-1',
      source: { type: 'file', name: '公告.ics', line: 3, rawText: 'SUMMARY:舊' },
    });
    const revised = personalEventRowFromDraft(
      {
        title: original.title,
        date: original.date!,
        endDate: '',
        allDay: false,
        startTime: '18:00',
        endTime: '19:30',
        location: '主顧 505',
      },
      'pu',
      original,
    );
    expect(revised).toMatchObject({
      id: 'stable-id',
      courseCode: 'IM201',
      teacher: '王老師',
      className: '資管二A',
      linkedCourseId: 'ws-1',
      location: '主顧 505',
      source: original.source,
    });
  });
});
