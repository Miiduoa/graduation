'use strict';

const REBUILT_STUB_KEYS = new Set([
  'displayName',
  'role',
  'createdAt',
  'email',
  'department',
  'photoURL',
  'avatarUrl',
  'updatedAt',
]);

function isClosedAccount(profile) {
  if (!profile) return false;
  return (
    profile.accountDeletionInProgress === true ||
    ['deleted', 'disabled', 'suspended', 'inactive'].includes(profile.status)
  );
}

function profileBoundToSchool(profile, schoolId) {
  return profile?.schoolId === schoolId || profile?.primarySchoolId === schoolId;
}

function isRebuiltSuspect(profile) {
  if (!profile) return false;
  const keys = Object.keys(profile);
  if (keys.length === 0) return true;
  return (
    keys.every((key) => REBUILT_STUB_KEYS.has(key)) &&
    (profile.role == null || profile.role === 'student')
  );
}

function classifyCampusStoryBinding({ schoolId, uid, membership, profile, profileExists }) {
  const memberStatus = membership?.status;
  const base = { schoolId, uid, membership, profile };
  if (memberStatus && memberStatus !== 'active') {
    return { ...base, kind: 'inactive-membership' };
  }
  if (!profileExists) {
    return { ...base, kind: 'orphan-membership' };
  }
  if (isClosedAccount(profile)) {
    return { ...base, kind: 'closed-profile' };
  }
  if (profileBoundToSchool(profile, schoolId)) {
    return { ...base, kind: 'already-bound' };
  }
  if (isRebuiltSuspect(profile)) {
    return { ...base, kind: 'rebuilt-suspect' };
  }
  return { ...base, kind: 'bind-candidate' };
}

function bindingWrite(schoolId, profile) {
  return {
    schoolId: profile?.schoolId || schoolId,
    primarySchoolId: profile?.primarySchoolId || schoolId,
  };
}

function planCampusStoryAccessBinding(rows) {
  const classified = rows.map((row) => classifyCampusStoryBinding(row));
  const activeSchoolsByUid = new Map();
  for (const item of classified) {
    if (item.kind === 'inactive-membership' || item.kind === 'closed-profile') continue;
    const schools = activeSchoolsByUid.get(item.uid) || new Set();
    schools.add(item.schoolId);
    activeSchoolsByUid.set(item.uid, schools);
  }
  return classified.map((item) => {
    if (item.kind !== 'bind-candidate' && item.kind !== 'rebuilt-suspect') return item;
    if ((activeSchoolsByUid.get(item.uid) || new Set()).size > 1) {
      return { ...item, kind: 'multi-school-unbound' };
    }
    return item;
  });
}

function docFromPath(db, path) {
  const parts = path.split('/');
  let ref = db.collection(parts[0]).doc(parts[1]);
  for (let index = 2; index < parts.length; index += 2) {
    ref = ref.collection(parts[index]).doc(parts[index + 1]);
  }
  return ref;
}

async function loadCampusMembershipRows(db) {
  const schools = await db.collection('schools').get();
  const rows = [];
  for (const schoolDoc of schools.docs) {
    const members = await db.collection('schools').doc(schoolDoc.id).collection('members').get();
    for (const member of members.docs) {
      const userSnap = await db.collection('users').doc(member.id).get();
      rows.push({
        schoolId: schoolDoc.id,
        uid: member.id,
        membership: member.data() || {},
        profileExists: userSnap.exists,
        profile: userSnap.exists ? userSnap.data() || {} : null,
      });
    }
  }
  return rows;
}

function summarizeBindingPlan(plan) {
  const counts = {};
  for (const item of plan) {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  return counts;
}

async function applyCampusStoryAccessBinding({
  db,
  plan,
  apply = false,
  bindSuspects = false,
  inactivateOrphans = false,
}) {
  const backup = [];
  const applied = [];
  for (const item of plan) {
    if (item.kind === 'bind-candidate' || (bindSuspects && item.kind === 'rebuilt-suspect')) {
      const path = `users/${item.uid}`;
      const before = {
        schoolId: item.profile?.schoolId ?? null,
        primarySchoolId: item.profile?.primarySchoolId ?? null,
      };
      const after = bindingWrite(item.schoolId, item.profile);
      backup.push({ op: 'bind-profile', path, before, after });
      if (apply) {
        await db.collection('users').doc(item.uid).set(after, { merge: true });
      }
      applied.push({ kind: item.kind, path, schoolId: item.schoolId });
      continue;
    }
    if (inactivateOrphans && item.kind === 'orphan-membership') {
      const path = `schools/${item.schoolId}/members/${item.uid}`;
      const before = { status: item.membership?.status ?? null };
      const after = { status: 'inactive' };
      backup.push({ op: 'inactivate-orphan', path, before, after });
      if (apply) {
        await db.collection('schools').doc(item.schoolId).collection('members').doc(item.uid).set(
          after,
          { merge: true },
        );
      }
      applied.push({ kind: item.kind, path, schoolId: item.schoolId });
    }
  }
  return { backup, applied, apply };
}

async function reverseCampusStoryAccessBinding({ db, FieldValue, backup, apply = false }) {
  const restored = [];
  for (const item of [...backup].reverse()) {
    if (item.op === 'bind-profile') {
      const next = {};
      next.schoolId =
        item.before.schoolId == null ? FieldValue.delete() : item.before.schoolId;
      next.primarySchoolId =
        item.before.primarySchoolId == null ? FieldValue.delete() : item.before.primarySchoolId;
      if (apply) await docFromPath(db, item.path).update(next);
      restored.push(item.path);
      continue;
    }
    if (item.op === 'inactivate-orphan') {
      const next = {
        status: item.before.status == null ? FieldValue.delete() : item.before.status,
      };
      if (apply) await docFromPath(db, item.path).update(next);
      restored.push(item.path);
    }
  }
  return { restored, apply };
}

async function clearProfileSchoolBindingForRevokedMembership({ db, FieldValue, schoolId, uid, membership }) {
  const active = membership?.status === 'active';
  if (active) return { action: 'leave-profile' };
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) return { action: 'missing-profile' };
  const profile = snap.data() || {};
  const update = {};
  if (profile.schoolId === schoolId) update.schoolId = FieldValue.delete();
  if (profile.primarySchoolId === schoolId) update.primarySchoolId = FieldValue.delete();
  if (Object.keys(update).length === 0) return { action: 'no-matching-binding' };
  await userRef.update(update);
  return { action: 'cleared-binding', fields: Object.keys(update) };
}

async function inactivateLeftoverSchoolMemberships({ db, uid, loadMemberships }) {
  const memberships = await loadMemberships(uid);
  const changed = [];
  for (const item of memberships) {
    if (!item.exists) continue;
    if (item.membership?.status !== 'active') continue;
    await db.collection('schools').doc(item.schoolId).collection('members').doc(uid).set(
      { status: 'inactive' },
      { merge: true },
    );
    changed.push(item.schoolId);
  }
  return changed;
}

module.exports = {
  REBUILT_STUB_KEYS,
  isClosedAccount,
  isRebuiltSuspect,
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  loadCampusMembershipRows,
  summarizeBindingPlan,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
  clearProfileSchoolBindingForRevokedMembership,
  inactivateLeftoverSchoolMemberships,
};
