import type { createNuniClasses } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { feedbackPredatesSubmission } from '@campus/shared/src/lmsReviewQueue';

type Classes = ReturnType<typeof createNuniClasses>;

export type NuniRecentTeacherFeedback = {
  kind: 'assignment' | 'quiz';
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  feedback: string;
  reviewedAt: string | null;
  submittedAt: string | null;
  /** True when published feedback predates the student's latest submission. */
  stale: boolean;
};

export type NuniRecentTeacherFeedbackResult = {
  items: NuniRecentTeacherFeedback[];
  /** Active student courses that failed to load; never treated as an empty success. */
  failedCourseIds: string[];
  studiedCourseCount: number;
};

const FEEDBACK_LIMIT = 8;
const BATCH_SIZE = 4;

function sortRecent(rows: NuniRecentTeacherFeedback[]): NuniRecentTeacherFeedback[] {
  return [...rows]
    .sort(
      (a, b) =>
        (b.reviewedAt ? (parseTaipeiInstant(b.reviewedAt) ?? 0) : 0) -
        (a.reviewedAt ? (parseTaipeiInstant(a.reviewedAt) ?? 0) : 0),
    )
    .slice(0, FEEDBACK_LIMIT);
}

/**
 * Cross-course published teacher feedback for the signed-in Nuni student.
 * Bounded parallel reads; partial course failures are reported, not hidden.
 */
export async function loadNuniRecentTeacherFeedback(
  classes: Classes,
): Promise<NuniRecentTeacherFeedbackResult> {
  const memberships = await classes.list();
  const studying = memberships.filter(
    (course) => course.state === 'active' && course.memberRole === 'student',
  );
  const collected: NuniRecentTeacherFeedback[] = [];
  const failedCourseIds: string[] = [];

  for (let start = 0; start < studying.length; start += BATCH_SIZE) {
    const batch = studying.slice(start, start + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (course) => {
        const [assignments, quizzes] = await Promise.all([
          classes.assignments(course.id),
          classes.quizzes(course.id),
        ]);
        const rows: NuniRecentTeacherFeedback[] = [];
        for (const assignment of assignments) {
          const feedback = assignment.mySubmission?.teacherFeedback?.trim();
          if (!feedback || !assignment.mySubmission) continue;
          rows.push({
            kind: 'assignment',
            id: assignment.id,
            courseId: course.id,
            courseName: course.title,
            title: assignment.title,
            feedback,
            reviewedAt: assignment.mySubmission.reviewedAt,
            submittedAt: assignment.mySubmission.submittedAt,
            stale: feedbackPredatesSubmission(
              assignment.mySubmission.reviewedAt,
              assignment.mySubmission.submittedAt,
            ),
          });
        }
        for (const quiz of quizzes) {
          const feedback = quiz.myResponse?.teacherFeedback?.trim();
          if (!feedback || !quiz.myResponse) continue;
          rows.push({
            kind: 'quiz',
            id: quiz.id,
            courseId: course.id,
            courseName: course.title,
            title: quiz.title,
            feedback,
            reviewedAt: quiz.myResponse.reviewedAt,
            submittedAt: quiz.myResponse.submittedAt,
            stale: feedbackPredatesSubmission(
              quiz.myResponse.reviewedAt,
              quiz.myResponse.submittedAt,
            ),
          });
        }
        return rows;
      }),
    );
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        collected.push(...outcome.value);
      } else {
        failedCourseIds.push(batch[index]!.id);
      }
    });
  }

  return {
    items: sortRecent(collected),
    failedCourseIds,
    studiedCourseCount: studying.length,
  };
}
