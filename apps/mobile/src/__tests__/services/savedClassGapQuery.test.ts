import { answerSavedClassGapQuery, savedClassGapFollowUp, savedClassGapQuery } from '../../services/savedClassGapQuery';
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
  ])('parses %s', (question, expected) => expect(savedClassGapQuery(String(question))).toEqual(expected));

  test.each([
    '後天有空堂嗎？', '星期二有空堂嗎', '今天和明天有空堂嗎', '今天幫我在空堂安排讀書',
    '今天有哪些空堂和待交作業？', '今天有空嗎？', '今天有空堂嗎，我要訂便當', '現在要去空堂教室開會',
    '今天有超過一小時的空檔嗎', '今天半小時後有空檔嗎', '今天沒有課嗎', '今天有 0 分鐘空檔嗎', '今天有#嗎',
  ])('leaves unsupported or mixed request %s alone', (question) => expect(savedClassGapQuery(question)).toBeNull());

  test('refines only an explicit date or minimum within the previous class-gap request', () => {
    expect(savedClassGapFollowUp('那明天呢？', { ...today, minMinutes: 30 })).toEqual(tomorrow);
    expect(savedClassGapFollowUp('那至少一小時呢？', tomorrow)).toEqual({ ...tomorrow, minMinutes: 60 });
    expect(savedClassGapFollowUp('那今天 45 分鐘以上呢', tomorrow)).toEqual({ ...today, minMinutes: 45 });
    const morning = { ...tomorrow, part: 'morning' as const };
    expect(savedClassGapFollowUp('那今天呢', morning)).toEqual({ ...morning, day: 'today' });
    expect(savedClassGapFollowUp('那四十五分鐘呢', morning)).toEqual({ ...morning, minMinutes: 45 });
    expect(savedClassGapFollowUp('下午呢', morning)).toEqual({ ...morning, part: 'afternoon' });
    for (const question of ['那後天呢', '那明天的作業呢', '那幫我安排半小時', '明天半小時以內呢', '幾點呢', '那呢']) {
      expect(savedClassGapFollowUp(question, tomorrow)).toBeNull();
    }
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
