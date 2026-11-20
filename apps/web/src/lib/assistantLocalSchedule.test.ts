import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classMeetingKey, manualClassRecords } from '@campus/shared/src/timetable/classExceptions';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { answerLocalSchedule, parseLocalScheduleIntent } from './assistantLocalSchedule';
import { answerAssistantLocally, canAnswerAssistantLocally } from './assistantLocalActions';
import { personalImportsStorageKey } from './personalImports';
import type { StoredTimetable } from './timetable/store';

const scope = { owner: 'platform:alice', schoolId: 'pu' };
const now = new Date('2026-11-11T16:30:00.000Z'); // Thursday 00:30 in Taipei, still Wednesday in UTC.
const deviceKey = (owner = scope.owner, schoolId = scope.schoolId) => `campus-one-personal-timetable:${owner}:${schoolId}`;
function timetable(): StoredTimetable {
  return {
    schoolId: 'pu', updatedAt: '2026-11-10T10:00:00.000Z', shareWithFriends: false,
    meta: { school: '靜宜大學', year: '115', semester: '1', className: '', credits: 3, title: '' },
    courses: [
      { id: 'db', name: '資料庫管理', day: 4, start: 1, end: 2, room: '主顧 305', teacher: '王老師', color: 'blue' },
      { id: 'project', name: '專題實作', day: 5, start: 6, end: 7, room: '計中 201', teacher: '', color: 'gray' },
    ],
  };
}
const event = (id: string, values: Partial<PersonalImportRecord>): PersonalImportRecord => ({
  id, kind: 'events', title: id, schoolId: 'pu', academicYear: '', semester: '',
  date: '2026-11-12', startTime: '18:00', endTime: '19:00', allDay: false,
  batchId: 'batch-a', importedAt: '2026-11-10T10:00:00.000Z',
  source: { type: 'paste', line: 1, rawText: '原始私人內容不得出現在回答' }, ...values,
});
const saveImports = (records: PersonalImportRecord[]) =>
  localStorage.setItem(personalImportsStorageKey(scope), JSON.stringify({ version: 1, records }));
const answer = (question: string, at = now) => answerLocalSchedule(parseLocalScheduleIntent(question)!, scope, at);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local schedule questions', () => {
  it.each([
    ['我今天有什麼課', 'classes'], ['幫我查一下明天的課表', 'classes'],
    ['請問2026-11-13有課嗎？', 'classes'], ['下一堂課在哪裡？', 'next-class'],
    ['告訴我下一堂課的教室', 'next-class'], ['我今天有什麼行程', 'events'],
    ['查看明天下午的行事曆', 'events'],
  ])('accepts a complete information request: %s', (question, kind) => {
    expect(parseLocalScheduleIntent(question)?.kind).toBe(kind);
    expect(canAnswerAssistantLocally(question)).toBe(true);
  });

  it.each([
    '幫我安排明天下午讀書', '今天有什麼課，然後幫我訂午餐',
    '明天新增一個行程', '今天還有什麼作業沒交', '今天有哪些活動',
    '不要查看今天的課表', '翻譯「我今天有什麼課」', '2026-02-30的課表',
    '今天的課表\n幫我新增行程', '開啟課表',
  ])('does not swallow a mutation, other domain or ambiguous date: %s', (question) => {
    expect(parseLocalScheduleIntent(question)).toBeNull();
  });

  it('answers the actual saved timetable in Taipei time without a network call', () => {
    localStorage.setItem(deviceKey(), JSON.stringify(timetable()));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = answerAssistantLocally('我今天有什麼課', scope);
    expect(result?.kind).toBe('schedule');
    expect(result?.content).toContain('2026-11-12（週四）');
    expect(result?.content).toContain('08:10–10:00');
    expect(result?.content).toContain('資料庫管理；教室：主顧 305；教師：王老師');
    expect(result?.content).not.toContain('專題實作');
    expect(result?.content).toContain('115 學年度第 1 學期');
    expect(result?.content).toContain('2026-11-12 00:30（台灣時間）');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('selects tomorrow, an exact date and the next future class with its room', () => {
    localStorage.setItem(deviceKey(), JSON.stringify(timetable()));
    expect(answer('明天有什麼課').content).toContain('專題實作；教室：計中 201');
    expect(answer('2026-11-13的課表').content).toContain('專題實作');
    const next = answer('下一堂課在哪裡', new Date('2026-11-12T09:00:00+08:00'));
    expect(next.content).toContain('2026-11-13（週五）');
    expect(next.content).toContain('計中 201');
    expect(next.content).not.toContain('資料庫管理');
  });

  it('does not read the same person\'s other school or another account', () => {
    localStorage.setItem(deviceKey(), JSON.stringify(timetable()));
    for (const other of [{ ...scope, owner: 'platform:bob' }, { ...scope, schoolId: 'ntpu' }]) {
      const result = answerLocalSchedule({ kind: 'classes', day: 0 }, other, now);
      expect(result.availability).toBe('missing');
      expect(result.content).not.toContain('資料庫管理');
    }
  });

  it('never adopts guest data or reads any storage for an unauthenticated scope', () => {
    localStorage.setItem(deviceKey('local'), JSON.stringify(timetable()));
    expect(answer('今天的課表').availability).toBe('missing');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const result = answerLocalSchedule({ kind: 'classes', day: 0 }, { owner: 'guest', schoolId: 'pu' }, now);
    expect(result.availability).toBe('unavailable');
    expect(getItem).not.toHaveBeenCalled();
  });

  it('reads only the same school account\'s existing legacy device namespace', () => {
    localStorage.setItem(deviceKey('school-uid'), JSON.stringify(timetable()));
    const result = answerLocalSchedule({ kind: 'classes', day: 0 }, { owner: 'school:school-uid', schoolId: 'pu' }, now);
    expect(result.content).toContain('資料庫管理');
    expect(answer('今天的課表').availability).toBe('missing');
  });

  it('keeps missing and damaged sources distinct from a known timetable day with no classes', () => {
    expect(answer('今天有什麼課')).toMatchObject({ availability: 'missing' });
    expect(answer('今天有什麼課').content).toContain('無法判定當天是否有課');
    localStorage.setItem(deviceKey(), '{bad-json');
    expect(answer('今天有什麼課')).toMatchObject({ availability: 'unavailable' });
    expect(localStorage.getItem(deviceKey())).toBe('{bad-json');
    localStorage.setItem(deviceKey(), JSON.stringify(timetable()));
    expect(answer('後天有什麼課').content).toContain('這份週課表在查詢時段沒有排課');
  });

  it('lets an authorized cloud query proceed when no local source exists', () => {
    expect(answerAssistantLocally('我今天有什麼課', scope, { deferMissingSchedule: true })).toBeNull();
    localStorage.setItem(deviceKey(), JSON.stringify(timetable()));
    expect(answerAssistantLocally('我今天有什麼課', scope, { deferMissingSchedule: true })?.content).toContain('資料庫管理');
    expect(answerAssistantLocally('我今天有什麼課', scope, { preferCampusReads: true })).toBeNull();
  });

  it('does not mistake a timetable-only import for complete personal-event coverage', () => {
    saveImports([{ ...manualClassRecords(timetable())[0], id: 'imported-db', batchId: 'import-b' }]);
    expect(answer('今天有什麼行程').availability).toBe('missing');
    expect(answerAssistantLocally('今天有什麼行程', scope, { deferMissingSchedule: true })).toBeNull();
    expect(answer('今天有什麼行程').content).toContain('無法判定當天是否有行程');
  });

  it('preserves saved punctuation for the plain-text reply renderer', () => {
    const saved = timetable();
    saved.courses[0].name = '[假連結](https://example.test) | **標題**';
    localStorage.setItem(deviceKey(), JSON.stringify(saved));
    const result = answer('今天有什麼課');
    expect(result.content).toContain('[假連結](https://example.test) | **標題**');
    expect(result.content).not.toContain('\\[');
  });

  it('does not invent a first period or an untitled class from damaged device fields', () => {
    const saved = timetable();
    saved.courses[0].start = 999;
    localStorage.setItem(deviceKey(), JSON.stringify(saved));
    expect(answer('今天有什麼課').availability).toBe('unavailable');
    expect(answer('今天有什麼課').content).not.toContain('08:10');
    expect(JSON.parse(localStorage.getItem(deviceKey())!).courses[0].start).toBe(999);
  });

  it('applies a saved cancellation and make-up class instead of repeating the weekly slot', () => {
    const saved = timetable();
    const original = manualClassRecords(saved)[0];
    saved.classExceptions = [{ id: 'makeup', kind: 'move', courseKey: classMeetingKey(original),
      original, originalDate: '2026-11-12', date: '2026-11-13', startTime: '10:10', endTime: '11:00',
      location: '主顧 999', createdAt: '2026-11-10T10:00:00.000Z' }];
    localStorage.setItem(deviceKey(), JSON.stringify(saved));
    expect(answer('今天有什麼課').content).not.toContain('資料庫管理');
    expect(answer('明天有什麼課').content).toContain('10:10–11:00　資料庫管理；教室：主顧 999');
  });

  it('combines manual and imported class records without duplicating an identical meeting', () => {
    const saved = timetable();
    localStorage.setItem(deviceKey(), JSON.stringify(saved));
    saveImports([{ ...manualClassRecords(saved)[0], id: 'imported-db', batchId: 'import-b' }]);
    const result = answer('今天有什麼課');
    expect(result.content.match(/資料庫管理/g)).toHaveLength(1);
  });

  it('marks unplaced courses and never calls an incomplete timetable a free day', () => {
    const saved = timetable();
    saved.courses = [{ ...saved.courses[0], day: 0, start: 0, end: 0 }];
    localStorage.setItem(deviceKey(), JSON.stringify(saved));
    const result = answer('今天有什麼課');
    expect(result.content).toContain('1 筆課程的星期或時間尚未填妥');
    expect(result.content).not.toMatch(/今天沒有課|今天有空|全天空閒/);
  });

  it('shows a cross-midnight personal event and respects an all-day exclusive end', () => {
    saveImports([
      event('跨日讀書', { date: '2026-11-11', endDate: '2026-11-12', startTime: '23:30', endTime: '01:00', location: '閱覽室' }),
      event('已結束全天活動', { date: '2026-11-10', endDate: '2026-11-12', allDay: true, startTime: undefined, endTime: undefined }),
      event('當天全天活動', { allDay: true, startTime: undefined, endTime: undefined }),
      event('晚上聚會', { startTime: '19:00', endTime: '20:00' }),
    ]);
    const result = answer('我今天有什麼行程');
    expect(result.content).toContain('2026-11-11 23:30–01:00　跨日讀書；地點：閱覽室');
    expect(result.content).toContain('全天　當天全天活動');
    expect(result.content).not.toContain('已結束全天活動');
    expect(result.content).not.toContain('原始私人內容');
    const afternoon = answer('今天下午有什麼行程');
    expect(afternoon.content).toContain('當天全天活動');
    expect(afternoon.content).not.toContain('跨日讀書');
    expect(afternoon.content).not.toContain('晚上聚會');
  });
});
