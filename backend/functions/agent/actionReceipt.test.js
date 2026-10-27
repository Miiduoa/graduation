'use strict';

const { confirmedAgentWrite } = require('./actionReceipt');

const scope = { uid: 'alice', schoolId: 'pu' };

test.each([
  ['submitLeaveRequest', { requestId: 'leave-1', status: 'pending' }, {}],
  ['reserveSeat', { reservationId: 'seat-1', seatId: 'S1', date: '2026-10-28' }, { seatId: 'S1', date: '2026-10-28' }],
  ['borrowBook', { loanId: 'loan-1', dueAt: '2026-11-15T00:00:00.000Z' }, {}],
  ['returnBook', { success: true, bookTitle: 'Library book' }, {}],
  ['renewBook', { success: true, newDueAt: '2026-11-15T00:00:00.000Z', renewCount: 1 }, {}],
  ['createDormRepairRequest', { success: true, repairId: 'repair-1', requestId: 'repair-1', status: 'pending', room: '101', dormitory: 'A' }, { room: '101', dormitory: 'A' }],
  ['reserveWashingMachine', { reservationId: 'washer-1', machineId: 'A1', reservedUntil: '2026-10-28T09:00:00Z' }, { machineId: 'A1' }],
  ['createOrder', { success: true, orderId: 'order-1', userId: 'alice', schoolId: 'pu', total: 210, items: [{ name: 'Lunch' }] }, {}],
  ['cancelOrder', { success: true, orderId: 'order-1' }, { orderId: 'order-1' }],
  ['submitQuizAttempt', { success: true, attempt: { submittedAt: '2026-10-27T08:00:00Z' } }, {}],
  ['verifyAttendanceClaim', { success: true, status: 'present', flags: [] }, {}],
])('requires a grounded receipt for %s', (tool, receipt, input) => {
  expect(confirmedAgentWrite(tool, receipt, input, scope)).toBe(true);
});

test.each([undefined, null, false, true, '', 'success', [], {}, { success: true }, { status: 'pending' }])(
  'does not manufacture successful writes from missing or malformed output %#',
  (receipt) => {
    for (const tool of ['submitLeaveRequest', 'reserveSeat', 'borrowBook', 'createOrder', 'returnBook']) {
      expect(confirmedAgentWrite(tool, receipt, {}, scope)).toBe(false);
    }
  },
);

test('rejects mismatched school, actor, resource identities and broken timestamps', () => {
  expect(confirmedAgentWrite('createOrder', { success: true, orderId: 'ok', userId: 'bob', schoolId: 'pu', total: 100, items: [{}] }, {}, scope)).toBe(false);
  expect(confirmedAgentWrite('reserveSeat', { reservationId: 'ok', seatId: 'other', date: '2026-10-28' }, { seatId: 'S1', date: '2026-10-28' })).toBe(false);
  expect(confirmedAgentWrite('cancelOrder', { success: true, orderId: 'other' }, { orderId: 'target' })).toBe(false);
  expect(confirmedAgentWrite('borrowBook', { loanId: 'ok', dueAt: 'not-a-date' })).toBe(false);
  expect(confirmedAgentWrite('createDormRepairRequest', { success: true, requestId: 'wrong', repairId: 'ok', status: 'pending', dormitory: 'A', room: '101' }, { dormitory: 'A', room: '101' })).toBe(false);
  expect(confirmedAgentWrite('submitQuizAttempt', { success: true, attempt: {} })).toBe(false);
});

test('unknown future writes and failure receipts are blocked', () => {
  expect(confirmedAgentWrite('unknownFutureWrite', { success: true, requestId: 'ok' })).toBe(false);
  expect(confirmedAgentWrite('createOrder', { success: false, orderId: 'ok', userId: 'alice', schoolId: 'pu', total: 10, items: [{}] }, {}, scope)).toBe(false);
  expect(confirmedAgentWrite('returnBook', { success: 'true', bookTitle: 'Book' })).toBe(false);
});
