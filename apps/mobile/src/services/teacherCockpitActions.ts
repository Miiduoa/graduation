import type { MockHomework } from '../data/demoCoursesMock';

export type TeacherCockpitStudent = {
  uid: string;
  displayName: string;
  email: string;
};

export type TeacherCockpitHomeworkStat = {
  hw: MockHomework;
  submittedStudents: TeacherCockpitStudent[];
  missingStudents: TeacherCockpitStudent[];
  submittedCount: number;
  missing: number;
  total: number;
};

export const TEACHER_COCKPIT_PRIMARY_STUDENT: TeacherCockpitStudent = {
  uid: 'demo_student_kuchih',
  displayName: '顧晉瑋',
  email: 'demo.student@pu.edu.tw',
};

export const TEACHER_COCKPIT_STUDENTS_BY_COURSE: Record<number, TeacherCockpitStudent[]> = {
  71378: [
    TEACHER_COCKPIT_PRIMARY_STUDENT,
    { uid: 'u1', displayName: '林佳玲', email: 'jia@example.edu' },
    { uid: 'u2', displayName: '王冠宇', email: 'kuan@example.edu' },
    { uid: 'u3', displayName: '陳柏翰', email: 'po@example.edu' },
    { uid: 'u4', displayName: '楊涵真', email: 'han@example.edu' },
    { uid: 'u5', displayName: '張瑞祥', email: 'rui@example.edu' },
    { uid: 'u6', displayName: '李宜珊', email: 'yi@example.edu' },
  ],
  71282: [
    TEACHER_COCKPIT_PRIMARY_STUDENT,
    { uid: 'u11', displayName: '吳子翔', email: 'tzu@example.edu' },
    { uid: 'u12', displayName: '黃詩涵', email: 'shi@example.edu' },
  ],
  71240: [
    TEACHER_COCKPIT_PRIMARY_STUDENT,
    { uid: 'u21', displayName: '蔡明哲', email: 'min@example.edu' },
  ],
  71393: [
    TEACHER_COCKPIT_PRIMARY_STUDENT,
    { uid: 'u31', displayName: '林依靜', email: 'yj@example.edu' },
    { uid: 'u32', displayName: '周冠廷', email: 'zh@example.edu' },
    { uid: 'u33', displayName: '阮品逸', email: 'pp@example.edu' },
  ],
  77418: [
    TEACHER_COCKPIT_PRIMARY_STUDENT,
    { uid: 'u41', displayName: '謝芷涵', email: 'zh4@example.edu' },
  ],
};

export function getTeacherCockpitStudents(courseId: number): TeacherCockpitStudent[] {
  return TEACHER_COCKPIT_STUDENTS_BY_COURSE[courseId] ?? [];
}

export function getSubmittedStudentsForHomework(
  hw: Pick<MockHomework, 'id'>,
  students: TeacherCockpitStudent[],
): TeacherCockpitStudent[] {
  return students.filter((_, index) => (hw.id + index) % 3 !== 0);
}

export function getMissingStudentsForHomework(
  hw: Pick<MockHomework, 'id'>,
  students: TeacherCockpitStudent[],
): TeacherCockpitStudent[] {
  const submittedUids = new Set(getSubmittedStudentsForHomework(hw, students).map((student) => student.uid));
  return students.filter((student) => !submittedUids.has(student.uid));
}

export function buildHomeworkSubmissionStat(
  hw: MockHomework,
  students: TeacherCockpitStudent[],
): TeacherCockpitHomeworkStat {
  const submittedStudents = getSubmittedStudentsForHomework(hw, students);
  const missingStudents = getMissingStudentsForHomework(hw, students);
  return {
    hw,
    submittedStudents,
    missingStudents,
    submittedCount: submittedStudents.length,
    missing: missingStudents.length,
    total: students.length,
  };
}

export function buildHomeworkSubmissionStats(
  homeworks: MockHomework[],
  students: TeacherCockpitStudent[],
): TeacherCockpitHomeworkStat[] {
  return homeworks.map((hw) => buildHomeworkSubmissionStat(hw, students));
}

export function selectFeedbackStudentForHomework(
  hw: Pick<MockHomework, 'id'>,
  students: TeacherCockpitStudent[],
): TeacherCockpitStudent | null {
  const submittedStudents = getSubmittedStudentsForHomework(hw, students);
  return (
    submittedStudents.find((student) => student.uid === TEACHER_COCKPIT_PRIMARY_STUDENT.uid) ??
    submittedStudents[0] ??
    students[0] ??
    null
  );
}

export function buildFlaggedTeacherCockpitStudents(
  homeworks: MockHomework[],
  students: TeacherCockpitStudent[],
): Array<{ student: TeacherCockpitStudent; reason: string; severity: 'high' | 'medium' }> {
  const out: Array<{ student: TeacherCockpitStudent; reason: string; severity: 'high' | 'medium' }> = [];
  students.forEach((student) => {
    const missing = homeworks.filter((hw) =>
      getMissingStudentsForHomework(hw, students).some((row) => row.uid === student.uid),
    ).length;
    if (missing >= 3) {
      out.push({ student, reason: `已 ${missing} 份作業未繳`, severity: 'high' });
    } else if (missing === 2) {
      out.push({ student, reason: '已 2 份作業未繳', severity: 'medium' });
    }
  });
  return out;
}
