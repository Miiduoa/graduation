{
/** @jest-environment node */
// The package runner compiles the pure TS service and supplies its path to Node.
const testReceipt = typeof jest === 'undefined' ? require('node:test').test : global.test;
const strictAssert = require('node:assert/strict');
const receiptService = require(process.env.ATTENDANCE_RECEIPT_MODULE || '../services/liveAttendanceReceipt.ts');
const expectedScope = { uid: 'student-1', groupId: 'course-space-1', sessionId: 'session-1' };
const validReceipt = { ...expectedScope, success: true, valid: true, attendanceRecorded: true,
  alreadyRecorded: false, status: 'present', checkedInAt: '2026-10-08T07:00:00.000Z' };

testReceipt('accepts a scoped, persisted receipt', () => {
  strictAssert.deepEqual(receiptService.parseLiveAttendanceReceipt(validReceipt, expectedScope), {
    ...expectedScope, status: 'present', checkedInAt: validReceipt.checkedInAt, alreadyRecorded: false,
  });
});
for (const altered of [
  { success: false }, { valid: false }, { attendanceRecorded: false }, { alreadyRecorded: undefined },
  { uid: 'someone-else' }, { groupId: 'different-course' }, { sessionId: 'different-session' },
  { status: 'absent' }, { valid: 'true' }, { checkedInAt: '2026-02-31T07:00:00.000Z' },
  { checkedInAt: 'not-a-date' }, { checkedInAt: '2026-10-08 07:00:00' },
]) {
  testReceipt(`rejects an unconfirmed or wrong-scope receipt ${JSON.stringify(altered)}`, () => {
    strictAssert.equal(receiptService.parseLiveAttendanceReceipt({ ...validReceipt, ...altered }, expectedScope), null);
  });
}
for (const malformed of [null, [], false, {}, undefined]) {
  testReceipt(`rejects malformed response ${String(malformed)}`, () => {
    strictAssert.equal(receiptService.parseLiveAttendanceReceipt(malformed, expectedScope), null);
  });
}

testReceipt('allows a late receipt read back without changing its original time', () => {
  strictAssert.deepEqual(receiptService.parseLiveAttendanceReceipt({ ...validReceipt, status: 'late', alreadyRecorded: true }, expectedScope), {
    ...expectedScope, status: 'late', checkedInAt: validReceipt.checkedInAt, alreadyRecorded: true,
  });
});

testReceipt('the client request contains neither a claimed user nor a client time', () => {
  strictAssert.deepEqual(receiptService.buildLiveAttendanceRequest(expectedScope, '  complete-token-123456789  '), {
    groupId: expectedScope.groupId, sessionId: expectedScope.sessionId, qrToken: 'complete-token-123456789',
  });
});

for (const token of ['', 'ABC123', 'x'.repeat(513), 'has an internal space']) {
  testReceipt(`refuses incomplete token ${String(token).slice(0, 20)}`, () => {
    strictAssert.equal(receiptService.buildLiveAttendanceRequest(expectedScope, token), null);
  });
}

testReceipt('does not derive a group ID by stripping an LMS prefix', () => {
  const request = receiptService.buildLiveAttendanceRequest({ ...expectedScope, groupId: 'tc:123' }, 'complete-token-123456789');
  strictAssert.equal(request.groupId, 'tc:123');
});

testReceipt('rejects missing identity, slash paths and unsafe document IDs', () => {
  for (const scope of [{ ...expectedScope, uid: '' }, { ...expectedScope, groupId: '../other' },
    { ...expectedScope, sessionId: '__proto__' }, { ...expectedScope, sessionId: ' session ' }]) {
    strictAssert.equal(receiptService.buildLiveAttendanceRequest(scope, 'complete-token-123456789'), null);
  }
});

testReceipt('error messages distinguish permission, expiry and unconfirmed responses', () => {
  strictAssert.match(receiptService.liveAttendanceErrorMessage({ code: 'functions/permission-denied' }), /資格/);
  strictAssert.match(receiptService.liveAttendanceErrorMessage({ code: 'functions/deadline-exceeded' }), /過期/);
  strictAssert.match(receiptService.liveAttendanceErrorMessage(new Error('private token should not leak')), /尚未收到/);
  strictAssert.equal(receiptService.liveAttendanceErrorMessage(new Error('SECRET')).includes('SECRET'), false);
});

}
