'use strict';

const mockSet = jest.fn();
const mockCourseGet = jest.fn();
const mockLeaveDoc = jest.fn(() => ({ id: 'gen-id', set: mockSet }));

const mockCollection = jest.fn((name) => {
  if (name === 'leaveRequests') {
    return { doc: mockLeaveDoc };
  }
  if (name === 'users') {
    return {
      doc: jest.fn(() => ({
        collection: jest.fn((sub) => {
          if (sub === 'courses') {
            return {
              doc: jest.fn(() => ({ get: mockCourseGet })),
            };
          }
          return { doc: jest.fn(() => ({})) };
        }),
      })),
    };
  }
  return { doc: jest.fn() };
});

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
  FieldValue: { serverTimestamp: jest.fn(() => 'srv-ts') },
}));

const submitLeaveRequest = require('./submitLeaveRequest');

describe('submitLeaveRequest tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCourseGet.mockResolvedValue({ exists: false, data: () => ({}) });
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
        groupId: null,
      }),
    );
  });

  test('prefers ctx.groupId over course doc', async () => {
    mockCourseGet.mockResolvedValue({
      exists: true,
      data: () => ({ groupId: 'g-course' }),
    });
    await submitLeaveRequest.execute(
      { uid: 'u1', schoolId: 's1', groupId: 'g-ctx' },
      { courseId: 'c1', date: '2026-05-11', type: 'sick' },
    );
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g-ctx' }));
  });

  test('loads groupId from users/uid/courses/courseId when ctx has none', async () => {
    mockCourseGet.mockResolvedValue({
      exists: true,
      data: () => ({ groupId: 'g-course' }),
    });
    await submitLeaveRequest.execute(
      { uid: 'u1', schoolId: 's1' },
      { courseId: 'c1', date: '2026-05-11', type: 'sick' },
    );
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g-course' }));
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
