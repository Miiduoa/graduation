import {
  answerSavedClassGapQuery, isSavedClassGapQuestion, isSavedClassGapRefinement,
  savedClassGapDayOffset, savedClassGapFollowUp, savedClassGapQuery, savedClassGapTitle,
  type SavedClassGapQuery,
} from '../../services/savedClassGapQuery';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

const today = { day: 'today', minMinutes: 0 } as const;
const tomorrow = { day: 'tomorrow', minMinutes: 30 } as const;

describe('class gap questions', () => {
  test.each([
    ['請問我今天還有哪些空堂？', today],
    ['接下來還有空堂嗎', today],
    ['今天什麼時候有空檔？', today],
    ['今天下午有哪些空堂？', { ...today, part: 'afternoon' }],
    ['我下午有沒有四十五分鐘的空堂？', { ...today, part: 'afternoon', minMinutes: 45 }],
    ['明天早上我有二十分鐘可以讀書的空堂嗎', { ...tomorrow, part: 'morning', minMinutes: 20 }],
    ['明天早上我有二十分鐘的空堂嗎', { ...tomorrow, part: 'morning', minMinutes: 20 }],
    ['明晚有三十分鐘空檔嗎', { ...tomorrow, part: 'evening' }],
    ['晚上有九十分鐘的空檔嗎', { ...today, part: 'evening', minMinutes: 90 }],
    ['今天有沒有一段空堂可以讀書', today],
    ['明天的空堂有哪些', { ...tomorrow, minMinutes: 0 }],
    ['明天兩堂課之間有沒有半小時的空檔？', tomorrow],
    ['今天課跟課之間有半小時可以吃飯嗎？', { ...today, minMinutes: 30 }],
    ['今天有空堂可以讀書半小時嗎', { ...today, minMinutes: 30 }],
    ['幫我查一下明天有３０分鐘以上的空堂嗎', tomorrow],
    ['明日的課表有至少一個小時的空檔嗎', { day: 'tomorrow', minMinutes: 60 }],
    ['後天有空堂嗎？', { day: 'day-after-tomorrow', minMinutes: 0 }],
    ['後天下午有一個半小時的空堂嗎？', { day: 'day-after-tomorrow', part: 'afternoon', minMinutes: 90 }],
    ['明天有1.5小時空堂嗎', { day: 'tomorrow', minMinutes: 90 }],
    ['今天有1.5h空堂嗎', { day: 'today', minMinutes: 90 }],
    ['今天有一小時半的空堂嗎', { day: 'today', minMinutes: 90 }],
    ['今天有一小時又三十分鐘的空堂嗎', { day: 'today', minMinutes: 90 }],
    ['明天有兩個半小時的空堂嗎', { day: 'tomorrow', minMinutes: 150 }],
    ['今天有半個小時的空堂嗎', { day: 'today', minMinutes: 30 }],
    ['今天15:30之後有45分鐘空堂嗎', { ...today, fromMinute: 930, minMinutes: 45 }],
    ['明天下午三點半到五點有空堂嗎', { day: 'tomorrow', fromMinute: 930, untilMinute: 1020, minMinutes: 0 }],
    ['今天下午三點到晚上七點有空堂嗎', { ...today, fromMinute: 900, untilMinute: 1140 }],
    ['今天13:00–16:45有空堂嗎', { ...today, fromMinute: 780, untilMinute: 1005 }],
    ['明天上午九點一刻之前有空堂嗎', { day: 'tomorrow', untilMinute: 555, minMinutes: 0 }],
    ['今天24:00之前有空堂嗎', { ...today, untilMinute: 1440 }],
    ['今天晚上六點到晚上十二點有空堂嗎', { ...today, fromMinute: 1080, untilMinute: 1440 }],
    ['今天凌晨十二點半之後有空堂嗎', { ...today, fromMinute: 30 }],
    ['明天凌晨十二點到早上六點有空堂嗎', { day: 'tomorrow', fromMinute: 0, untilMinute: 360, minMinutes: 0 }],
    ['今天下午有15:00之後的空堂嗎', { ...today, part: 'afternoon', fromMinute: 900 }],
  ])('parses %s', (question, expected) => expect(savedClassGapQuery(String(question))).toEqual(expected));

  test.each([
    '大後天有空堂嗎？', '星期二有空堂嗎', '今天和明天有空堂嗎', '今天幫我在空堂安排讀書',
    '今天有哪些空堂和待交作業？', '今天有空嗎？', '今天有空堂嗎，我要訂便當', '現在要去空堂教室開會',
    '今天有超過一小時的空檔嗎', '今天半小時後有空檔嗎', '今天沒有課嗎', '今天有 0 分鐘空檔嗎', '今天有#嗎',
    '今天三點半之後有空堂嗎', '今天15:75之後有空堂嗎', '今天25:00以前有空堂嗎',
    '今天15:00到14:00有空堂嗎', '今天24:00之後有空堂嗎', '今天00:00之前有空堂嗎',
    '今天晚上十一點到凌晨十二點有空堂嗎', '今天24:30之前有空堂嗎', '今天15:00到15:00有空堂嗎',
    '今天下午九點之後有空堂嗎', '今天下午有09:00之前的空堂嗎',
    '今天有一個半小時半空堂嗎', '今天有1.5小時30分鐘空堂嗎', '今天有一小時60分鐘空堂嗎',
    '今天有0.01小時空堂嗎', '今天有25小時空堂嗎', '今天有半分鐘空堂嗎',
    '今天有一小時以內空堂嗎', '今天15:00之後17:00之前有空堂嗎',
    '今天13:00到14:00有空堂然後幫我訂便當嗎', '今天全天15:00之後有空堂嗎',
  ])('leaves unsupported or mixed request %s alone', (question) => expect(savedClassGapQuery(question)).toBeNull());

  test('refines only an explicit date or minimum within the previous class-gap request', () => {
    expect(savedClassGapFollowUp('那明天呢？', { ...today, minMinutes: 30 })).toEqual(tomorrow);
    expect(savedClassGapFollowUp('那至少一小時呢？', tomorrow)).toEqual({ ...tomorrow, minMinutes: 60 });
    expect(savedClassGapFollowUp('那今天 45 分鐘以上呢', tomorrow)).toEqual({ ...today, minMinutes: 45 });
    const morning = { ...tomorrow, part: 'morning' as const };
    expect(savedClassGapFollowUp('那今天呢', morning)).toEqual({ ...morning, day: 'today' });
    expect(savedClassGapFollowUp('那四十五分鐘呢', morning)).toEqual({ ...morning, minMinutes: 45 });
    expect(savedClassGapFollowUp('下午呢', morning)).toEqual({ ...morning, part: 'afternoon' });
    expect(savedClassGapFollowUp('那後天呢', morning)).toEqual({ ...morning, day: 'day-after-tomorrow' });
    for (const question of ['那大後天呢', '那明天的作業呢', '那幫我安排半小時', '明天半小時以內呢', '幾點呢', '那呢']) {
      expect(savedClassGapFollowUp(question, tomorrow)).toBeNull();
    }
  });

  test('does not reuse corrupt restored filters in a follow-up', () => {
    const invalidPrevious: unknown[] = [
      null, undefined,
      { ...today, day: 'last-week' },
      { ...today, part: '__proto__' },
      { ...today, minMinutes: Number.NaN },
      { ...today, minMinutes: -1 },
      { ...today, minMinutes: Number.POSITIVE_INFINITY },
      { ...today, fromMinute: Number.NaN },
      { ...today, fromMinute: 1440 },
      { ...today, untilMinute: 1441 },
      { ...today, fromMinute: 960, untilMinute: 930 },
      { ...today, part: 'afternoon', fromMinute: 1140 },
      { ...today, part: 'morning', untilMinute: 780, fromMinute: 750 },
    ];
    for (const restored of invalidPrevious) {
      expect(savedClassGapFollowUp('那至少一小時呢', restored as SavedClassGapQuery)).toBeNull();
      expect(savedClassGapFollowUp('改成三點半之後', restored as SavedClassGapQuery)).toBeNull();
    }
    // A normal saved turn still carries forward day and duration as intended.
    expect(savedClassGapFollowUp('那至少一小時呢', today)).toEqual({ ...today, minMinutes: 60 });
  });

  test('keeps the other conditions while a student changes the date, length and clock window', () => {
    const initial = savedClassGapQuery('今天下午有45分鐘的空堂嗎')!;
    expect(initial).toEqual({ ...today, part: 'afternoon', minMinutes: 45 });
    const next = savedClassGapFollowUp('那明天有哪些空堂？', initial)!;
    expect(next).toEqual({ ...initial, day: 'tomorrow' });
    const longer = savedClassGapFollowUp('改成一個半小時', next)!;
    expect(longer).toEqual({ ...next, minMinutes: 90 });
    const later = savedClassGapFollowUp('只看15:30之後', longer)!;
    expect(later).toEqual({ day: 'tomorrow', minMinutes: 90, part: 'afternoon', fromMinute: 930 });
    const until = savedClassGapFollowUp('17:30之前呢', later)!;
    expect(until).toEqual({ ...later, untilMinute: 1050 });
    expect(savedClassGapFollowUp('只看15:00之前', until)).toBeNull();
    expect(savedClassGapFollowUp('改成晚上七點後', until)).toEqual({ day: 'tomorrow', minMinutes: 90, fromMinute: 1140 });
    const newPart = savedClassGapFollowUp('只看晚上', until)!;
    expect(newPart).toEqual({ day: 'tomorrow', minMinutes: 90, part: 'evening' });
    const anyLength = savedClassGapFollowUp('不限長度', newPart)!;
    expect(anyLength).toEqual({ ...newPart, minMinutes: 0 });
    expect(savedClassGapFollowUp('全天', anyLength)).toEqual({ day: 'tomorrow', minMinutes: 0 });
    expect(savedClassGapFollowUp('查看全天', until)).toEqual({ day: 'tomorrow', minMinutes: 90 });
  });

  test('a new full question resets conditions, while a prefixed restatement keeps them', () => {
    const previous = { ...tomorrow, part: 'afternoon' as const };
    expect(savedClassGapFollowUp('今天有哪些空堂？', previous)).toBeNull();
    expect(savedClassGapQuery('今天有哪些空堂？')).toEqual(today);
    expect(savedClassGapFollowUp('那今天有哪些空堂？', previous)).toEqual({ ...previous, day: 'today' });
    expect(savedClassGapFollowUp('只看一小時以上的空堂', previous)).toEqual({ ...previous, minMinutes: 60 });
    expect(savedClassGapFollowUp('下午有哪些空堂？', previous)).toEqual(previous);
  });

  test('uses an existing day part for spoken hours and never guesses an ambiguous clock', () => {
    expect(savedClassGapFollowUp('改成三點半之後', tomorrow)).toBeNull();
    expect(savedClassGapFollowUp('改成三點半之後', { ...tomorrow, part: 'afternoon' })).toEqual({
      ...tomorrow, fromMinute: 930,
    });
    expect(savedClassGapFollowUp('改成三點半之後', { ...tomorrow, part: 'morning' })).toEqual({
      ...tomorrow, fromMinute: 210,
    });
    expect(savedClassGapFollowUp('改成三點半之後', { ...tomorrow, part: 'evening' })).toBeNull();
  });

  test('narrowing a time preserves its day part, while replacing the time starts a new window', () => {
    const previous: SavedClassGapQuery = { ...tomorrow, part: 'afternoon' };
    expect(savedClassGapFollowUp('三點後呢', previous)).toEqual({ ...previous, fromMinute: 900 });
    expect(savedClassGapFollowUp('16:00以前呢', previous)).toEqual({ ...previous, untilMinute: 960 });
    expect(savedClassGapFollowUp('11:00之前呢', previous)).toBeNull();
    expect(savedClassGapFollowUp('只看15:30後', previous)).toEqual({ ...previous, fromMinute: 930 });
    expect(savedClassGapFollowUp('只看晚上七點後', previous)).toBeNull();
    expect(savedClassGapFollowUp('換成下午三點半以後', previous)).toEqual({ ...tomorrow, fromMinute: 930 });
    expect(savedClassGapFollowUp('改成11:00之前', previous)).toEqual({ ...tomorrow, untilMinute: 660 });
    expect(savedClassGapFollowUp('15:00到19:00呢', previous)).toEqual({ ...tomorrow, fromMinute: 900, untilMinute: 1140 });
    const narrowed = { ...previous, untilMinute: 960 };
    const conflicting = '那明天17:00以後有哪些空堂？';
    expect(savedClassGapFollowUp(conflicting, narrowed)).toBeNull();
    expect(isSavedClassGapRefinement(conflicting)).toBe(true);
  });

  test('recognizes unsupported lookup and refinement shapes without taking over another task', () => {
    for (const question of ['星期二有空堂嗎', '今天三點半之後有空堂嗎', '今天有90分鐘以內的空堂嗎']) {
      expect(isSavedClassGapQuestion(question)).toBe(true);
    }
    for (const question of ['今天有哪些空堂和待交作業', '今天幫我在空堂安排讀書', '現在要去空堂教室開會']) {
      expect(isSavedClassGapQuestion(question)).toBe(false);
    }
    for (const question of ['那三點半之後呢', '改成15:00到14:00', '只看一小時以內', '那下週二呢', '不限長度', '全天',
      '那明天17:00以後有哪些空堂？']) {
      expect(isSavedClassGapRefinement(question)).toBe(true);
    }
    for (const question of ['那明天的作業呢', '幫我安排半小時', '三點半訂餐', '那呢', '謝謝']) {
      expect(isSavedClassGapRefinement(question)).toBe(false);
    }
  });

  test.each([
    ['today', 0, '今日空堂'], ['tomorrow', 1, '明日空堂'], ['day-after-tomorrow', 2, '後天空堂'],
  ] as const)('shares the %s label and offset with source collection and the result card', (day, offset, title) => {
    expect(savedClassGapDayOffset(day)).toBe(offset);
    expect(savedClassGapTitle({ day, minMinutes: 0 })).toBe(title);
  });
});

const instant = (clock: string, date = '2026-11-06') => Date.parse(date + 'T' + clock + '+08:00');
const gap = (start: string, end: string, date?: string) => ({ startAt: instant(start, date), endAt: instant(end, date) });
const context: OnDeviceSchoolContext = {
  schoolId: 'pu', schoolName: '靜宜大學', checkedAt: '2026-11-06T10:00:01+08:00',
  timetable: { source: 'saved-device-copy', updatedAt: '2026-11-05T15:12:00Z', courses: [], classGaps: [
    gap('14:00', '15:00'), gap('09:10', '10:30'), gap('08:30', '09:00'), gap('09:05', '10:50', '2026-11-07'),
  ] },
};

describe('saved class gap answer', () => {
  test('never answers from a missing snapshot or an unrecognized timetable source', () => {
    const invalidTimetables: unknown[] = [
      null, undefined, [], 'invalid',
      { ...context.timetable, source: 'unknown' },
      { ...context.timetable, source: null },
      { ...context.timetable, source: undefined },
    ];
    for (const timetable of invalidTimetables) {
      const result = answerSavedClassGapQuery(today, {
        ...context, timetable: timetable as OnDeviceSchoolContext['timetable'],
      });
      expect(result.route).toBe('/timetable');
      expect(result.content).toMatch(/資料不足|來源無法核對/);
      expect(result.content).not.toContain('有 2 段');
      expect(result.content).not.toContain('沒有課間空堂');
    }
    for (const invalidContext of [null, undefined]) {
      const result = answerSavedClassGapQuery(today, invalidContext as unknown as OnDeviceSchoolContext);
      expect(result.route).toBe('/timetable');
      expect(result.content).toContain('資料不足');
    }
    expect(answerSavedClassGapQuery(today, context).content).toContain('有 2 段');
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, source: 'unreadable' },
    }).content).toContain('讀不到');
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, source: 'not-available' },
    }).content).toContain('還沒有');
  });

  test('lists upcoming available minutes in local time, in chronological order, with provenance', () => {
    const reply = answerSavedClassGapQuery(today, context);
    expect(reply).toMatchObject({ tool: 'saved-timetable', route: '/timetable' });
    expect(reply.content).toContain('有 2 段');
    expect(reply.content).toMatch(/10:01–10:30（29 分鐘）\n14:00–15:00（60 分鐘）/);
    expect(reply.content).toContain('2026/11/5');
    expect(reply.content).not.toContain('09:05');
  });

  test('does not round a nearly sufficient gap up to the threshold', () => {
    const { content } = answerSavedClassGapQuery({ ...today, minMinutes: 30 }, context);
    expect(content).toContain('14:00–15:00');
    expect(content).not.toContain('10:30');
  });

  test('clips gaps to the requested clock window before measuring, including its exact boundaries', () => {
    const timetable = { ...context.timetable, classGaps: [gap('11:30', '12:30'), gap('17:45', '19:00')] };
    const afternoon = { ...today, part: 'afternoon' as const };
    const answer = (minMinutes: number) => answerSavedClassGapQuery({ ...afternoon, minMinutes }, { ...context, timetable }).content;
    expect(answer(15)).toContain('下午（12:00–18:00）');
    expect(answer(15)).toContain('12:00–12:30（30 分鐘）');
    expect(answer(15)).toContain('17:45–18:00（15 分鐘）');
    expect(answer(45)).toContain('沒有至少 45 分鐘');
  });

  test('selects the next Taiwan date after midnight UTC conversion', () => {
    const { content } = answerSavedClassGapQuery(tomorrow, { ...context, checkedAt: '2026-11-05T16:01:00Z' });
    expect(content).toContain('明天（11/07）');
    expect(content).toContain('09:05–10:50（105 分鐘）');
    expect(content).not.toContain('14:00');
  });

  test('checks the day after tomorrow and displays the complete clock and duration filters', () => {
    const query: SavedClassGapQuery = { day: 'day-after-tomorrow', fromMinute: 930, untilMinute: 1020, minMinutes: 45 };
    const timetable = { ...context.timetable, classGaps: [
      gap('13:00', '16:00', '2026-11-08'), gap('16:15', '18:00', '2026-11-08'),
      gap('15:00', '17:00', '2026-11-07'),
    ] };
    const answer = answerSavedClassGapQuery(query, { ...context, timetable }).content;
    expect(answer).toContain('後天（11/08） 15:30–17:00');
    expect(answer).toContain('有 1 段至少 45 分鐘');
    expect(answer).toContain('16:15–17:00（45 分鐘）');
    expect(answer).not.toContain('15:30–16:00');
    expect(answer).toContain('私人行程、通勤');
  });

  test('applies each clock bound before checking the minimum, and renders midnight as 24:00', () => {
    const timetable = { ...context.timetable, classGaps: [gap('14:00', '17:00'), gap('23:00', '24:00')] };
    const answer = (query: Partial<SavedClassGapQuery>) => answerSavedClassGapQuery({ ...today, ...query }, { ...context, timetable }).content;
    expect(answer({ fromMinute: 930, minMinutes: 91 })).not.toContain('15:30–17:00');
    expect(answer({ fromMinute: 930, minMinutes: 90 })).toContain('15:30–17:00（90 分鐘）');
    expect(answer({ untilMinute: 900, minMinutes: 60 })).toContain('14:00–15:00（60 分鐘）');
    expect(answer({ untilMinute: 1440 })).toContain('24:00 之前');
    expect(answer({ untilMinute: 1440 })).toContain('23:00–24:00（60 分鐘）');
    const clipped = answer({ part: 'afternoon', fromMinute: 930, untilMinute: 1140 });
    expect(clipped).toContain('下午（12:00–18:00） 15:30–18:00');
    expect(clipped).toContain('15:30–17:00（90 分鐘）');
    expect(clipped).not.toContain('15:30–19:00');
    expect(answer({ part: 'afternoon', untilMinute: 1140 })).toContain('18:00 之前');
    expect(answer({ part: 'afternoon', fromMinute: 600 })).toContain('12:00 之後');
  });

  test('does not mistake a corrupt saved gap for evidence that no class gaps exist', () => {
    const badIntervals = [
      { startAt: Number.NaN, endAt: instant('14:00') },
      { startAt: instant('15:00'), endAt: instant('14:00') },
      { startAt: Number.POSITIVE_INFINITY, endAt: Number.POSITIVE_INFINITY },
      { startAt: instant('14:00') + 0.5, endAt: instant('15:00') },
    ];
    for (const bad of badIntervals) {
      const answer = answerSavedClassGapQuery(today, {
        ...context, timetable: { ...context.timetable, classGaps: [bad] },
      }).content;
      expect(answer).toContain('資料不足');
      expect(answer).not.toContain('沒有課間空堂');
    }
    // Empty data from an otherwise usable timetable is distinct from a corrupt interval.
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, classGaps: [] },
    }).content).toContain('沒有課間空堂');
  });

  test('rejects calendar rollover in zoned collection and save timestamps', () => {
    // Date.parse accepts nonexistent days such as February 30 and 24:00 by
    // shifting them into the next day. Neither can prove a timetable's date.
    for (const checkedAt of [
      '2026-02-30T10:00:01Z',
      '2026-11-31T10:00:01+08:00',
      '2026-11-06T24:00:00+08:00',
    ]) {
      const answer = answerSavedClassGapQuery(today, { ...context, checkedAt }).content;
      expect(answer).toContain('資料不足');
      expect(answer).not.toContain('沒有課間空堂');
      expect(answer).not.toContain('有 2 段');
    }
    for (const updatedAt of [
      '2026-02-30T00:00:00Z',
      '2026-11-05T24:00:00+08:00',
    ]) {
      const answer = answerSavedClassGapQuery(today, {
        ...context, timetable: { ...context.timetable, updatedAt },
      }).content;
      expect(answer).toContain('無法核對空堂');
      expect(answer).not.toContain('有 2 段');
    }
    // Real leap days and a zoned timestamp still work.
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, updatedAt: '2024-02-29T10:00:01Z' },
    }).content).toContain('有 2 段');
    expect(answerSavedClassGapQuery(today, {
      ...context, checkedAt: '2026-11-06T02:00:01Z',
    }).content).toContain('有 2 段');
  });

  test('does not treat an ambiguous or malformed collection clock as evidence of free time', () => {
    // A restored snapshot must not change calendar day when the OS timezone changes.
    const ambiguousOrInvalid: unknown[] = [
      '2026-11-06T10:00:01', '2026-11-06 10:00:01',
      'Fri, 06 Nov 2026 02:00:01 GMT', 'not-a-date', 12345,
    ];
    for (const checkedAt of ambiguousOrInvalid) {
      const answer = answerSavedClassGapQuery(today, {
        ...context, checkedAt: checkedAt as string,
      });
      expect(answer.route).toBe('/timetable');
      expect(answer.content).toContain('資料不足');
      expect(answer.content).not.toContain('有 2 段');
      expect(answer.content).not.toContain('沒有課間空堂');
    }
    // ISO instants with explicit offsets remain equivalent across devices.
    expect(answerSavedClassGapQuery(today, {
      ...context, checkedAt: '2026-11-06T02:00:01Z',
    }).content).toContain('有 2 段');
    expect(answerSavedClassGapQuery(today, context).content).toContain('有 2 段');
  });

  test('rejects invalid or future-dated save provenance without inventing free time', () => {
    const invalidSavedAt: unknown[] = [
      '', 'unparseable', '2099-01-01T00:00:00+08:00', 12345,
      // Without a timezone, the same snapshot can mean different instants on iOS and Android.
      '2026-11-05T15:12:00', '2026-11-05 15:12:00', 'Thu, 05 Nov 2026 15:12:00 GMT',
    ];
    for (const updatedAt of invalidSavedAt) {
      const answer = answerSavedClassGapQuery(today, {
        ...context,
        timetable: { ...context.timetable, updatedAt: updatedAt as string },
      });
      expect(answer.route).toBe('/timetable');
      expect(answer.content).toContain('無法核對空堂');
      expect(answer.content).not.toContain('有 2 段');
      expect(answer.content).not.toContain('沒有課間空堂');
    }
    // Explicit UTC or offset timestamps are portable evidence, not device-local guesses.
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, updatedAt: '2026-11-05T23:12:00+08:00' },
    }).content).toContain('有 2 段');
    // Five minutes of clock skew does not invalidate a recently saved snapshot.
    const nearFuture = answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, updatedAt: '2026-11-06T10:04:00+08:00' },
    });
    expect(nearFuture.content).toContain('有 2 段');
    // Null remains a known limitation, not a forged timestamp.
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, updatedAt: null },
    }).content).toContain('儲存時間不詳');
  });

  test('malformed saved gap containers and entries fail closed instead of crashing or claiming no free time', () => {
    const malformed: unknown[] = [
      null, undefined, 12, 'invalid', [], {},
      { startAt: instant('09:00') }, { startAt: '09:00', endAt: instant('10:00') },
    ];
    for (const entry of malformed) {
      const result = answerSavedClassGapQuery(today, {
        ...context,
        timetable: {
          ...context.timetable,
          classGaps: [entry] as unknown as NonNullable<OnDeviceSchoolContext['timetable']['classGaps']>,
        },
      });
      expect(result.route).toBe('/timetable');
      expect(result.content).toContain('資料不足');
      expect(result.content).not.toContain('沒有課間空堂');
    }
    const invalidContainer = answerSavedClassGapQuery(today, {
      ...context,
      timetable: { ...context.timetable, classGaps: {} as never },
    });
    expect(invalidContainer.content).toContain('資料不足');
    expect(invalidContainer.content).not.toContain('沒有課間空堂');
  });

  test('rejects duplicate and overlapping free intervals without treating another day as an overlap', () => {
    const invalid = [
      [gap('14:00', '15:00'), gap('14:30', '16:00')],
      [gap('14:00', '15:00'), gap('14:00', '15:00')],
      [gap('14:00', '15:00'), gap('13:30', '14:01')],
    ];
    for (const classGaps of invalid) {
      const answer = answerSavedClassGapQuery(today, {
        ...context, timetable: { ...context.timetable, classGaps },
      });
      expect(answer.route).toBe('/timetable');
      expect(answer.content).toContain('無法核對');
      expect(answer.content).not.toContain('有 2 段');
      expect(answer.content).not.toContain('沒有課間空堂');
    }
    const unrelatedDay = answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, classGaps: [
        gap('14:00', '15:00'), gap('14:30', '16:00', '2026-11-07'),
      ] },
    }).content;
    expect(unrelatedDay).toContain('有 1 段');
    expect(unrelatedDay).toContain('14:00–15:00（60 分鐘）');
  });

  test('does not confuse another day\'s restored gaps with a verified empty date', () => {
    // A stale cache saved for tomorrow must not answer "today has no gaps".
    const wrongDay = answerSavedClassGapQuery(today, {
      ...context, timetable: {
        ...context.timetable, classGaps: [gap('14:00', '15:00', '2026-11-07')],
      },
    });
    expect(wrongDay.route).toBe('/timetable');
    expect(wrongDay.content).toContain('無法核對');
    expect(wrongDay.content).toContain('查詢日期');
    expect(wrongDay.content).not.toContain('沒有課間空堂');
    expect(wrongDay.content).not.toContain('有 1 段');

    // The identical saved interval is valid when the student asks for tomorrow.
    expect(answerSavedClassGapQuery(tomorrow, {
      ...context, timetable: {
        ...context.timetable, classGaps: [gap('14:00', '15:00', '2026-11-07')],
      },
    }).content).toContain('14:00–15:00（60 分鐘）');

    // The source calculation can legitimately return an empty set.
    expect(answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, classGaps: [] },
    }).content).toContain('沒有課間空堂');
  });

  test('combines touching free intervals before enforcing the minimum without bridging a real class', () => {
    const timetable = { ...context.timetable, classGaps: [
      gap('15:00', '16:00'), gap('14:00', '15:00'), gap('16:10', '17:10'),
    ] };
    const answer = (query: Partial<SavedClassGapQuery>) =>
      answerSavedClassGapQuery({ ...today, ...query }, { ...context, timetable }).content;
    const ninetyMinutes = answer({ minMinutes: 90 });
    expect(ninetyMinutes).toContain('有 1 段至少 90 分鐘');
    expect(ninetyMinutes).toContain('14:00–16:00（120 分鐘）');
    expect(ninetyMinutes).not.toContain('16:10–17:10');
    expect(answer({ fromMinute: 870, minMinutes: 90 })).toContain('14:30–16:00（90 分鐘）');
    expect(answer({ minMinutes: 121 })).toContain('沒有至少 121 分鐘');
  });

  test('rejects shorter cross-midnight gaps instead of clipping them into false free time', () => {
    // These intervals are shorter than a day, but savedClassGaps only returns
    // periods between classes within the requested Taiwan calendar date.
    const crossing = [
      { startAt: instant('23:45', '2026-11-05'), endAt: instant('00:30') },
      { startAt: instant('23:00'), endAt: instant('00:20', '2026-11-07') },
    ];
    for (const bad of crossing) {
      const result = answerSavedClassGapQuery(today, {
        ...context, checkedAt: '2026-11-06T00:05:01+08:00',
        timetable: { ...context.timetable, classGaps: [bad] },
      });
      expect(result.route).toBe('/timetable');
      expect(result.content).toContain('跨越查詢日期');
      expect(result.content).toContain('無法核對');
      expect(result.content).not.toContain('有 1 段');
      expect(result.content).not.toContain('沒有課間空堂');
    }
    // Midnight exactly at the endpoint is not a crossing, and unrelated
    // next-day openings must not contaminate today's result.
    const correct = answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, classGaps: [
        { startAt: instant('23:00'), endAt: instant('00:00', '2026-11-07') },
        gap('01:00', '02:00', '2026-11-07'),
      ] },
    }).content;
    expect(correct).toContain('23:00–24:00（60 分鐘）');
    expect(correct).not.toContain('01:00–02:00');
  });

  test('rejects fabricated day-long gaps instead of turning them into an all-day free period', () => {
    // Two classes on the requested day cannot create a whole-day or multi-day class gap.
    // Corrupt persisted data must not become a plausible 10:01–24:00 opening when clipped.
    const impossible = [
      { startAt: instant('08:00'), endAt: instant('08:00', '2026-11-07') },
      { startAt: instant('09:00', '2026-11-05'), endAt: instant('15:00', '2026-11-07') },
    ];
    for (const bad of impossible) {
      const answer = answerSavedClassGapQuery(today, {
        ...context, timetable: { ...context.timetable, classGaps: [bad] },
      });
      expect(answer.route).toBe('/timetable');
      expect(answer.content).toContain('資料不足');
      expect(answer.content).not.toContain('沒有課間空堂');
      expect(answer.content).not.toContain('有 1 段');
      expect(answer.content).not.toContain('24:00');
    }
    const valid = answerSavedClassGapQuery(today, {
      ...context, timetable: { ...context.timetable, classGaps: [gap('14:00', '15:00')] },
    });
    expect(valid.content).toContain('14:00–15:00（60 分鐘）');
  });

  test('rejects corrupted restored clock filters without crashing or inventing free time', () => {
    const malformed = [
      { ...today, day: 'yesterday' },
      { ...today, part: '__proto__' },
      { ...today, minMinutes: Number.NaN },
      { ...today, minMinutes: -30 },
      { ...today, minMinutes: 1441 },
      { ...today, fromMinute: Number.NaN },
      { ...today, fromMinute: -1 },
      { ...today, fromMinute: 1440 },
      { ...today, untilMinute: Number.POSITIVE_INFINITY },
      { ...today, untilMinute: 0 },
      { ...today, untilMinute: 1441 },
      { ...today, fromMinute: 960, untilMinute: 930 },
      { ...today, part: 'afternoon', fromMinute: 1140 },
    ];
    for (const restored of malformed) {
      const result = answerSavedClassGapQuery(restored as SavedClassGapQuery, context);
      expect(result.route).toBe('/timetable');
      expect(result.content).toContain('查詢條件');
      expect(result.content).not.toContain('沒有課間空堂');
      expect(result.content).not.toContain('有 2 段');
    }
    // Valid parser output and exact-day bounds remain usable.
    expect(answerSavedClassGapQuery(today, context).content).toContain('有 2 段');
    expect(answerSavedClassGapQuery({ ...today, fromMinute: 0, untilMinute: 1440 }, context).content)
      .toContain('14:00–15:00（60 分鐘）');
  });

  test('distinguishes a known empty result from missing, unreadable or incomplete evidence', () => {
    const answer = (timetable: Partial<OnDeviceSchoolContext['timetable']>, checkedAt = context.checkedAt) =>
      answerSavedClassGapQuery(today, { ...context, checkedAt, timetable: { ...context.timetable, ...timetable } }).content;
    expect(answer({ classGaps: [] })).toContain('沒有課間空堂');
    expect(answer({ classGaps: [], updatedAt: null })).toContain('儲存時間不詳');
    expect(answer({ source: 'not-available' })).toContain('匯入');
    expect(answer({ source: 'unreadable' })).toContain('重新讀取');
    expect(answer({ classGaps: undefined })).toContain('資料不足');
    expect(answer({}, 'invalid')).toContain('資料不足');
  });
});
