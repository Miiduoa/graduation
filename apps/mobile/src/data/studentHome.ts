import { isFirebaseMockMode } from '../firebase';
import { listCourseSpaces, listInboxTasks } from './courseSpaceSource';

export async function loadStudentHome(uid: string, schoolId?: string, mode: 'today' | 'learning' = 'today') {
  if (!uid || isFirebaseMockMode()) throw new Error('請登入學校帳號後查看課程。');
  const [courses, tasks] = await Promise.all([
    listCourseSpaces(uid, schoolId),
    listInboxTasks(uid, schoolId, mode === 'learning' ? 'learning' : 'inbox'),
  ]);
  return { courses, tasks };
}
