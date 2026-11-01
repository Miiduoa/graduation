import { describe, expect, it } from 'vitest';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import {
  buildStudyCalendar,
  studyCalendarCandidates,
  studyCalendarKey,
  studyCalendarTaskUrl,
  studyDeadline,
} from '@campus/shared/src/studyAgendaCalendar';

const task = (overrides: Partial<NuniStudyTask> = {}): NuniStudyTask => ({
  id: 'a',
  courseId: 'c',
  courseTitle: '中文課程',
  title: '期末報告',
  kind: 'assignment',
  state: 'open',
  dueAt: '2026-11-02T00:30:00+08:00',
  submittedAt: null,
  feedback: null,
  reviewedAt: null,
  ...overrides,
});

describe('未繳期限快照', () => {
  it('excludes submitted, uncertain receipts, closed, missing and invalid deadlines; deduplicates identities', () => {
    const valid = task();
    expect(
      studyCalendarCandidates([
        valid,
        valid,
        task({ submittedAt: 'bad' }),
        task({ submittedAt: '2026-11-01T00:00:00Z' }),
        task({ state: 'closed' }),
        task({ dueAt: null }),
        task({ dueAt: '2026-11-02' }),
        task({ dueAt: '2026-02-30T12:00:00Z' }),
      ]),
    ).toEqual([valid]);
  });
  it('interprets explicit offsets and Taiwan wall times independently of host timezone', () => {
    const expected = Date.parse('2026-11-01T16:30:00Z');
    expect(studyDeadline(task())).toBe(expected);
    expect(studyDeadline(task({ dueAt: '2026-11-02T00:30' }))).toBe(expected);
    expect(studyDeadline(task({ dueAt: '2026-11-01T16:30:00Z' }))).toBe(expected);
    expect(studyDeadline(task({ dueAt: 'next Monday' }))).toBeNull();
  });
  it('exports only chosen eligible tasks with stable distinct identities and exact UTC times', () => {
    const assignment = task();
    const quiz = task({ kind: 'quiz' });
    const selected = [studyCalendarKey(assignment), studyCalendarKey(quiz)];
    const content = buildStudyCalendar(
      [assignment, quiz],
      selected,
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(content).toContain('DTSTART:20261101T163000Z');
    expect(content).toContain('DTEND:20261101T163000Z');
    expect(content).toContain('UID:study-c:assignment:a@nuni.tw');
    expect(content).toContain('UID:study-c:quiz:a@nuni.tw');
    expect(content).toContain('URL:https://nuni.tw/classroom/course/c?view=quizzes#quiz-a');
    expect(buildStudyCalendar([assignment], selected, new Date('2026-12-01T00:00:00Z'))).toContain(
      'UID:study-c:assignment:a@nuni.tw',
    );
    expect(() => buildStudyCalendar([task({ submittedAt: 'now' })], selected)).toThrow();
    expect(() => buildStudyCalendar([assignment], [])).toThrow();
  });
  it('escapes text and folds Chinese without breaking UTF-8 or injecting properties', () => {
    const item = task({ title: '報告,測驗;\\\r\nURL:secret' + '中文'.repeat(50) });
    const content = buildStudyCalendar([item], [studyCalendarKey(item)]);
    expect(content.replace(/\r\n /g, '')).toContain('報告\\,測驗\\;\\\\\\nURL:secret');
    expect(content).not.toContain('\r\nURL:secret');
    for (const line of content.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const url = new URL(studyCalendarTaskUrl(task({ courseId: 'c?token=secret', id: 'a\r\nX:1' })));
    expect([...url.searchParams.keys()]).toEqual(['view']);
    expect(url.hash).toContain('%0D%0A');
  });
});
