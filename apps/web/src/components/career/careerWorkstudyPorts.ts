/** Approval-isolated adapters: no production screen imports this module. */
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import { loadPersonalTimetable } from '@/lib/timetable/store';
import { createWorkstudyService, type CareerTransport } from '@campus/shared/src/careerWorkstudy';

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
    loadCourses: async () => {
      const { courses } = await loadPersonalTimetable(uid, schoolId, localOwner);
      return courses.length ? courses : null;
    },
  };
}
