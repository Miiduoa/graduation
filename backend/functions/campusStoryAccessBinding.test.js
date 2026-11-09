'use strict';

const {
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  summarizeBindingPlan,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
  loadCampusMembershipRows,
  clearProfileSchoolBindingForRevokedMembership,
  inactivateLeftoverSchoolMemberships,
  isRebuiltSuspect,
} = require('./campusStoryAccessBinding');

const FieldValue = {
  delete: () => ({ _delete: true }),
};

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));

  function snapshotFor(path) {
    return {
      id: path.split('/').at(-1),
      exists: docs.has(path),
      data: () => docs.get(path),
    };
  }

  function collection(collectionPath) {
    return {
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
            docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data });
          },
          async update(data) {
            const current = { ...(docs.get(path) || {}) };
            for (const [key, value] of Object.entries(data)) {
              if (value && value._delete) delete current[key];
              else current[key] = value;
            }
            docs.set(path, current);
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

  return { docs, collection };
}

test('client rebuilt student profiles are suspects and historical active profiles are bind candidates', () => {
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'bob',
      membership: { status: 'active' },
      profileExists: true,
      profile: { displayName: 'Rebuilt', role: 'student' },
    }).kind,
  ).toBe('rebuilt-suspect');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'dana',
      membership: { status: 'active' },
      profileExists: true,
      profile: { status: 'active', displayName: 'Dana' },
    }).kind,
  ).toBe('bind-candidate');
  expect(isRebuiltSuspect({ displayName: 'Rebuilt', role: 'student' })).toBe(true);
});

test('dry-run plans bindings without writing, apply writes school ids, reverse restores', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/dana': { status: 'active' },
    'schools/pu/members/bob': { status: 'active' },
    'schools/pu/members/ghost': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
    'users/bob': { displayName: 'Rebuilt', role: 'student' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  expect(summarizeBindingPlan(plan)).toEqual({
    'bind-candidate': 1,
    'rebuilt-suspect': 1,
    'orphan-membership': 1,
  });
  const dry = await applyCampusStoryAccessBinding({ db, plan, apply: false });
  expect(db.docs.get('users/dana')).toEqual({ status: 'active', displayName: 'Dana' });
  expect(dry.applied).toHaveLength(1);

  const written = await applyCampusStoryAccessBinding({ db, plan, apply: true });
  expect(db.docs.get('users/dana')).toMatchObject({ schoolId: 'pu', primarySchoolId: 'pu' });
  expect(db.docs.get('users/bob')).toEqual({ displayName: 'Rebuilt', role: 'student' });

  await reverseCampusStoryAccessBinding({
    db,
    FieldValue,
    backup: written.backup,
    apply: true,
  });
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  expect(db.docs.get('users/dana').primarySchoolId).toBeUndefined();
});

test('orphan inactivation is opt-in and reversible', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/ghost': { status: 'active', role: 'member' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  const dry = await applyCampusStoryAccessBinding({
    db,
    plan,
    apply: true,
    inactivateOrphans: true,
  });
  expect(db.docs.get('schools/pu/members/ghost').status).toBe('inactive');
  await reverseCampusStoryAccessBinding({
    db,
    FieldValue,
    backup: dry.backup,
    apply: true,
  });
  expect(db.docs.get('schools/pu/members/ghost').status).toBe('active');
});

test('revoked membership clears matching school binding and leaves other schools', async () => {
  const db = fakeDb({
    'users/alice': { status: 'active', schoolId: 'pu', primarySchoolId: 'other' },
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
  const leave = await clearProfileSchoolBindingForRevokedMembership({
    db,
    FieldValue,
    schoolId: 'other',
    uid: 'alice',
    membership: { status: 'active' },
  });
  expect(leave).toEqual({ action: 'leave-profile' });
  expect(db.docs.get('users/alice').primarySchoolId).toBe('other');
  const deleted = await clearProfileSchoolBindingForRevokedMembership({
    db,
    FieldValue,
    schoolId: 'other',
    uid: 'alice',
    membership: null,
  });
  expect(deleted).toEqual({ action: 'cleared-binding', fields: ['primarySchoolId'] });
  expect(db.docs.get('users/alice')).toEqual({ status: 'active' });
});

test('binding CLI dry-run does not write and apply requires a backup file', async () => {
  const { runCli } = require('../../scripts/bind-campus-story-profile-schools.cjs');
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
  });
  const dry = await runCli(['--project', 'demo-campus-security'], {
    db,
    FieldValue,
  });
  expect(dry.mode).toBe('dry-run');
  expect(dry.counts['bind-candidate']).toBe(1);
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  await expect(runCli(['--project', 'demo-campus-security', '--apply'], { db, FieldValue })).rejects.toThrow(
    /backup-file/,
  );
});

test('unbound profiles with more than one active school are left for review', async () => {
  const db = fakeDb({
    'schools/other': { name: 'Other' },
    'schools/pu': { name: 'PU' },
    'schools/other/members/dana': { status: 'active' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  expect(summarizeBindingPlan(plan)).toEqual({ 'multi-school-unbound': 2 });
  const written = await applyCampusStoryAccessBinding({ db, plan, apply: true });
  expect(written.applied).toHaveLength(0);
  expect(db.docs.get('users/dana')).toEqual({ status: 'active', displayName: 'Dana' });
});

test('missing canonical profiles inactivate leftover school memberships', async () => {
  const db = fakeDb({
    'schools/pu/members/bob': { status: 'active' },
    'schools/other/members/bob': { status: 'inactive' },
  });
  const changed = await inactivateLeftoverSchoolMemberships({
    db,
    uid: 'bob',
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
      { schoolId: 'other', exists: true, membership: { status: 'inactive' } },
    ],
  });
  expect(changed).toEqual(['pu']);
  expect(db.docs.get('schools/pu/members/bob').status).toBe('inactive');
  expect(db.docs.get('schools/other/members/bob').status).toBe('inactive');

  const skipped = await inactivateLeftoverSchoolMemberships({
    db,
    uid: 'legacy',
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { role: 'member' } },
    ],
  });
  expect(skipped).toEqual([]);
});
