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
} = require('./campusStoryAccessBinding');

const FieldValue = {
  delete: () => ({ _delete: true }),
};

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];

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
            writes.push(path);
            docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data });
          },
          async update(data) {
            if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`);
            writes.push(path);
            const current = { ...docs.get(path) };
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

test('only a single active membership is bind evidence; extra fields are ignored', () => {
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'bob',
      membership: { status: 'active' },
      profileExists: true,
      profile: { displayName: 'Rebuilt', role: 'student', bio: 'I belong here' },
    }).kind,
  ).toBe('bind-candidate');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'dana',
      membership: { status: 'active' },
      profileExists: true,
      profile: { status: 'active', displayName: 'Dana' },
    }).kind,
  ).toBe('bind-candidate');
  expect(
    classifyCampusStoryBinding({
      schoolId: 'pu',
      uid: 'old',
      membership: { role: 'member' },
      profileExists: true,
      profile: { status: 'active', bio: 'legacy' },
    }).kind,
  ).toBe('insufficient-evidence');
});

test('dry-run plans bindings without writing; apply re-reads and reverse restores matching values', async () => {
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
    'bind-candidate': 2,
    'orphan-membership': 1,
  });
  const dry = await applyCampusStoryAccessBinding({ db, plan, apply: false });
  expect(db.docs.get('users/dana')).toEqual({ status: 'active', displayName: 'Dana' });
  expect(dry.applied).toHaveLength(0);

  const written = await applyCampusStoryAccessBinding({ db, plan, apply: true });
  expect(db.docs.get('users/dana')).toMatchObject({ schoolId: 'pu', primarySchoolId: 'pu' });
  expect(db.docs.get('users/bob')).toMatchObject({ schoolId: 'pu', primarySchoolId: 'pu' });
  expect(db.docs.get('schools/pu/members/dana').profileBoundSchoolId).toBe('pu');

  await reverseCampusStoryAccessBinding({
    db,
    FieldValue,
    backup: { projectId: 'demo-campus-security', entries: written.backup },
    projectId: 'demo-campus-security',
    apply: true,
  });
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  expect(db.docs.get('users/dana').primarySchoolId).toBeUndefined();
  expect(db.docs.get('schools/pu/members/dana').profileBoundSchoolId).toBeUndefined();
});

test('deleted profiles are not recreated by merge during apply', async () => {
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/ghost': { status: 'active' },
    'users/ghost': { status: 'active', displayName: 'Ghost' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  db.docs.delete('users/ghost');
  const written = await applyCampusStoryAccessBinding({ db, plan, apply: true });
  expect(db.docs.has('users/ghost')).toBe(false);
  expect(written.applied.every((row) => row.path !== 'users/ghost')).toBe(true);
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
    projectId: 'demo-campus-security',
  });
  expect(db.docs.get('schools/pu/members/ghost').status).toBe('active');
});

test('reverse skips values that no longer match what the script wrote', async () => {
  const db = fakeDb({
    'users/dana': { status: 'active', schoolId: 'other', primarySchoolId: 'pu' },
  });
  const result = await reverseCampusStoryAccessBinding({
    db,
    FieldValue,
    projectId: 'demo-campus-security',
    backup: {
      projectId: 'demo-campus-security',
      entries: [
        {
          op: 'bind-profile',
          path: 'users/dana',
          before: { schoolId: null, primarySchoolId: null },
          after: { schoolId: 'pu', primarySchoolId: 'pu' },
        },
      ],
    },
    apply: true,
  });
  expect(result.restored).toEqual([{ path: 'users/dana', fields: ['primarySchoolId'] }]);
  expect(db.docs.get('users/dana')).toEqual({ status: 'active', schoolId: 'other' });
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

test('binding CLI writes the backup before the database and reverse dry-run does not write', async () => {
  const { runCli } = require('../../scripts/bind-campus-story-profile-schools.cjs');
  const db = fakeDb({
    'schools/pu': { name: 'PU' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana' },
  });
  const files = new Map();
  const dry = await runCli(['--project', 'demo-campus-security'], { db, FieldValue });
  expect(dry.mode).toBe('dry-run');
  expect(dry.counts['bind-candidate']).toBe(1);
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
  await expect(runCli(['--project', 'demo-campus-security', '--apply'], { db, FieldValue })).rejects.toThrow(
    /backup-file/,
  );

  let writesAtBackup = null;
  await runCli(['--project', 'demo-campus-security', '--apply', '--backup-file', 'backup.json'], {
    db,
    FieldValue,
    writeFile: (file, data) => {
      writesAtBackup = db.writes.length;
      files.set(file, data);
    },
  });
  expect(writesAtBackup).toBe(0);
  expect(db.writes.length).toBeGreaterThan(0);
  expect(files.get('backup.json').projectId).toBe('demo-campus-security');

  db.docs.get('users/dana').schoolId = 'changed';
  const reverseDry = await runCli(
    ['--project', 'demo-campus-security', '--reverse', '--backup-file', 'backup.json'],
    {
      db,
      FieldValue,
      readFile: (file) => files.get(file),
    },
  );
  expect(reverseDry.mode).toBe('reverse-dry-run');
  expect(db.docs.get('users/dana').schoolId).toBe('changed');
  await expect(
    runCli(['--project', 'other-campus-project', '--reverse', '--backup-file', 'backup.json'], {
      db,
      FieldValue,
      readFile: (file) => files.get(file),
    }),
  ).rejects.toThrow(/project/);
});

test('unbound profiles with more than one active school are left for review', async () => {
  const db = fakeDb({
    'schools/other': { name: 'Other' },
    'schools/pu': { name: 'PU' },
    'schools/other/members/dana': { status: 'active' },
    'schools/pu/members/dana': { status: 'active' },
    'users/dana': { status: 'active', displayName: 'Dana', bio: 'two schools' },
  });
  const plan = planCampusStoryAccessBinding(await loadCampusMembershipRows(db));
  expect(summarizeBindingPlan(plan)).toEqual({ 'multi-school-unbound': 2 });
  const written = await applyCampusStoryAccessBinding({ db, plan, apply: true });
  expect(written.applied).toHaveLength(0);
  expect(db.docs.get('users/dana').schoolId).toBeUndefined();
});

test('missing canonical profiles inactivate leftover school memberships only if still missing', async () => {
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

  db.docs.set('users/legacy', { displayName: 'Rebuilt' });
  const skipped = await inactivateLeftoverSchoolMemberships({
    db,
    uid: 'legacy',
    loadMemberships: async () => [
      { schoolId: 'pu', exists: true, membership: { status: 'active' } },
    ],
  });
  expect(skipped).toEqual([]);
});
