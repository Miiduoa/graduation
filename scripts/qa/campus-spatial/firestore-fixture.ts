/** Network boundary only: production parsing, lookup, MapClient and scenes stay in use. */
type Query = { path: string[]; filters?: unknown[] };
export const collection = (_db: unknown, ...path: string[]): Query => ({ path });
export const doc = collection;
export const where = (...parts: unknown[]) => parts;
export const query = (source: Query, ...filters: unknown[]) => ({ ...source, filters });
export const serverTimestamp = () => { throw new Error('Fixture must not write data'); };
export const runTransaction = serverTimestamp;

export async function getDocsFromServer(source: Query) {
  const schoolId = source.path[0] === 'schools' ? source.path[1] : '';
  const records = schoolId === 'qa-campus' ? [
    { id: 'qa-east', name: '測試教學大樓', description: '測試候選：東側', category: 'building', lat: 24.225, lng: 120.580 },
    { id: 'qa-west', name: '測試教學大樓', description: '測試候選：西側', category: 'building', lat: 24.225, lng: 120.582 },
  ] : [];
  const docs = records.map(({ id, ...record }) => ({ id, data: () => ({ ...record, schoolId }) }));
  return { empty: docs.length === 0, docs };
}
