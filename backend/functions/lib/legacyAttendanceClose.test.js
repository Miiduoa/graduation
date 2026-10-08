'use strict';
const testCase = typeof jest === 'undefined' ? require('node:test').test : global.test;
const assert = require('node:assert/strict');
const { createLiveAttendanceHandlers } = require('./liveAttendance');
const { TransactionStore, Timestamp, FieldValue, HttpsError } = require('../test-support/transactionStore');
function fixture(groupId) {
  const db = new TransactionStore();
  const common = { sessionId: 's1', teacherId: 'teacher-1', active: true };
  db.put('groups/c1/members/teacher-1', { role: 'instructor', status: 'active' });
  db.put('groups/c1/liveSessions/s1', { ...common, ...(groupId ? { groupId } : {}), qrToken: 'legacy-secret' });
  db.put('groups/c1/attendanceSessions/s1', { ...common, groupId: 'c1', liveSessionId: 's1' });
  const api = createLiveAttendanceHandlers({ db, Timestamp, FieldValue, HttpsError, clock: () => 100000 });
  return { db, api, request: { auth: { uid: 'teacher-1' }, data: { groupId: 'c1', sessionId: 's1' } } };
}
testCase('creator can close a legacy live session lacking groupId while validating the mirror', async () => {
  const f = fixture();
  const result = await f.api.endLiveSession(f.request);
  assert.equal(result.active, false);
  assert.equal(f.db.get('groups/c1/liveSessions/s1').active, false);
  assert.equal(f.db.get('groups/c1/attendanceSessions/s1').active, false);
});
testCase('explicitly conflicting legacy group metadata never permits closing', async () => {
  const f = fixture('other'); const before = f.db.dump();
  await assert.rejects(f.api.endLiveSession(f.request), (e) => e.code === 'failed-precondition');
  assert.deepEqual(f.db.dump(), before);
});
