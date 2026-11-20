/**
 * @jest-environment node
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDemoHomeworksByCourse } from '../data/demoCoursesMock';
import {
  TEACHER_COCKPIT_PRIMARY_STUDENT,
  buildFlaggedTeacherCockpitStudents,
  buildHomeworkSubmissionStats,
  getMissingStudentsForHomework,
  getTeacherCockpitStudents,
  selectFeedbackStudentForHomework,
} from '../services/teacherCockpitActions';
import {
  clearRoleEventInbox,
  emitBulkReminder,
  emitFeedbackDrafted,
  loadVisibleRoleEventInbox,
} from '../services/roleEventBus';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('teacherCockpitActions', () => {
  const courseId = 71378;
  const students = getTeacherCockpitStudents(courseId);
  const homeworks = getDemoHomeworksByCourse(courseId);
  const hw1 = homeworks.find((hw) => hw.title.startsWith('HW1'))!;
  const hw3 = homeworks.find((hw) => hw.title.startsWith('HW3'))!;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await clearRoleEventInbox(TEACHER_COCKPIT_PRIMARY_STUDENT.uid);
    await clearRoleEventInbox('u1');
    await clearRoleEventInbox('u3');
  });

  it('AI 評語預設會選到實際已交作業的 demo 主學生', () => {
    const target = selectFeedbackStudentForHomework(hw1, students);

    expect(target?.uid).toBe(TEACHER_COCKPIT_PRIMARY_STUDENT.uid);
    expect(target?.displayName).toBe('顧晉瑋');
  });

  it('缺繳名單使用實際 uid，不再產生 u0 這種假 uid', () => {
    const missing = getMissingStudentsForHomework(hw3, students);

    expect(missing.map((student) => student.uid)).toContain(TEACHER_COCKPIT_PRIMARY_STUDENT.uid);
    expect(missing.map((student) => student.uid)).not.toContain('u0');
  });

  it('作業統計與需關注學生共用同一組 target helper', () => {
    const stats = buildHomeworkSubmissionStats(homeworks, students);
    const hw3Stat = stats.find((stat) => stat.hw.id === hw3.id)!;
    const flagged = buildFlaggedTeacherCockpitStudents(homeworks, students);

    expect(hw3Stat.missingStudents.map((student) => student.uid)).toEqual(
      getMissingStudentsForHomework(hw3, students).map((student) => student.uid),
    );
    expect(flagged.some((row) => row.student.uid === TEACHER_COCKPIT_PRIMARY_STUDENT.uid)).toBe(true);
  });

  it('送出 AI 評語後只有目標學生 visible inbox 看得到', async () => {
    const target = selectFeedbackStudentForHomework(hw1, students)!;

    await emitFeedbackDrafted({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: [target.uid],
      courseId,
      courseName: '機器學習',
      payload: {
        studentName: target.displayName,
        homeworkTitle: hw1.title,
        draftPreview: '作業完成度高，建議補上更多實驗比較。',
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: target.uid, role: 'student' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'u1', role: 'student' })).toHaveLength(0);
  });

  it('批量提醒只送給實際缺繳學生', async () => {
    const missing = getMissingStudentsForHomework(hw3, students);

    await emitBulkReminder({
      actorUid: 'demo_teacher_chang',
      actorName: '張怡君',
      targetUids: missing.map((student) => student.uid),
      courseId,
      courseName: '機器學習',
      payload: {
        homeworkId: hw3.id,
        homeworkTitle: hw3.title,
        count: missing.length,
      },
    });

    expect(await loadVisibleRoleEventInbox({ uid: TEACHER_COCKPIT_PRIMARY_STUDENT.uid, role: 'student' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'u3', role: 'student' })).toHaveLength(1);
    expect(await loadVisibleRoleEventInbox({ uid: 'u1', role: 'student' })).toHaveLength(0);
  });
});
