// The original navigation fixture stays unchanged. Reuse its routing/account
// boundaries, and add only an isolated synthetic Firestore handle for this suite.
export { default } from './boundaries';
export * from './boundaries';

type WriteKind = 'review' | 'group';
type WriteRecord = {
  id: string;
  kind: WriteKind;
  path: string;
  data: Record<string, unknown>;
  status: 'pending' | 'succeeded' | 'failed';
};
const writes: WriteRecord[] = [];
const pending = new Map<
  string,
  { resolve: (value: { id: string }) => void; reject: (error: Error) => void }
>();
export const syntheticDb = Object.freeze({ syntheticTaskFlowDatabase: true });
export const getDb = () => syntheticDb;
export const browserUpload = () => {
  throw new Error('Uploads are not allowed in the task-flow fixture');
};

export function queueSyntheticWrite(path: string, data: Record<string, unknown>) {
  const kind =
    path === 'schools/pu/courseReviews'
      ? 'review'
      : path === 'schools/pu/studyGroups'
        ? 'group'
        : null;
  if (!kind) throw new Error(`Unexpected synthetic collection: ${path}`);
  const id = `synthetic-write-${writes.length + 1}`;
  writes.push({ id, kind, path, data: structuredClone(data), status: 'pending' });
  return new Promise<{ id: string }>((resolve, reject) => pending.set(id, { resolve, reject }));
}

export const taskFlowWrites = {
  snapshot: () => structuredClone(writes),
  settle(kind: WriteKind, success: boolean) {
    const record = writes.find((write) => write.kind === kind && write.status === 'pending');
    if (!record) throw new Error(`No pending synthetic ${kind} write`);
    const action = pending.get(record.id)!;
    pending.delete(record.id);
    record.status = success ? 'succeeded' : 'failed';
    if (success) action.resolve({ id: record.id });
    else action.reject(new Error('Synthetic offline failure; no production write attempted'));
  },
};
