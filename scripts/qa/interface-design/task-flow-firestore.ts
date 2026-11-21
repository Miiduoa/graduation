import { queueSyntheticWrite, syntheticDb } from './task-flow-boundaries';

type SyntheticReference = { path: string };
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
// Imports of unmounted product sections still resolve, but any unexpected
// access fails loudly. No server connection or permissive empty result exists.
export const arrayUnion = unexpectedReadOrWrite;
export const arrayRemove = unexpectedReadOrWrite;
export const deleteDoc = unexpectedReadOrWrite;
export const getDoc = unexpectedReadOrWrite;
export const getDocFromServer = unexpectedReadOrWrite;
export const getDocs = unexpectedReadOrWrite;
export const increment = unexpectedReadOrWrite;
export const limit = unexpectedReadOrWrite;
export const orderBy = unexpectedReadOrWrite;
export const query = unexpectedReadOrWrite;
export const runTransaction = unexpectedReadOrWrite;
export const setDoc = unexpectedReadOrWrite;
export const updateDoc = unexpectedReadOrWrite;
export const where = unexpectedReadOrWrite;
export const writeBatch = unexpectedReadOrWrite;
