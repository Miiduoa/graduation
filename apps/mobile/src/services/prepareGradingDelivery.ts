/**
 * Validate the recipient and demo assignment before an inbox grade event is created.
 * Display names and student numbers are not account identifiers.
 */
export type GradingDeliveryInput = {
  actorUid?: string | null;
  actorRole?: string | null;
  studentUid?: string | null;
  studentName: string;
  courseId: string;
  assignmentId: string;
  score: number;
};

type GradingDeliveryError =
  | 'teacher_missing'
  | 'teacher_role_invalid'
  | 'student_missing'
  | 'self_recipient'
  | 'student_name_missing'
  | 'invalid_course'
  | 'invalid_assignment'
  | 'invalid_score';

export type GradingDeliveryResult =
  | {
      ok: true;
      actorUid: string;
      studentUid: string;
      studentName: string;
      courseId: number;
      assignmentId: number;
      score: number;
    }
  | { ok: false; reason: GradingDeliveryError };

function positiveIntegerId(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function prepareGradingDelivery(input: GradingDeliveryInput): GradingDeliveryResult {
  const actorUid = input.actorUid?.trim();
  if (!actorUid) return { ok: false, reason: 'teacher_missing' };
  if (!['teacher', 'professor', 'ta'].includes(input.actorRole ?? '')) {
    return { ok: false, reason: 'teacher_role_invalid' };
  }

  const studentUid = input.studentUid?.trim();
  if (!studentUid) return { ok: false, reason: 'student_missing' };
  if (studentUid === actorUid) return { ok: false, reason: 'self_recipient' };

  const studentName = input.studentName.trim();
  if (!studentName) return { ok: false, reason: 'student_name_missing' };

  const courseId = positiveIntegerId(input.courseId);
  if (courseId === null) return { ok: false, reason: 'invalid_course' };

  const assignmentId = positiveIntegerId(input.assignmentId);
  if (assignmentId === null) return { ok: false, reason: 'invalid_assignment' };

  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
    return { ok: false, reason: 'invalid_score' };
  }

  return {
    ok: true,
    actorUid,
    studentUid,
    studentName,
    courseId,
    assignmentId,
    score: input.score,
  };
}
