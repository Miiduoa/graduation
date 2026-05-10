'use strict';

const { toolRequiresConfirmation, byName } = require('./registry');

describe('tools registry', () => {
  test('toolRequiresConfirmation for submitLeaveRequest', () => {
    expect(toolRequiresConfirmation('submitLeaveRequest')).toBe(true);
  });

  test('read tools have no confirmation flag', () => {
    expect(toolRequiresConfirmation('getTodaySchedule')).toBe(false);
    expect(byName.has('submitLeaveRequest')).toBe(true);
  });
});
