'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  summarizeBindingPlan,
  loadCampusMembershipRows,
  closeCampusStoryAccess,
  clearProfileSchoolBindingForRevokedMembership,
  revokeCampusStoryMembershipBinding,
  uniqueStoryStorageFirestoreDocs,
} = require('./campusStoryAccessBinding');

const FieldValue = {
  delete: () => ({ _delete: true }),
};

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];

  function snapshotFor(docPath) {
    return {
      id: docPath.split('/').at(-1),
      exists: docs.has(docPath),
      data: () => docs.get(docPath),
    };
  }

  function collection(collectionPath) {
    return {
      doc(id) {
        const docPath = `${collectionPath}/${id}`;
        return {
          path: docPath,
          id,
          collection: (name) => collection(`${docPath}/${name}`),
          async get() {
            return snapshotFor(docPath);
          },
          async set(data, options) {
            writes.push(docPath);
            docs.set(docPath, options?.merge ? { ...docs.get(docPath), ...data } : { ...data });
          },
          async update(data) {
            if (!docs.has(docPath)) throw new Error(`NOT_FOUND ${docPath}`);
            writes.push(docPath);
            const current = { ...docs.get(docPath) };
            for (const [key, value] of Object.entries(data)) {
              if (value && value._delete) delete current[key];
              else current[key] = value;
            }
            docs.set(docPath, current);
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
    writes,
    collection,
    async runTransaction(callback) {
      return callback({
        get: async (ref) => ref.get(),
        getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())),
        update: (ref, data) => ref.update(data),
        set: (ref, data, options) => ref.set(data, options),
      });
    },
  };
}

test('story storage match reads at most two Firestore documents and requires a generation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../storage/storage.rules'), 'utf8');
  const docs = uniqueStoryStorageFirestoreDocs(source);
  expect(docs).toEqual([
    'campusStories/$(storyId)',
    'schools/$(schoolId)/members/$(request.auth.uid)',
  ]);
  const storyMatch = source.match(
    /match \/schools\/\{schoolId\}\/stories\/\{storyId\}\/\{fileName\} \{([\s\S]*?)\n {4}match \//,
  );
  expect(storyMatch[1]).not.toContain('users/$(request.auth.uid)');
  expect(storyMatch[1]).not.toContain('hasCanonicalActiveAccount');
  expect(storyMatch[1]).toContain('profileBoundGeneration');
});

test('dry-run only classifies current stamps; rebuilt stubs need another school login', () => {
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'bob',
      membership: { status: 'active', lastLoginAt: '2026-01-10T00:00:00.000Z', profileBoundSchoolId: 'pu' },
      profileExists: true,
      profile: { displayName: 'Rebuilt', role: 'student', createdAt: '2026-11-09T00:00:00.000Z' },
    }).kind,
  ).toBe('needs-login');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'bound',
      membership: {
        status: 'active',
        profileBoundSchoolId: 'pu',
        profileBoundGeneration: 'gen-login',
      },
      profileExists: true,
      profile: { status: 'active', displayName: 'Bound' },
    }).kind,
  ).toBe('already-bound');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'dana',
      membership: { status: 'active', lastLoginAt: '2026-01-10T00:00:00.000Z' },
      profileExists: true,
      profile: { status: 'active', displayName: 'Dana' },
    }).kind,
  ).toBe('needs-login');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'old',
      membership: { role: 'member' },
      profileExists: true,
      profile: { status: 'active' },
    }).kind,
  ).toBe('insufficient-evidence');
});

test('binding plan is dry-run statistics only', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/dana': { status: 'active', lastLoginAt: '2026-01-10T00:00:00.000Z' },
    'schools/pu/members/bob': { status: 'active', profileBoundSchoolId: 'pu' },
    'schools/pu/members/ghost': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
    'users/bob': { displayName: 'Rebuilt', role: 'student' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  expect(summarizeBindingPlan(plan)).toEqual({
    'needs-login': 2,
    'orphan-membership': 1,
  });
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  expect(db.docs.get('schools/pu/members/bob').profileBoundSchoolId).toBe('pu');
});

test('revoked membership clears matching school binding unless the live membership is active again', async () => {
  const db = fakeDb({
    'users/alice': { status: 'active', schoolId: 'pu', primarySchoolId: 'other' },
    'schools/pu/members/alice': { status: 'inactive' },
  });
  const cleared = await clearProfileSchoolBindingForRevokedMembership({
    db,
    FieldValue,
    schoolId: 'pu',
    uid: 'alice',
    membership: { status: 'inactive' },
  });
  expect(cleared).toEqual({ action: 'cleared-binding', fields: ['schoolId'] });
  expect(db.docs.get('users/alice')).toEqual({ status: 'active', primarySchoolId: 'other' });

  db.docs.set('schools/other/members/alice', { status: 'active', profileBoundSchoolId: 'other' });
  const leave = await clearProfileSchoolBindingForRevokedMembership({
    db,
    FieldValue,
    schoolId: 'other',
    uid: 'alice',
    membership: { status: 'inactive' },
  });
  expect(leave).toEqual({ action: 'leave-profile' });
  expect(db.docs.get('users/alice').primarySchoolId).toBe('other');
});

test('binding CLI is dry-run only and rejects write flags', async () => {
  const { runCli, parseCli } = require('../../scripts/bind-campus-story-profile-schools.cjs');
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
  });
  const dry = await runCli(['--project', 'demo-campus-security'], { db, FieldValue });
  expect(dry.mode).toBe('dry-run');
  expect(dry.counts['needs-login']).toBe(1);
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  expect(() => parseCli(['--project', 'demo-campus-security', '--apply'])).toThrow();
  expect(() => parseCli(['--project', 'demo-campus-security', '--reverse'])).toThrow();
  await expect(
    runCli(['--project', 'demo-campus-security', '--apply'], { db, FieldValue }),
  ).rejects.toThrow();
  await expect(
    runCli(['--project', 'demo-campus-security', '--reverse', '--apply'], { db, FieldValue }),
  ).rejects.toThrow();
});

test('unbound profiles with more than one active school are left as needs-login', async () => {
  const db = fakeDb({
    'schools/other': { name: 'Other' },
    'schools/pu': { name: 'PU' },
    'schools/other/members/dana': { status: 'active' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  expect(summarizeBindingPlan(plan)).toEqual({ 'needs-login': 2 });
});

test('closing an account inactivates leftover stamps in the same transaction as the user update', async () => {
  const db = fakeDb({
    'users/bob': { status: 'active' },
    'schools/pu/members/bob': {
      status: 'active',
      profileBoundSchoolId: 'pu',
      profileBoundGeneration: 'gen-old',
    },
    'schools/other/members/bob': { status: 'inactive', profileBoundSchoolId: 'other' },
  });
  const changed = await closeCampusStoryAccess({
    db,
    uid: 'bob',
    FieldValue,
    userUpdate: { accountDeletionInProgress: true },
    memberRefs: [
      db.collection('schools').doc('pu').collection('members').doc('bob'),
      db.collection('schools').doc('other').collection('members').doc('bob'),
    ],
  });
  expect(changed).toEqual(['schools/pu/members/bob', 'schools/other/members/bob']);
  expect(db.docs.get('users/bob')).toEqual({ status: 'active', accountDeletionInProgress: true });
  expect(db.docs.get('schools/pu/members/bob')).toEqual({ status: 'inactive' });
  expect(db.docs.get('schools/other/members/bob')).toEqual({ status: 'inactive' });
});

test('profile delete or closed status clears leftover stamps in one transaction', async () => {
  const db = fakeDb({
    'schools/pu/members/bob': {
      status: 'active',
      profileBoundSchoolId: 'pu',
      profileBoundGeneration: 'gen-old',
    },
    'schools/other/members/bob': { status: 'inactive' },
  });
  const changed = await revokeCampusStoryMembershipBinding({
    db,
    uid: 'bob',
    FieldValue,
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
      { schoolId: 'other', exists: true, membership: { status: 'inactive' } },
    ],
  });
  expect(changed).toEqual(['pu']);
  expect(db.docs.get('schools/pu/members/bob')).toEqual({ status: 'active' });

  db.docs.set('users/legacy', { displayName: 'Rebuilt', role: 'student' });
  db.docs.set('schools/pu/members/legacy', {
    status: 'active',
    profileBoundSchoolId: 'pu',
    profileBoundGeneration: 'gen-old',
  });
  const rebuilt = await revokeCampusStoryMembershipBinding({
    db,
    uid: 'legacy',
    FieldValue,
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
    ],
  });
  expect(rebuilt).toEqual(['pu']);
  expect(db.docs.get('schools/pu/members/legacy').profileBoundSchoolId).toBeUndefined();

  db.docs.set('users/live', { status: 'active', bindingGeneration: 'gen-new' });
  db.docs.set('schools/pu/members/live', {
    status: 'active',
    profileBoundSchoolId: 'pu',
    profileBoundGeneration: 'gen-new',
  });
  const kept = await revokeCampusStoryMembershipBinding({
    db,
    uid: 'live',
    FieldValue,
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
    ],
  });
  expect(kept).toEqual([]);
  expect(db.docs.get('schools/pu/members/live').profileBoundSchoolId).toBe('pu');

  db.docs.set('users/suspended', { status: 'suspended', bindingGeneration: 'gen-new' });
  db.docs.set('schools/pu/members/suspended', {
    status: 'active',
    profileBoundSchoolId: 'pu',
    profileBoundGeneration: 'gen-new',
  });
  const closed = await revokeCampusStoryMembershipBinding({
    db,
    uid: 'suspended',
    FieldValue,
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
    ],
  });
  expect(closed).toEqual(['pu']);
  expect(db.docs.get('schools/pu/members/suspended').profileBoundSchoolId).toBeUndefined();
  expect(db.docs.get('schools/pu/members/live').profileBoundSchoolId).toBe('pu');
});
