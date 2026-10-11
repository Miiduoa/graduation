'use strict';

const { getLastUserMessage, normalizeAssistantText } = require('./assistantFormat');

test('normalizes the last user message without leaking its object representation', () => {
  const messages = [
    { role: 'user', content: '舊問題' },
    { role: 'assistant', content: '回覆' },
    { role: 'user', content: '  查公告\n保留第二行  ' },
  ];
  expect(normalizeAssistantText(getLastUserMessage(messages))).toBe('查公告\n保留第二行');
  expect(normalizeAssistantText(messages[2].content)).toBe('查公告\n保留第二行');
});

test.each([null, undefined, {}, { content: { nested: 'text' } }, 123])('invalid message text %p stays empty', (value) => {
  expect(normalizeAssistantText(value)).toBe('');
});

describe('formatAssistantDate 一律用台灣時間', () => {
  const { formatAssistantDate, isScheduleQuestionMessage, mentionsOwnRepairTicket } = require('./assistantFormat');

  test('跨日：UTC 前一天 18:35 是台灣隔天 02:35', () => {
    expect(formatAssistantDate(new Date('2026-10-12T18:35:00Z'))).toBe('10 月 13 日 02:35');
  });

  test('跨年：UTC 12/31 16:00 是台灣 1 月 1 日 00:00', () => {
    expect(formatAssistantDate(new Date('2026-12-31T16:00:00Z'))).toBe('1 月 1 日 00:00');
  });

  test('同一天：只加 8 小時', () => {
    expect(formatAssistantDate(new Date('2026-10-13T01:05:00Z'))).toBe('10 月 13 日 09:05');
  });

  test.each([
    ['Firestore Timestamp', { toDate: () => new Date('2026-10-12T18:35:00Z') }],
    ['seconds', { seconds: Date.parse('2026-10-12T18:35:00Z') / 1000, nanoseconds: 0 }],
    ['_seconds', { _seconds: Date.parse('2026-10-12T18:35:00Z') / 1000 }],
    ['ISO 字串', '2026-10-12T18:35:00.000Z'],
    ['毫秒', Date.parse('2026-10-12T18:35:00Z')],
  ])('%s 也換成台灣時間', (_label, value) => {
    expect(formatAssistantDate(value)).toBe('10 月 13 日 02:35');
  });

  test('不再出現美式格式或年份', () => {
    const text = formatAssistantDate(new Date('2026-10-12T18:35:00Z'));
    expect(text).not.toMatch(/\d+\/\d+\/\d{4}/);
    expect(text).not.toContain('2026');
  });

  test.each([null, undefined, '', 'not a date', {}])('沒有時間 %p 回空字串', (value) => {
    expect(formatAssistantDate(value)).toBe('');
  });

  test.each(['宿舍網路什麼時候維修', '停水是哪天', '電梯維修幾點結束', '維修是幾號', '何時恢復'])('「%s」是在問時間', (text) => {
    expect(isScheduleQuestionMessage(text)).toBe(true);
  });

  test.each(['宿舍冷氣壞了', '幫我報修', '圖書館在哪'])('「%s」不是在問時間', (text) => {
    expect(isScheduleQuestionMessage(text)).toBe(false);
  });

  test('講到自己的報修單才算查進度', () => {
    expect(mentionsOwnRepairTicket('我的報修什麼時候會好')).toBe(true);
    expect(mentionsOwnRepairTicket('宿舍網路什麼時候維修')).toBe(false);
  });
});
