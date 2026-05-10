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
});
