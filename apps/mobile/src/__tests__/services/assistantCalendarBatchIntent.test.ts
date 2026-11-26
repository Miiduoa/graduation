import { parseAssistantCalendarBatchIntent } from '../../services/assistantCalendarBatchIntent';
import { parseAssistantCalendarIntent } from '../../services/assistantCalendarIntent';

const now = Date.parse('2026-12-31T16:10:00Z'); // 2027/01/01 00:10 in Taiwan.
const first = '明天 19:00 到 20:00 英文讀書';
const second = '明天 20:00 至 21:00 程式練習';
const batch = (rows: string[], header = '幫我安排以下行程：', separator = '\n') => header + '\n' + rows.join(separator);
const invalidResult = {
  kind: 'invalid',
  message: '請用「幫我安排以下行程：」開頭，列出 2–4 筆各有日期、起訖時間與名稱的行程，並用換行或分號分隔；時段不可重複或重疊，提醒、提交與付款請分開提出。',
};

test('returns a complete ordered preview with adjacent periods and a single Taiwan reference time', () => {
  expect(parseAssistantCalendarBatchIntent(batch([first, second]), now)).toEqual({ kind: 'draft', events: [
    { title: '英文讀書', date: '2027-01-02', allDay: false, startTime: '19:00', endTime: '20:00' },
    { title: '程式練習', date: '2027-01-02', allDay: false, startTime: '20:00', endTime: '21:00' },
  ] });
});

test.each([
  ['請幫我安排以下行程:', ';'],
  ['麻煩你替我新增下列個人行程：', '；'],
  ['我想建立以下行程：', '\r\n'],
  ['安排以下行程：', '；\n'],
])('accepts an explicit header %s and its complete row separator', (header, separator) => {
  const result = parseAssistantCalendarBatchIntent(batch([first, second], header, separator), now);
  expect(result?.kind).toBe('draft');
  if (result?.kind !== 'draft') throw new Error('missing batch');
  expect(result.events.map((event) => event.title)).toEqual(['英文讀書', '程式練習']);
});

test('accepts full-width clock punctuation and ordinary sentence endings without changing the requested duration', () => {
  const result = parseAssistantCalendarBatchIntent('幫我安排以下行程：\n' +
    '２０２７／１／２ ０９：１５～１０：００ 英文讀書。；\r\n' +
    '2027-1-3 10:00—11:30 SQL 練習！；', now);
  expect(result).toEqual({ kind: 'draft', events: [
    { title: '英文讀書', date: '2027-01-02', allDay: false, startTime: '09:15', endTime: '10:00' },
    { title: 'SQL 練習', date: '2027-01-03', allDay: false, startTime: '10:00', endTime: '11:30' },
  ] });
});

test('reuses complete single commands, preserves input order and permits the same activity on different days', () => {
  const commands = [
    '請幫我安排後天 9:00-10:00 英文讀書',
    '今天 19:00～20:00 加入我的行事曆英文讀書',
    '新增個人行程 2027/1/4 09:00 至 10:00 的資料庫複習。',
    '2027/1/5 11:00 到 11:45 安排演算法練習',
  ];
  const result = parseAssistantCalendarBatchIntent(batch(commands), now);
  expect(result?.kind).toBe('draft');
  if (result?.kind !== 'draft') throw new Error('missing batch');
  expect(result.events).toEqual(commands.map((command) => {
    const parsed = parseAssistantCalendarIntent(command, now);
    if (parsed?.kind !== 'draft') throw new Error('invalid single fixture');
    return parsed.event;
  }));
  expect(result.events.map((event) => event.date)).toEqual(['2027-01-03', '2027-01-01', '2027-01-04', '2027-01-05']);
});

test('captures the default clock once for every relative date in the batch', () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValue(now + 86_400_000);
  try {
    const result = parseAssistantCalendarBatchIntent(batch([first, second]));
    expect(clock).toHaveBeenCalledTimes(1);
    expect(result?.kind).toBe('draft');
    if (result?.kind !== 'draft') throw new Error('missing batch');
    expect(result.events.map((event) => event.date)).toEqual(['2027-01-02', '2027-01-02']);
  } finally { clock.mockRestore(); }
});

test.each([
  undefined, null, 42, {}, ['明天讀書'],
  '幫我明天 19:00 到 20:00 安排英文讀書',
  '明天 19:00 到 20:00 英文讀書；後天 19:00 到 20:00 程式練習',
  '依課表安排未來七天讀書計畫',
  '請幫我把待交作業安排在空堂',
  '不要幫我安排以下行程：\n' + first + '\n' + second,
  '昨天已經幫我安排以下行程：\n' + first + '\n' + second,
  '請翻譯「幫我安排以下行程：」',
  '「幫我安排以下行程：\n' + first + '\n' + second + '」是什麼意思？',
  '以下是讀書建議：\n' + first + '\n' + second,
  '今日優先行動\n1. 英文讀書：截止 1/2 21:00，請到課程頁核對。',
])('leaves ordinary single requests, quoted text and planner prose to their existing handler: %p', (question) => {
  expect(parseAssistantCalendarBatchIntent(question, now)).toBeNull();
});

test.each([
  '幫我安排以下行程',
  '幫我安排以下行程，\n' + first + '\n' + second,
  '幫我安排以下行程：',
  batch([first]),
  batch([first, '']),
  batch([first, '', second]),
  batch([first, second], '幫我安排以下行程：', ';;'),
  batch([first, second, '後天 09:00-10:00 英文', '後天 10:00-11:00 程式', '後天 11:00-12:00 資料庫']),
  batch([first, '明天 21:00 英文讀書']),
  batch([first, '明天安排程式練習']),
  batch([first, '20:00 到 21:00 程式練習']),
  batch([first, '明天晚上 程式練習']),
  batch([first, '明天 21:00 到 22:00']),
  batch([first, '明天全天安排英文讀書']),
  batch([first, '大概明天 21:00 到 22:00 程式練習']),
  batch([first, '建議你在明天 21:00 到 22:00 程式練習']),
  batch([first, '1. 明天 21:00 到 22:00 程式練習']),
])('rejects the whole batch when its format, count or any explicit field is incomplete: %s', (question) => {
  expect(parseAssistantCalendarBatchIntent(question, now)).toEqual(invalidResult);
});

test.each([
  '2027-02-29 19:00 到 20:00 英文',
  '2027-02-30 19:00 到 20:00 英文',
  '2027-13-01 19:00 到 20:00 英文',
  '明天 24:00 到 25:00 英文',
  '明天 19:60 到 20:30 英文',
  '明天 21:00 到 20:00 英文',
  '明天 21:00 到 21:00 英文',
  '明天 23:30 到 00:30 英文',
  '今天 00:01 到 01:00 英文',
  '2026-12-31 19:00 到 20:00 英文',
])('returns no partial preview for an impossible, elapsed or ambiguous range: %s', (row) => {
  expect(parseAssistantCalendarBatchIntent(batch([first, row]), now)).toEqual(invalidResult);
});

test.each([
  first,
  '2027/1/2 19:00-20:00 英文讀書',
  '明天 19:00 到 20:00 不同名稱',
  '明天 19:30 到 20:30 程式練習',
  '明天 18:30 到 19:30 程式練習',
  '明天 18:00 到 21:00 程式練習',
  '明天 19:15 到 19:45 程式練習',
])('rejects semantic duplicates and every overlapping interval: %s', (row) => {
  expect(parseAssistantCalendarBatchIntent(batch([first, row]), now)).toEqual(invalidResult);
});

test('checks non-adjacent input rows for overlaps rather than only neighboring items', () => {
  expect(parseAssistantCalendarBatchIntent(batch([
    first, '後天 09:00 到 10:00 程式練習', '明天 19:30 到 20:30 資料庫',
  ]), now)).toEqual(invalidResult);
});

test.each([
  '順便提醒我', '然後提交作業', '並且付款', '同時下單', '發送通知', '上傳作業', '寄信給老師',
  '支付費用', '轉帳給同學', '取消另一筆行程', '不要安排了', 'and then submit homework', 'notify me', 'pay tuition',
  'https://evil.example/calendar', 'ＨＴＴＰＳ：／／evil.example', 'www.example.com', '//evil.example/path',
  'javascript:alert(1)', 'mailto:someone@example.com', 'nuni.tw/calendar',
  '「提醒我」', '“請提交”', '`submit()`',
])('never turns a compound operation or URL into an appointment title: %s', (suffix) => {
  const row = `明天 21:00 到 22:00 程式練習 ${suffix}`;
  expect(parseAssistantCalendarBatchIntent(batch([first, row]), now)).toEqual(invalidResult);
});

test.each(['\u0000', '\t', '\r', '\u000b', '\u001b', '\u0085', '\u200b', '\u200e', '\u2028', '\u2029', '\ufeff'])(
  'rejects a control or invisible separator anywhere in an apparent batch: %p', (character) => {
  expect(parseAssistantCalendarBatchIntent(batch([first, second + character]), now)).toEqual(invalidResult);
  expect(parseAssistantCalendarBatchIntent(character + batch([first, second]), now)).toEqual(invalidResult);
  });

test('line breaks are accepted only between complete rows, never inside a date, time or title', () => {
  for (const row of ['明天\n21:00 到 22:00 英文', '明天 21:\n00 到 22:00 英文', '明天 21:00 到 22:00 英\n文']) {
    expect(parseAssistantCalendarBatchIntent(batch([first, row]), now)).toEqual(invalidResult);
  }
  expect(parseAssistantCalendarBatchIntent('幫我\n安排以下行程：\n' + first + '\n' + second, now)).toEqual(invalidResult);
});

test('uses the same fixed error for nonfinite time, oversized input and an oversized individual row', () => {
  for (const timestamp of [NaN, Infinity, -Infinity]) {
    expect(parseAssistantCalendarBatchIntent(batch([first, second]), timestamp)).toEqual(invalidResult);
  }
  expect(parseAssistantCalendarBatchIntent(batch([first, '明天 21:00-22:00 ' + '課'.repeat(101)]), now)).toEqual(invalidResult);
  expect(parseAssistantCalendarBatchIntent(batch([first, second]) + ' '.repeat(1200), now)).toEqual(invalidResult);
});

test('does not coerce an unknown input object or evaluate getters', () => {
  const coerce = jest.fn(() => batch([first, second]));
  expect(parseAssistantCalendarBatchIntent({ toString: coerce, get text() { return coerce(); } }, now)).toBeNull();
  expect(coerce).not.toHaveBeenCalled();
});
