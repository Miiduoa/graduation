"use strict";
const { classifyIntent } = require('./classifyIntent');
const { getIntentWritePlan } = require('./intentWritePlan');
const { resolvePermissionScope } = require('../assistantAgent');

test.each(['取消今晚洗衣預約', '幫我取消 A2 洗衣機預約', '取消洗衣預約 編號 reservation-1'])(
  'cancellation cannot become a new reservation: %s', (message) => {
    expect(classifyIntent(message).name).toBe('wash_cancel');
  });
test.each(['查我的洗衣預約', '洗衣預約 編號 reservation-1 取消成功了嗎？'])(
  'reads the actual reservation status: %s', (message) => {
    expect(classifyIntent(message).name).toBe('wash_status');
  });
test('requires a separate confirmation and private scope', () => {
  expect(getIntentWritePlan('wash_cancel')).toEqual({ toolName: 'cancelWashingReservation', requiresConfirmation: true });
  expect(getIntentWritePlan('wash_status')).toBeNull();
  expect(resolvePermissionScope('wash_cancel', true)).toBe('user_private');
  expect(resolvePermissionScope('wash_status', true)).toBe('user_private');
});
test('keeps the normal new reservation intent', () => {
  expect(classifyIntent('幫我預約今晚的洗衣機').name).toBe('wash_reserve');
});

const { confirmedAgentWrite } = require('./actionReceipt');
test('accepts only an exact cancellation receipt for the confirmed account and source', () => {
  const input = { reservationId: 'r-1', machineId: 'A2', dormitory: '信德', startTime: '2026-11-17T20:00:00+08:00', reservedUntil: null };
  const result = { ...input, success: true, status: 'cancelled', userId: 'alice', schoolId: 'pu' };
  const scope = { uid: 'alice', schoolId: 'pu' };
  expect(confirmedAgentWrite('cancelWashingReservation', result, input, scope)).toBe(true);
  for (const [key, value] of [['reservationId','r-other'], ['machineId','A1'], ['status','reserved'], ['userId','bob'], ['schoolId','other'], ['startTime','19:00'], ['dormitory','other']]) {
    expect(confirmedAgentWrite('cancelWashingReservation', { ...result, [key]: value }, input, scope)).toBe(false);
  }
  expect(confirmedAgentWrite('cancelWashingReservation', { success: true }, input, scope)).toBe(false);
});
