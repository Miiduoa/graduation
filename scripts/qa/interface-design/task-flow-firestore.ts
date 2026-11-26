import { queueSyntheticWrite, syntheticDb, taskFlowWrites } from './task-flow-boundaries';

type SyntheticConstraint =
  | { kind: 'limit'; value: number }
  | { kind: 'order'; field: 'createdAt'; direction: 'desc' };
type SyntheticReference = { path: string; constraints?: SyntheticConstraint[] };
export function collection(db: unknown, ...segments: string[]): SyntheticReference {
  if (db !== syntheticDb) throw new Error('Only the synthetic fixture database is allowed');
  return { path: segments.join('/') };
}
export const doc = collection;
export const addDoc = (ref: SyntheticReference, data: Record<string, unknown>) =>
  queueSyntheticWrite(ref.path, data);
export const serverTimestamp = () => ({ syntheticServerTimestamp: true });

function unexpectedReadOrWrite(): never {
  throw new Error('Unexpected Firestore operation in the isolated task-flow fixture');
}
function assertReadableCollection(ref: SyntheticReference) {
  if (!['schools/pu/courseReviews', 'schools/pu/studyGroups'].includes(ref.path)) {
    unexpectedReadOrWrite();
  }
}
export function limit(value: number): SyntheticConstraint {
  if (![50, 60, 80].includes(value)) unexpectedReadOrWrite();
  return { kind: 'limit', value };
}
export function orderBy(field: string, direction: string): SyntheticConstraint {
  if (field !== 'createdAt' || direction !== 'desc') unexpectedReadOrWrite();
  return { kind: 'order', field: 'createdAt', direction: 'desc' };
}
export function query(ref: SyntheticReference, ...constraints: SyntheticConstraint[]) {
  assertReadableCollection(ref);
  return { ...ref, constraints };
}
export async function getDocs(ref: SyntheticReference) {
  assertReadableCollection(ref);
  const maximum = ref.constraints?.find((constraint) => constraint.kind === 'limit')?.value;
  const rows = taskFlowWrites
    .snapshot()
    .filter((row) => row.path === ref.path && row.status === 'succeeded');
  if (ref.constraints?.some((constraint) => constraint.kind === 'order')) rows.reverse();
  return {
    docs: rows.slice(0, maximum).map((row) => ({
      id: row.id,
      data: () => structuredClone(row.data),
    })),
  };
}
// Imports of unmounted product sections still resolve, but any unexpected
// access fails loudly. Only the two mounted parents can read synthetic writes;
// there is no server connection or permissive catch-all empty result.
export const arrayUnion = unexpectedReadOrWrite;
export const arrayRemove = unexpectedReadOrWrite;
export const deleteDoc = unexpectedReadOrWrite;
export const getDoc = unexpectedReadOrWrite;
export const getDocFromServer = unexpectedReadOrWrite;
export const getDocsFromServer = unexpectedReadOrWrite;
export const increment = unexpectedReadOrWrite;
export const runTransaction = unexpectedReadOrWrite;
export const setDoc = unexpectedReadOrWrite;
export const updateDoc = unexpectedReadOrWrite;
export const where = unexpectedReadOrWrite;
export const writeBatch = unexpectedReadOrWrite;
