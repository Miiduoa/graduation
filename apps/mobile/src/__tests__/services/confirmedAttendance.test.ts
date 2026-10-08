import { confirmQrAttendance } from '../../services/confirmedAttendance';

const input = { courseSpaceId: 'course-1', sessionId: 'class-1', qrToken: 'server-token', uid: 'student-1' };
const valid = { valid: true, attendanceRecorded: true, status: 'present', uid: 'student-1',
  courseId: 'course-1', sessionId: 'class-1', checkedInAt: '2026-10-08T06:30:00.000Z', alreadyRecorded: false };

test('calls the verification endpoint with the actual QR token and account', async () => {
  const invoke = jest.fn().mockResolvedValue(valid);
  const onConfirmed = jest.fn();
  const result = await confirmQrAttendance(input, { invoke, onConfirmed });
  expect(invoke).toHaveBeenCalledWith({ courseId: 'course-1', sessionId: 'class-1',
    claim: { token: 'server-token', uid: 'student-1' } });
  expect(result.success).toBe(true);
  expect(onConfirmed).toHaveBeenCalledTimes(1);
  expect(onConfirmed).toHaveBeenCalledWith(result);
});

const rejected: unknown[] = [null, [], {}, { success: true, attendanceRecorded: false },
  { ...valid, attendanceRecorded: false }, { ...valid, valid: false }, { ...valid, status: 'absent' },
  { ...valid, uid: 'another-student' }, { ...valid, courseId: 'another-course' },
  { ...valid, sessionId: 'another-class' }, { ...valid, checkedInAt: 'not-a-date' },
  { ...valid, alreadyRecorded: undefined }];
for (let i = 0; i < rejected.length; i++) {
  test(`does not notify or report success for an unconfirmed/mismatched receipt (${i + 1})`, async () => {
    const onConfirmed = jest.fn();
    await expect(confirmQrAttendance(input, {
      invoke: jest.fn().mockResolvedValue(rejected[i]), onConfirmed,
    })).rejects.toThrow();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
}

test('does not call the backend when a QR code is missing', async () => {
  const invoke = jest.fn().mockResolvedValue(valid);
  const onConfirmed = jest.fn();
  await expect(confirmQrAttendance({ ...input, qrToken: '' }, { invoke, onConfirmed })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  expect(onConfirmed).not.toHaveBeenCalled();
});

test('network failure remains a failure and does not emit attendance', async () => {
  const onConfirmed = jest.fn();
  await expect(confirmQrAttendance(input, {
    invoke: jest.fn().mockRejectedValue(new Error('unavailable')), onConfirmed,
  })).rejects.toThrow('unavailable');
  expect(onConfirmed).not.toHaveBeenCalled();
});

test('a retry receipt does not repeat companion side effects', async () => {
  const onConfirmed = jest.fn();
  const result = await confirmQrAttendance(input, {
    invoke: jest.fn().mockResolvedValue({ ...valid, alreadyRecorded: true }), onConfirmed,
  });
  expect(result.success).toBe(true);
  expect(onConfirmed).not.toHaveBeenCalled();
});

test('a failed optional companion hint cannot undo a committed attendance', async () => {
  const result = await confirmQrAttendance(input, {
    invoke: jest.fn().mockResolvedValue(valid),
    onConfirmed: jest.fn().mockRejectedValue(new Error('hint failed')),
  });
  expect(result.success).toBe(true);
});
