'use strict';

const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockLimit }));
const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
const mockCollection = jest.fn(() => ({ where: mockWhere }));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
}));

const getLeaveRequestStatus = require('./getLeaveRequestStatus');

describe('getLeaveRequestStatus tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'lr1',
          data: () => ({
            date: '2026-05-11',
            type: '事假',
            status: 'pending',
            courseId: 'c1',
            groupId: 'g1',
            createdAt: null,
          }),
        },
      ],
    });
  });

  test('queries leaveRequests for uid and maps rows', async () => {
    const out = await getLeaveRequestStatus.execute({ uid: 'u1', schoolId: 's1' }, { limit: 5 });
    expect(mockCollection).toHaveBeenCalledWith('leaveRequests');
    expect(mockWhere).toHaveBeenCalledWith('uid', '==', 'u1');
    expect(mockOrderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mockLimit).toHaveBeenCalledWith(5);
    expect(out.count).toBe(1);
    expect(out.items[0]).toMatchObject({
      requestId: 'lr1',
      date: '2026-05-11',
      type: '事假',
      status: 'pending',
      courseId: 'c1',
      groupId: 'g1',
    });
  });

  test('throws without uid', async () => {
    await expect(getLeaveRequestStatus.execute({ schoolId: 's1' }, {})).rejects.toThrow('requires ctx.uid');
  });

  test('requiresConfirmation is false', () => {
    expect(getLeaveRequestStatus.requiresConfirmation).toBeFalsy();
  });
});
