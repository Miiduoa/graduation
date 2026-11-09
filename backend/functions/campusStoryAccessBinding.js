'use strict';

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

function membershipBoundToSchool(membership, schoolId) {
  return membership?.status === 'active' && membership?.profileBoundSchoolId === schoolId;
}

function classifyCampusStoryBinding({ schoolId, uid, membership, profile, profileExists }) {
  const base = { schoolId, uid, membership, profile, profileExists };
  if (membership?.status !== 'active') {
    return {
      ...base,
      kind: membership?.status ? 'inactive-membership' : 'insufficient-evidence',
    };
  }
  if (!profileExists) {
    return { ...base, kind: 'orphan-membership' };
  }
  if (isClosedAccount(profile)) {
    return { ...base, kind: 'closed-profile' };
  }
  if (profileBoundToSchool(profile, schoolId)) {
    return {
      ...base,
      kind: membershipBoundToSchool(membership, schoolId)
        ? 'already-bound'
        : 'stamp-membership-binding',
    };
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
    if (item.kind === 'inactive-membership' || item.kind === 'insufficient-evidence') continue;
    const schools = activeSchoolsByUid.get(item.uid) || new Set();
    schools.add(item.schoolId);
    activeSchoolsByUid.set(item.uid, schools);
  }
  return classified.map((item) => {
    if (
      item.kind !== 'bind-candidate' &&
      item.kind !== 'stamp-membership-binding'
    ) {
      return item;
    }
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

function buildCampusStoryAccessBackup(plan, { inactivateOrphans = false } = {}) {
  const backup = [];
  for (const item of plan) {
    if (item.kind === 'bind-candidate') {
      backup.push({
        op: 'bind-profile',
        path: `users/${item.uid}`,
        memberPath: `schools/${item.schoolId}/members/${item.uid}`,
        schoolId: item.schoolId,
        before: {
          schoolId: item.profile?.schoolId ?? null,
          primarySchoolId: item.profile?.primarySchoolId ?? null,
        },
        after: bindingWrite(item.schoolId, item.profile),
      });
      backup.push({
        op: 'stamp-membership-binding',
        path: `schools/${item.schoolId}/members/${item.uid}`,
        before: { profileBoundSchoolId: item.membership?.profileBoundSchoolId ?? null },
        after: { profileBoundSchoolId: item.schoolId },
      });
      continue;
    }
    if (item.kind === 'stamp-membership-binding') {
      backup.push({
        op: 'stamp-membership-binding',
        path: `schools/${item.schoolId}/members/${item.uid}`,
        before: { profileBoundSchoolId: item.membership?.profileBoundSchoolId ?? null },
        after: { profileBoundSchoolId: item.schoolId },
      });
      continue;
    }
    if (inactivateOrphans && item.kind === 'orphan-membership') {
      backup.push({
        op: 'inactivate-orphan',
        path: `schools/${item.schoolId}/members/${item.uid}`,
        before: { status: item.membership?.status ?? null },
        after: { status: 'inactive' },
      });
    }
  }
  return backup;
}

function missingField(value) {
  return value == null;
}

function sameField(current, expected) {
  if (missingField(expected)) return missingField(current);
  return current === expected;
}

async function applyCampusStoryAccessBinding({ db, plan, apply = false, inactivateOrphans = false }) {
  const backup = buildCampusStoryAccessBackup(plan, { inactivateOrphans });
  const applied = [];
  if (!apply) return { backup, applied, apply };
  for (const item of backup) {
    const result = await applyBackupEntry(db, item);
    if (result.applied) applied.push(result);
  }
  return { backup, applied, apply };
}

function schoolAndUidFromMemberPath(path) {
  const parts = path.split('/');
  return { schoolId: parts[1], uid: parts[3] };
}

async function applyBackupEntry(db, item) {
  return db.runTransaction(async (tx) => {
    if (item.op === 'bind-profile') {
      const userRef = docFromPath(db, item.path);
      const memberRef = docFromPath(db, item.memberPath);
      const [userSnap, memberSnap] = await tx.getAll(userRef, memberRef);
      if (!userSnap.exists) return { applied: false, reason: 'missing-profile', path: item.path };
      const profile = userSnap.data() || {};
      if (isClosedAccount(profile)) return { applied: false, reason: 'closed-profile', path: item.path };
      if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      tx.update(userRef, item.after);
      return { applied: true, kind: item.op, path: item.path, schoolId: item.schoolId };
    }
    if (item.op === 'stamp-membership-binding') {
      const { schoolId, uid } = schoolAndUidFromMemberPath(item.path);
      const memberRef = docFromPath(db, item.path);
      const userRef = db.collection('users').doc(uid);
      const [userSnap, memberSnap] = await tx.getAll(userRef, memberRef);
      if (!userSnap.exists || isClosedAccount(userSnap.data() || {})) {
        return { applied: false, reason: 'missing-profile', path: item.path };
      }
      if (!profileBoundToSchool(userSnap.data() || {}, schoolId)) {
        return { applied: false, reason: 'unbound-profile', path: item.path };
      }
      if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      tx.update(memberRef, item.after);
      return { applied: true, kind: item.op, path: item.path };
    }
    if (item.op === 'inactivate-orphan') {
      const memberRef = docFromPath(db, item.path);
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) return { applied: false, reason: 'missing-membership', path: item.path };
      tx.update(memberRef, item.after);
      return { applied: true, kind: item.op, path: item.path };
    }
    return { applied: false, reason: 'unknown-op', path: item.path };
  });
}

function restoreFields(current, before, after, FieldValue) {
  const next = {};
  for (const key of Object.keys(after)) {
    if (!sameField(current?.[key], after[key])) continue;
    next[key] = missingField(before?.[key]) ? FieldValue.delete() : before[key];
  }
  return next;
}

async function reverseCampusStoryAccessBinding({
  db,
  FieldValue,
  backup,
  apply = false,
  projectId,
}) {
  const entries = Array.isArray(backup) ? backup : backup.entries || [];
  const backupProjectId = backup.projectId;
  if (backupProjectId && projectId && backupProjectId !== projectId) {
    throw new Error('Backup project does not match --project');
  }
  const restored = [];
  const skipped = [];
  for (const item of [...entries].reverse()) {
    const ref = docFromPath(db, item.path);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push({ path: item.path, reason: 'missing' });
      continue;
    }
    const current = snap.data() || {};
    const next = restoreFields(current, item.before, item.after, FieldValue);
    if (Object.keys(next).length === 0) {
      skipped.push({ path: item.path, reason: 'current-mismatch' });
      continue;
    }
    restored.push({ path: item.path, fields: Object.keys(next) });
    if (apply) await ref.update(next);
  }
  return { restored, skipped, apply };
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
  const profileSnap = await db.collection('users').doc(uid).get();
  if (profileSnap.exists) return [];
  const memberships = await loadMemberships(uid);
  const changed = [];
  for (const item of memberships) {
    if (!item.exists) continue;
    if (item.membership?.status !== 'active') continue;
    const again = await db.collection('users').doc(uid).get();
    if (again.exists) return changed;
    await db.collection('schools').doc(item.schoolId).collection('members').doc(uid).set(
      { status: 'inactive' },
      { merge: true },
    );
    changed.push(item.schoolId);
  }
  return changed;
}

module.exports = {
  isClosedAccount,
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  loadCampusMembershipRows,
  summarizeBindingPlan,
  buildCampusStoryAccessBackup,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
  clearProfileSchoolBindingForRevokedMembership,
  inactivateLeftoverSchoolMemberships,
};
