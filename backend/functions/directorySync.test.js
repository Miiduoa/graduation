'use strict';

const { FieldPath } = require('firebase-admin/firestore');
const { loadSchoolMembershipDocs, syncDirectoryEntriesForUser } = require('./directorySync');

function documentIdError(uid) {
  return new Error(
    `Invalid query. When querying a collection group by FieldPath.documentId(), the value provided must result in a valid document path, but '${uid}' is not a valid document path because it has an odd number of segments.`,
  );
}

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const queries = [];

  function snapshotFor(path) {
    return {
      id: path.split('/').at(-1),
      ref: { path, parent: { parent: { id: path.split('/')[1] } } },
      exists: docs.has(path),
      data: () => docs.get(path),
    };
  }

  function collection(collectionPath) {
    return {
      path: collectionPath,
      doc(id) {
        const path = `${collectionPath}/${id}`;
        return {
          path,
          id,
          collection: (name) => collection(`${path}/${name}`),
          async get() {
            return snapshotFor(path);
          },
          async set(data, options) {
            docs.set(path, options?.merge ? { ...docs.get(path), ...data } : data);
          },
          async delete() {
            docs.delete(path);
          },
        };
      },
      async get() {
        const prefix = `${collectionPath}/`;
        const rows = [...docs.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => snapshotFor(key));
        return { docs: rows };
      },
    };
  }

  return {
    docs,
    queries,
    collection,
    collectionGroup(name) {
      return {
        where(field, op, value) {
          queries.push({ name, field, op, value });
          const documentId = FieldPath.documentId();
          const isDocumentId =
            field === documentId ||
            (typeof field?.isEqual === 'function' && field.isEqual(documentId)) ||
            String(field) === String(documentId);
          if (isDocumentId) throw documentIdError(value);
          throw new Error(`unexpected collectionGroup query ${name}`);
        },
      };
    },
  };
}

test('collection-group documentId equality is the error permission sync used to hit', () => {
  const db = fakeDb();
  expect(() => db.collectionGroup('members').where(FieldPath.documentId(), '==', 'alice')).toThrow(
    /odd number of segments/,
  );
});

test('permission sync loads school members by document path instead of collectionGroup documentId', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/nthu': { name: 'NTHU' },
    'schools/pu/members/alice': { status: 'active', role: 'member' },
    'groups/g1/members/alice': { status: 'active' },
  });

  const memberships = await loadSchoolMembershipDocs(db, 'alice');
  expect(db.queries).toEqual([]);
  expect(memberships).toEqual([
    { schoolId: 'pu', exists: true, membership: { status: 'active', role: 'member' } },
    { schoolId: 'nthu', exists: false, membership: null },
  ]);
});

test('permission sync writes the member directory without a documentId query', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/nthu': { name: 'NTHU' },
    'users/alice': { displayName: 'Alice', department: 'CS' },
    'schools/pu/members/alice': { status: 'active', role: 'member' },
    'schools/nthu/members/alice': { status: 'inactive', role: 'member' },
    'schools/nthu/directory/alice': { displayName: 'stale' },
  });

  await syncDirectoryEntriesForUser(db, 'alice', { displayName: 'Alice', department: 'CS' });

  expect(db.queries).toEqual([]);
  expect(db.docs.get('schools/pu/directory/alice')).toMatchObject({
    displayName: 'Alice',
    department: 'CS',
    updatedBy: 'system-sync',
  });
  expect(db.docs.has('schools/nthu/directory/alice')).toBe(false);
});
