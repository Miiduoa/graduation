import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { DormWorkflowConfig } from '@campus/shared/src/dormWorkflow';
import { getDb, getFunctionsInstance, getFunctionsBaseUrl } from '../firebase';
import {
  watchDormCloud,
  watchDormParcels,
  type DormCloudState,
} from '@campus/shared/src/dormitoryCloud';

export async function getDormWorkflowConfig(schoolId: string): Promise<DormWorkflowConfig> {
  const result = await httpsCallable<Record<string, unknown>, DormWorkflowConfig>(
    getFunctionsInstance(),
    'dormWorkflow',
  )({ action: 'config', schoolId: toPublicSchoolId(schoolId) ?? schoolId });
  return result.data;
}

export function subscribeDormCloud(
  schoolId: string,
  uid: string,
  onChange: (state: DormCloudState) => void,
): () => void {
  const db = getDb();
  const canonicalSchoolId = toPublicSchoolId(schoolId) ?? schoolId;
  return watchDormCloud(
    {
      watch: (name, field, rows, error) => {
        const legacy = (onRows: typeof rows, onError: typeof error) =>
          onSnapshot(
            query(collection(db, 'schools', canonicalSchoolId, name), where(field, '==', uid)),
            (snap) => onRows(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
            onError,
          );
        return name === 'packages'
          ? watchDormParcels(
              legacy,
              (change) => {
                if (
                  !(
                    Boolean(getFunctionsBaseUrl()) ||
                    ['1', 'true'].includes(process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR || '')
                  )
                )
                  return () => {};
                change(true);
                return () => {};
              },
              async () =>
                (
                  await httpsCallable<
                    Record<string, unknown>,
                    { rows: Array<{ id: string; data: Record<string, unknown> }> }
                  >(
                    getFunctionsInstance(),
                    'dormWorkflow',
                  )({ schoolId: canonicalSchoolId, action: 'parcels' })
                ).data,
              rows,
              error,
            )
          : legacy(rows, error);
      },
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
