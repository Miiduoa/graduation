import { isFirebaseMockMode } from '../firebase';
import { listCourseSpaces, listInboxTasks } from './courseSpaceSource';

export async function loadStudentHome(
  uid: string,
  schoolId?: string,
  mode: 'inbox' | 'today' | 'learning' = 'inbox',
) {
  if (!uid || isFirebaseMockMode()) throw new Error('請登入學校帳號後查看課程。');
  if (mode === 'today') {
    return { courses: [], tasks: await listInboxTasks(uid, schoolId, 'today') };
  }
  const [courses, tasks] = await Promise.all([
    listCourseSpaces(uid, schoolId),
    listInboxTasks(uid, schoolId, mode),
  ]);
  return { courses, tasks };
}
