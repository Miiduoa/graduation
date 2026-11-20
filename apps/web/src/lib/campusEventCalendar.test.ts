import { describe, expect, it } from 'vitest';
import { parsePersonalImport } from '@campus/shared';
import { buildCampusEventCalendar, canExportCampusEvent } from './campusEventCalendar';
import type { CampusEvent } from './campusEvents';

const event: CampusEvent = {
  id: 'talk-1', schoolId: 'nthu', source: 'school-events', title: '校園讀書會',
  description: '一起閱讀', location: '圖書館, 3F', organizer: '閱讀社',
  startsAt: '2026-10-25T14:00:00Z', endsAt: '2026-10-25T18:00:00Z',
  appRegistrationConfigured: false,
};
const url = 'https://campus.example/events/talk-1?schoolId=nthu&source=school-events';
const now = new Date('2026-10-25T04:00:00Z');

describe('campus event calendar downloads', () => {
  it('round-trips an overnight event through calendar import without changing Taipei times', () => {
    const result = buildCampusEventCalendar(event, url, now);
    const parsed = parsePersonalImport(result.content, {
      kind: 'events', schoolId: 'nthu', academicYear: '115', semester: '1',
      source: { type: 'file', name: result.filename },
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ title: event.title, date: '2026-10-25', startTime: '22:00', endDate: '2026-10-26', endTime: '02:00', location: event.location });
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.content).toContain('URL:' + url);
    expect(result.content).not.toMatch(/BEGIN:VALARM|ATTENDEE|RRULE/);
    expect(result).toMatchObject({ filename: 'campus-event-20261025.ics', hasEndTime: true });
  });

  it.each([undefined, 'invalid', '2026-10-25T13:00:00Z', event.startsAt])('does not invent an end for %s', (endsAt) => {
    const result = buildCampusEventCalendar({ ...event, endsAt }, url, now);
    expect(result.hasEndTime).toBe(false);
    expect(result.content).not.toContain('DTEND');
    expect(result.content.replace(/\r\n /g, '')).toContain('未提供有效的結束時間');
  });

  it('escapes property injection and folds Chinese and emoji without corrupting content', () => {
    const title = '中文🌿'.repeat(30) + '\r\nATTENDEE:malicious@example.com';
    const result = buildCampusEventCalendar({ ...event, title, description: '行一\nBEGIN:VEVENT\n行二; \\路徑' }, url, now);
    for (const line of result.content.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(result.content.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    expect(result.content).not.toMatch(/^ATTENDEE:/m);
    expect(result.content).not.toContain('\ufffd');
    const parsed = parsePersonalImport(result.content, { kind: 'events', schoolId: 'nthu', academicYear: '', semester: '' });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.title).toBe(title.replace('\r\n', '\n'));
  });

  it('uses stable source-and-school identities even when two sources share an event id', () => {
    const uid = (item: CampusEvent) => buildCampusEventCalendar(item, url, now).content.match(/^UID:.+$/m)?.[0];
    expect(uid(event)).toBe(uid({ ...event, title: '更新後' }));
    expect(uid(event)).not.toBe(uid({ ...event, source: 'school-club-events' }));
    expect(uid(event)).not.toBe(uid({ ...event, schoolId: 'pu' }));
  });

  it('refuses invalid starts, dates, and unsupported link schemes', () => {
    expect(canExportCampusEvent({ startsAt: '' })).toBe(false);
    expect(() => buildCampusEventCalendar({ ...event, startsAt: '' }, url, now)).toThrow('開始時間');
    expect(() => buildCampusEventCalendar(event, url, new Date(NaN))).toThrow('目前時間');
    expect(() => buildCampusEventCalendar(event, 'javascript:alert(1)', now)).toThrow('活動連結');
  });
});
