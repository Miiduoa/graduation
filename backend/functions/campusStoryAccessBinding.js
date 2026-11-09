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

function toMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasSchoolLoginEvidence(membership, profile) {
  if (!membership?.lastLoginAt || !profile?.lastLoginAt) return false;
  const created = toMillis(profile.createdAt);
  const joined = toMillis(membership.joinedAt) ?? toMillis(membership.lastLoginAt);
  if (created == null || joined == null) return false;
  return created <= joined;
}

function evidenceSnapshot(profile, membership) {
  return {
    schoolId: profile?.schoolId ?? null,
    primarySchoolId: profile?.primarySchoolId ?? null,
    createdAtMs: toMillis(profile?.createdAt),
    lastLoginAtMs: toMillis(profile?.lastLoginAt),
    memberLastLoginAtMs: toMillis(membership?.lastLoginAt),
    joinedAtMs: toMillis(membership?.joinedAt),
    status: membership?.status ?? null,
  };
}

function sameLoginEvidence(profile, membership, expected) {
  if (!expected) return false;
  const live = evidenceSnapshot(profile, membership);
  return (
    live.createdAtMs === expected.createdAtMs &&
    live.lastLoginAtMs === expected.lastLoginAtMs &&
    live.memberLastLoginAtMs === expected.memberLastLoginAtMs &&
    live.joinedAtMs === expected.joinedAtMs &&
    live.status === expected.status
  );
}

function sameEvidence(profile, membership, expected) {
  if (!expected) return false;
  const live = evidenceSnapshot(profile, membership);
  return (
    live.schoolId === expected.schoolId &&
    live.primarySchoolId === expected.primarySchoolId &&
    sameLoginEvidence(profile, membership, expected)
  );
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
  const loginEvidence = hasSchoolLoginEvidence(membership, profile);
  if (profileBoundToSchool(profile, schoolId)) {
    if (membershipBoundToSchool(membership, schoolId)) {
      return { ...base, kind: 'already-bound' };
    }
    return {
      ...base,
      kind: loginEvidence ? 'stamp-membership-binding' : 'weak-evidence',
    };
  }
  if (!loginEvidence) {
    return { ...base, kind: 'weak-evidence' };
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
  const schoolIds = [...new Set(rows.map((row) => row.schoolId))];
  const activeSchoolsByUid = new Map();
  for (const item of classified) {
    if (item.kind === 'inactive-membership' || item.kind === 'insufficient-evidence') continue;
    const schools = activeSchoolsByUid.get(item.uid) || new Set();
    schools.add(item.schoolId);
    activeSchoolsByUid.set(item.uid, schools);
  }
  return classified.map((item) => {
    const withMeta = {
      ...item,
      schoolIds,
      evidence: evidenceSnapshot(item.profile, item.membership),
    };
    if (item.kind !== 'bind-candidate' && item.kind !== 'stamp-membership-binding') {
      return withMeta;
    }
    if ((activeSchoolsByUid.get(item.uid) || new Set()).size > 1) {
      return { ...withMeta, kind: 'multi-school-unbound' };
    }
    return withMeta;
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
        schoolIds: item.schoolIds || [item.schoolId],
        evidence: item.evidence,
        before: {
          schoolId: item.profile?.schoolId ?? null,
          primarySchoolId: item.profile?.primarySchoolId ?? null,
        },
        after: bindingWrite(item.schoolId, item.profile),
      });
      backup.push({
        op: 'stamp-membership-binding',
        path: `schools/${item.schoolId}/members/${item.uid}`,
        schoolId: item.schoolId,
        schoolIds: item.schoolIds || [item.schoolId],
        evidence: item.evidence,
        before: { profileBoundSchoolId: item.membership?.profileBoundSchoolId ?? null },
        after: { profileBoundSchoolId: item.schoolId },
      });
      continue;
    }
    if (item.kind === 'stamp-membership-binding') {
      backup.push({
        op: 'stamp-membership-binding',
        path: `schools/${item.schoolId}/members/${item.uid}`,
        schoolId: item.schoolId,
        schoolIds: item.schoolIds || [item.schoolId],
        evidence: item.evidence,
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

function otherMemberRefs(db, item, uid) {
  return (item.schoolIds || [])
    .filter((id) => id !== item.schoolId)
    .map((id) => db.collection('schools').doc(id).collection('members').doc(uid));
}

function hasExtraActiveSchool(otherSnaps) {
  return otherSnaps.some((snap) => snap.exists && snap.data()?.status === 'active');
}

async function applyBackupEntry(db, item) {
  return db.runTransaction(async (tx) => {
    if (item.op === 'bind-profile') {
      const userRef = docFromPath(db, item.path);
      const memberRef = docFromPath(db, item.memberPath);
      const uid = item.path.split('/')[1];
      const extraRefs = otherMemberRefs(db, item, uid);
      const [userSnap, memberSnap, ...otherSnaps] = await tx.getAll(userRef, memberRef, ...extraRefs);
      if (!userSnap.exists) return { applied: false, reason: 'missing-profile', path: item.path };
      const profile = userSnap.data() || {};
      if (isClosedAccount(profile)) return { applied: false, reason: 'closed-profile', path: item.path };
      if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      const membership = memberSnap.data() || {};
      if (!hasSchoolLoginEvidence(membership, profile)) {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      if (!sameEvidence(profile, membership, item.evidence)) {
        return { applied: false, reason: 'profile-changed', path: item.path };
      }
      if (hasExtraActiveSchool(otherSnaps)) {
        return { applied: false, reason: 'multi-school', path: item.path };
      }
      tx.update(userRef, item.after);
      return { applied: true, kind: item.op, path: item.path, schoolId: item.schoolId };
    }
    if (item.op === 'stamp-membership-binding') {
      const { schoolId, uid } = schoolAndUidFromMemberPath(item.path);
      const memberRef = docFromPath(db, item.path);
      const userRef = db.collection('users').doc(uid);
      const extraRefs = otherMemberRefs(db, { ...item, schoolId }, uid);
      const [userSnap, memberSnap, ...otherSnaps] = await tx.getAll(userRef, memberRef, ...extraRefs);
      if (!userSnap.exists || isClosedAccount(userSnap.data() || {})) {
        return { applied: false, reason: 'missing-profile', path: item.path };
      }
      if (!profileBoundToSchool(userSnap.data() || {}, schoolId)) {
        return { applied: false, reason: 'unbound-profile', path: item.path };
      }
      if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      const profile = userSnap.data() || {};
      const membership = memberSnap.data() || {};
      if (!hasSchoolLoginEvidence(membership, profile)) {
        return { applied: false, reason: 'insufficient-evidence', path: item.path };
      }
      if (!sameLoginEvidence(profile, membership, item.evidence)) {
        return { applied: false, reason: 'profile-changed', path: item.path };
      }
      if (hasExtraActiveSchool(otherSnaps)) {
        return { applied: false, reason: 'multi-school', path: item.path };
      }
      tx.update(memberRef, item.after);
      return { applied: true, kind: item.op, path: item.path };
    }
    if (item.op === 'inactivate-orphan') {
      const memberRef = docFromPath(db, item.path);
      const { uid } = schoolAndUidFromMemberPath(item.path);
      const userRef = db.collection('users').doc(uid);
      const [userSnap, memberSnap] = await tx.getAll(userRef, memberRef);
      if (userSnap.exists) return { applied: false, reason: 'profile-exists', path: item.path };
      if (!memberSnap.exists) return { applied: false, reason: 'missing-membership', path: item.path };
      if (memberSnap.data()?.status !== 'active') {
        return { applied: false, reason: 'already-inactive', path: item.path };
      }
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
    const result = await db.runTransaction(async (tx) => {
      const ref = docFromPath(db, item.path);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { applied: false, reason: 'missing', path: item.path };
      }
      const current = snap.data() || {};
      const next = restoreFields(current, item.before, item.after, FieldValue);
      if (Object.keys(next).length === 0) {
        return { applied: false, reason: 'current-mismatch', path: item.path };
      }
      if (apply) tx.update(ref, next);
      return { applied: apply, path: item.path, fields: Object.keys(next), op: item.op };
    });
    if (result.fields) {
      restored.push({ path: result.path, fields: result.fields, op: result.op });
    } else {
      skipped.push({ path: result.path, reason: result.reason });
    }
  }
  return { restored, skipped, apply };
}

async function clearProfileSchoolBindingForRevokedMembership({ db, FieldValue, schoolId, uid }) {
  return db.runTransaction(async (tx) => {
    const memberRef = db.collection('schools').doc(schoolId).collection('members').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const [memberSnap, userSnap] = await tx.getAll(memberRef, userRef);
    if (memberSnap.exists && memberSnap.data()?.status === 'active') {
      return { action: 'leave-profile' };
    }
    if (!userSnap.exists) return { action: 'missing-profile' };
    const profile = userSnap.data() || {};
    const update = {};
    if (profile.schoolId === schoolId) update.schoolId = FieldValue.delete();
    if (profile.primarySchoolId === schoolId) update.primarySchoolId = FieldValue.delete();
    if (Object.keys(update).length === 0) return { action: 'no-matching-binding' };
    tx.update(userRef, update);
    return { action: 'cleared-binding', fields: Object.keys(update) };
  });
}

async function inactivateLeftoverSchoolMemberships({ db, uid, loadMemberships }) {
  const memberships = await loadMemberships(uid);
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const memberRefs = [];
    for (const item of memberships) {
      if (!item.exists) continue;
      memberRefs.push({
        schoolId: item.schoolId,
        ref: db.collection('schools').doc(item.schoolId).collection('members').doc(uid),
      });
    }
    const userSnap = await tx.get(userRef);
    const memberSnaps = [];
    for (const item of memberRefs) {
      memberSnaps.push({ schoolId: item.schoolId, ref: item.ref, snap: await tx.get(item.ref) });
    }
    if (userSnap.exists) return [];
    const changed = [];
    for (const { schoolId, ref, snap } of memberSnaps) {
      if (!snap.exists) continue;
      if (snap.data()?.status !== 'active') continue;
      tx.set(ref, { status: 'inactive' }, { merge: true });
      changed.push(schoolId);
    }
    return changed;
  });
}

function uniqueStoryStorageFirestoreDocs(source) {
  const match = source.match(
    /match \/schools\/\{schoolId\}\/stories\/\{storyId\}\/\{fileName\} \{([\s\S]*?)\n    match \//,
  );
  if (!match) throw new Error('campus story storage match not found');
  const block = match[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const prefix = '/databases/(default)/documents/';
  const paths = [];
  let index = 0;
  while (index < block.length) {
    const getAt = block.indexOf('firestore.get(', index);
    const existsAt = block.indexOf('firestore.exists(', index);
    const start = [getAt, existsAt].filter((value) => value >= 0).sort((a, b) => a - b)[0];
    if (start == null) break;
    const pathStart = block.indexOf(prefix, start);
    if (pathStart < 0 || pathStart > start + 80) {
      index = start + 1;
      continue;
    }
    let cursor = pathStart + prefix.length;
    let depth = 1;
    let path = '';
    while (cursor < block.length && depth > 0) {
      const character = block[cursor];
      if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      path += character;
      cursor += 1;
    }
    paths.push(path);
    index = cursor;
  }
  return [...new Set(paths)].sort();
}

module.exports = {
  isClosedAccount,
  toMillis,
  hasSchoolLoginEvidence,
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  loadCampusMembershipRows,
  summarizeBindingPlan,
  buildCampusStoryAccessBackup,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
  clearProfileSchoolBindingForRevokedMembership,
  inactivateLeftoverSchoolMemberships,
  uniqueStoryStorageFirestoreDocs,
};
