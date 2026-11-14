import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { getDb } from '../firebase';
import { watchDormCloud, type DormCloudState } from '@campus/shared/src/dormitoryCloud';

export function subscribeDormCloud(
  schoolId: string,
  uid: string,
  onChange: (state: DormCloudState) => void,
): () => void {
  const db = getDb();
  const canonicalSchoolId = toPublicSchoolId(schoolId) ?? schoolId;
  return watchDormCloud(
    {
      watch: (name, field, rows, error) =>
        onSnapshot(
          query(collection(db, 'schools', canonicalSchoolId, name), where(field, '==', uid)),
          (snap) => rows(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
          error,
        ),
      identity: (callback) =>
        onSnapshot(
          doc(db, 'users', uid),
          (snap) => {
            const value = snap.data();
            callback(
              value &&
                typeof value.studentId === 'string' &&
                typeof (value.displayName || value.name) === 'string'
                ? { studentId: value.studentId, name: value.displayName || value.name }
                : null,
            );
          },
          () => callback(null),
        ),
    },
    onChange,
  );
}
