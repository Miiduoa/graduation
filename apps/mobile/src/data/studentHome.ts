import { isFirebaseMockMode } from '../firebase';
import { listCourseSpaces, listInboxTasks } from './courseSpaceSource';

export async function loadStudentHome(uid: string, schoolId?: string) {
  if (!uid || isFirebaseMockMode()) throw new Error('請登入學校帳號後查看課程。');
  const [courses, tasks] = await Promise.all([
    listCourseSpaces(uid, schoolId),
    listInboxTasks(uid, schoolId),
  ]);
  return { courses, tasks };
}
