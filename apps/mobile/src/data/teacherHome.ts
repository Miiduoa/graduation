import { getDb, isFirebaseMockMode } from '../firebase';
import { canManageCourse, listCourseMemberships } from '../services/courseWorkspace';
import { listInboxTasks } from './courseSpaceSource';

export async function loadTeacherHome(uid: string, schoolId?: string) {
  if (!uid || isFirebaseMockMode()) throw new Error('請登入學校帳號後查看課程。');

  const memberships = await listCourseMemberships(getDb(), uid, schoolId);
  const courses = memberships.filter((course) => canManageCourse(course.role));
  if (!courses.length) return { courses, tasks: [] };

  const courseIds = new Set(courses.map((course) => course.groupId));
  const tasks = (await listInboxTasks(uid, schoolId)).filter(
    (task) => task.kind !== 'assistant_queue' && courseIds.has(task.groupId),
  );
  return { courses, tasks };
}

export type TeacherHomeData = Awaited<ReturnType<typeof loadTeacherHome>>;
