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
