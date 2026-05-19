'use strict';

const {
  resolveRepairInput,
  messageLooksLikeDormRepairActionMessage,
} = require('./campusWriteIntentResolve');

describe('messageLooksLikeDormRepairActionMessage', () => {
  test('matches explicit 報修', () => {
    expect(messageLooksLikeDormRepairActionMessage('幫我宿舍冷氣報修')).toBe(true);
  });

  test('matches 冷氣怪怪的 without 報修 keyword', () => {
    expect(messageLooksLikeDormRepairActionMessage('A棟301冷氣怪怪的')).toBe(true);
  });

  test('matches 房間好熱 with facility', () => {
    expect(messageLooksLikeDormRepairActionMessage('房間好熱 冷氣好像沒風')).toBe(true);
  });

  test('does not match unrelated health text', () => {
    expect(messageLooksLikeDormRepairActionMessage('我頭好痛想休息')).toBe(false);
  });
});

describe('resolveRepairInput', () => {
  test('parses 不冷 without 報修 keyword', () => {
    const r = resolveRepairInput('A棟 302 冷氣不冷');
    expect(r).not.toBeNull();
    expect(r.category).toBe('hvac');
    expect(r.room).toBe('302');
  });

  test('parses 怪怪的 + 冷氣', () => {
    const r = resolveRepairInput('宿舍冷氣怪怪的 聲音很大');
    expect(r).not.toBeNull();
    expect(r.category).toBe('hvac');
  });
});
