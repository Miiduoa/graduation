/** Approval-isolated adapters: no production screen imports this module. */
import { collection, doc, getDocFromServer, onSnapshot, query, where } from 'firebase/firestore';
import { cleanCourses } from '@campus/shared';
import { toPublicSchoolId } from '../../data/schoolIds';
import { getDb } from '../../firebase';
import { loadPersonalTimetable } from '../../services/personalTimetable';
import {
  createWorkstudyService,
  type CareerTransport,
} from '../../../../../packages/shared/src/careerWorkstudy';

export function createCareerWorkstudyPorts({
  schoolId,
  uid,
  localOwner,
  transport,
}: {
  schoolId: string;
  uid: string | null;
  localOwner?: string;
  transport: CareerTransport;
}) {
  const service = createWorkstudyService(schoolId, transport);
  service.subscribe = (audience, changed, failed) => {
    const db = getDb();
    const opportunities = collection(db, 'schools', schoolId, 'careerOpportunities');
    const unsubscribers = [
      onSnapshot(
        audience === 'staff' ? opportunities : query(opportunities, where('published', '==', true)),
        changed,
        failed,
      ),
    ];
    if (uid && audience !== 'ops') {
      const applications = collection(db, 'schools', schoolId, 'careerApplications');
      unsubscribers.push(
        onSnapshot(
          audience === 'staff' ? applications : query(applications, where('uid', '==', uid)),
          changed,
          failed,
        ),
      );
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
  return {
    service,
    // The general loader silently falls back to cached data on cloud errors.
    // Conflict checks need a confirmed read, so keep that fallback out of this adapter.
    loadCourses: async () => {
      try {
        if (!uid || localOwner) {
          const { courses } = await loadPersonalTimetable(uid, schoolId, localOwner);
          return courses.length ? courses : null;
        }
        const canonical = toPublicSchoolId(schoolId) ?? schoolId;
        const db = getDb();
        let snap = await getDocFromServer(
          doc(db, 'users', uid, 'schools', canonical, 'personalTimetable', 'current'),
        );
        if (!snap.exists())
          snap = await getDocFromServer(doc(db, 'users', uid, 'personalTimetable', 'current'));
        if (!snap.exists()) return null;
        const data = snap.data();
        if ((toPublicSchoolId(data.schoolId) ?? data.schoolId) !== canonical) return null;
        const courses = cleanCourses(data.courses);
        return courses.length ? courses : null;
      } catch {
        return null;
      }
    },
  };
}
