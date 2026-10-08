import AsyncStorage from '@react-native-async-storage/async-storage';
import { simulateTeacherGrade } from '../services/demoActionSimulator';
import { loadVisibleRoleEventInbox } from '../services/roleEventBus';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { prepareGradingDelivery } from '../services/prepareGradingDelivery';

const valid = {
  actorUid: 'demo_teacher_chang',
  actorRole: 'teacher',
  studentUid: 'demo_student_kuchih',
  studentName: '顧晉瑋',
  courseId: '71378',
  assignmentId: '101',
  score: 85,
};

describe('prepareGradingDelivery', () => {
  it('uses the explicit student account, not the display name', () => {
    expect(prepareGradingDelivery(valid)).toEqual({
      ok: true,
      actorUid: 'demo_teacher_chang',
      studentUid: 'demo_student_kuchih',
      studentName: '顧晉瑋',
      courseId: 71378,
      assignmentId: 101,
      score: 85,
    });
  });

  it('trims account identifiers and keeps the same target', () => {
    expect(
      prepareGradingDelivery({ ...valid, actorUid: ' demo_teacher_chang ', studentUid: ' u1 ' }),
    ).toMatchObject({ ok: true, actorUid: 'demo_teacher_chang', studentUid: 'u1' });
  });

  it.each([undefined, null, '', '   '])('rejects a missing student UID (%s)', (studentUid) => {
    expect(prepareGradingDelivery({ ...valid, studentUid })).toEqual({
      ok: false,
      reason: 'student_missing',
    });
  });

  it('never guesses a recipient from the student name or number', () => {
    expect(
      prepareGradingDelivery({ ...valid, studentName: '顧晉瑋', studentUid: undefined }),
    ).toMatchObject({ ok: false, reason: 'student_missing' });
  });

  it.each(['student', 'guest', 'admin', undefined])('rejects unauthorized grading roles (%s)', (actorRole) => {
    expect(prepareGradingDelivery({ ...valid, actorRole })).toEqual({
      ok: false,
      reason: 'teacher_role_invalid',
    });
  });

  it('rejects an absent actor', () => {
    expect(prepareGradingDelivery({ ...valid, actorUid: null })).toEqual({
      ok: false,
      reason: 'teacher_missing',
    });
  });

  it('rejects a grade directed to the teacher account', () => {
    expect(
      prepareGradingDelivery({ ...valid, studentUid: ' demo_teacher_chang ' }),
    ).toEqual({ ok: false, reason: 'self_recipient' });
  });

  it('rejects an empty student display name', () => {
    expect(prepareGradingDelivery({ ...valid, studentName: ' ' })).toEqual({
      ok: false,
      reason: 'student_name_missing',
    });
  });

  it.each(['', '-1', '0', 'unknown', '1.2', '99999999999999999999'])(
    'rejects invalid course IDs (%s)',
    (courseId) => {
      expect(prepareGradingDelivery({ ...valid, courseId })).toEqual({
        ok: false,
        reason: 'invalid_course',
      });
    },
  );

  it.each(['0', '-2', 'missing', '2.5'])('rejects invalid assignment IDs (%s)', (assignmentId) => {
    expect(prepareGradingDelivery({ ...valid, assignmentId })).toEqual({
      ok: false,
      reason: 'invalid_assignment',
    });
  });

  it.each([-1, 101, NaN, Infinity])('rejects invalid grades (%s)', (score) => {
    expect(prepareGradingDelivery({ ...valid, score })).toEqual({
      ok: false,
      reason: 'invalid_score',
    });
  });

  it.each([0, 100, 89.5])('accepts valid boundary and fractional scores (%s)', (score) => {
    expect(prepareGradingDelivery({ ...valid, score })).toMatchObject({ ok: true, score });
  });
});

describe('demo grade notification isolation', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('delivers a grade to the selected student, not another student', async () => {
    const prepared = prepareGradingDelivery(valid);
    if ('reason' in prepared) throw new Error('Valid grading fixture was rejected');

    await simulateTeacherGrade({
      teacherUid: prepared.actorUid,
      teacherName: '示範教師',
      studentUid: prepared.studentUid,
      studentName: prepared.studentName,
      courseId: prepared.courseId,
      courseName: '機器學習',
      homeworkId: prepared.assignmentId,
      homeworkTitle: 'HW1',
      score: prepared.score,
      totalScore: 100,
    });

    const recipientInbox = await loadVisibleRoleEventInbox({
      uid: 'demo_student_kuchih',
      role: 'student',
    });
    const otherInbox = await loadVisibleRoleEventInbox({ uid: 'u1', role: 'student' });
    const teacherInbox = await loadVisibleRoleEventInbox({
      uid: 'demo_teacher_chang',
      role: 'teacher',
    });

    expect(recipientInbox).toHaveLength(1);
    expect(recipientInbox[0].kind).toBe('grade_published');
    expect(recipientInbox[0].targetUids).toEqual(['demo_student_kuchih']);
    expect(otherInbox).toHaveLength(0);
    expect(teacherInbox).toHaveLength(0);
  });

  it('does not publish when no recipient account exists', async () => {
    const prepared = prepareGradingDelivery({ ...valid, studentUid: undefined });
    expect(prepared).toEqual({ ok: false, reason: 'student_missing' });

    expect(
      await loadVisibleRoleEventInbox({ uid: 'demo_student_kuchih', role: 'student' }),
    ).toHaveLength(0);
  });
});
