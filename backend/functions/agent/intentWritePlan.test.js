'use strict';

const { getIntentWritePlan } = require('./intentWritePlan');

describe('intentWritePlan', () => {
  test('leave_request maps to submitLeaveRequest with confirmation', () => {
    const plan = getIntentWritePlan('leave_request');
    expect(plan).toEqual({
      toolName: 'submitLeaveRequest',
      requiresConfirmation: true,
    });
  });

  test('unknown intent returns null', () => {
    expect(getIntentWritePlan('menus')).toBeNull();
    expect(getIntentWritePlan('')).toBeNull();
  });

  test('write intents map to tools', () => {
    expect(getIntentWritePlan('reserve_seat')).toMatchObject({ toolName: 'reserveSeat', requiresConfirmation: true });
    expect(getIntentWritePlan('borrow_book')).toMatchObject({ toolName: 'borrowBook', requiresConfirmation: true });
    expect(getIntentWritePlan('renew_book')).toMatchObject({ toolName: 'renewBook', requiresConfirmation: true });
    expect(getIntentWritePlan('return_book')).toMatchObject({ toolName: 'returnBook', requiresConfirmation: true });
    expect(getIntentWritePlan('submit_repair_request')).toMatchObject({
      toolName: 'createDormRepairRequest',
      requiresConfirmation: true,
    });
    expect(getIntentWritePlan('wash_reserve')).toMatchObject({
      toolName: 'reserveWashingMachine',
      requiresConfirmation: true,
    });
    expect(getIntentWritePlan('food_order')).toMatchObject({ toolName: 'createOrder', requiresConfirmation: true });
  });
});
