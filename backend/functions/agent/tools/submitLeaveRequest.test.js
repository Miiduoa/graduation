'use strict';

const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({ id: 'gen-id', set: mockSet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: jest.fn(() => 'srv-ts') },
}));

const submitLeaveRequest = require('./submitLeaveRequest');

describe('submitLeaveRequest tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes leave request document', async () => {
    const out = await submitLeaveRequest.execute(
      { uid: 'u1', schoolId: 's1' },
      { courseId: 'c1', date: '2026-05-11', type: 'sick' },
    );
    expect(out.requestId).toBe('gen-id');
    expect(out.status).toBe('pending');
    expect(mockCollection).toHaveBeenCalledWith('leaveRequests');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1',
        schoolId: 's1',
        courseId: 'c1',
        date: '2026-05-11',
        type: 'sick',
        status: 'pending',
      }),
    );
  });

  test('throws without uid', async () => {
    await expect(
      submitLeaveRequest.execute({ schoolId: 's1' }, { courseId: 'c', date: 'd', type: 't' }),
    ).rejects.toThrow('requires ctx.uid');
  });

  test('requiresConfirmation meta is true', () => {
    expect(submitLeaveRequest.requiresConfirmation).toBe(true);
  });
});
