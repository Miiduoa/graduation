'use strict';

function isClosedAccount(profile) {
  if (!profile) return false;
  return (
    profile.accountDeletionInProgress === true ||
    ['deleted', 'disabled', 'suspended', 'inactive'].includes(profile.status)
  );
}

function membershipBoundToSchool(membership, schoolId) {
  return membership?.status === 'active' && membership?.profileBoundSchoolId === schoolId;
}

function stampMatchesLiveProfile(membership, profile) {
  if (!profile || isClosedAccount(profile)) return false;
  const stampGen = membership?.profileBoundGeneration;
  const liveGen = profile.bindingGeneration;
  return Boolean(stampGen) && stampGen === liveGen;
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
  if (membershipBoundToSchool(membership, schoolId)) {
    return { ...base, kind: 'already-bound' };
  }
  return { ...base, kind: 'needs-login' };
}

function planCampusStoryAccessBinding(rows) {
  return rows.map((row) => classifyCampusStoryBinding(row));
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

async function applyCampusStoryAccessBinding({ apply = false } = {}) {
  if (apply) {
    throw new Error('Binding apply is disabled; historical accounts stamp on next school login');
  }
  return { backup: [], applied: [], apply: false };
}

function missingField(value) {
  return value == null;
}

function sameField(current, expected) {
  if (missingField(expected)) return missingField(current);
  return current === expected;
}

function restoreFields(current, before, after, FieldValue) {
  const next = {};
  for (const key of Object.keys(after)) {
    if (!sameField(current?.[key], after[key])) continue;
    next[key] = missingField(before?.[key]) ? FieldValue.delete() : before[key];
  }
  return next;
}

function reverseBlockedByNewerBinding(current, item) {
  const after = item.after || {};
  if (!Object.prototype.hasOwnProperty.call(after, 'profileBoundSchoolId')) return false;
  const backupGen = after.profileBoundGeneration ?? item.generation ?? null;
  return Boolean(current.profileBoundGeneration) && current.profileBoundGeneration !== backupGen;
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
      if (reverseBlockedByNewerBinding(current, item)) {
        return { applied: false, reason: 'newer-generation', path: item.path };
      }
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

async function revokeCampusStoryMembershipBinding({ db, uid, loadMemberships, FieldValue }) {
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
    const profile = userSnap.exists ? userSnap.data() || {} : null;
    const changed = [];
    for (const { schoolId, ref, snap } of memberSnaps) {
      if (!snap.exists) continue;
      const data = snap.data() || {};
      if (stampMatchesLiveProfile(data, profile)) continue;
      const update = {};
      if (data.profileBoundSchoolId != null) update.profileBoundSchoolId = FieldValue.delete();
      if (data.profileBoundGeneration != null) update.profileBoundGeneration = FieldValue.delete();
      if (Object.keys(update).length === 0) continue;
      tx.update(ref, update);
      changed.push(schoolId);
    }
    return changed;
  });
}

async function inactivateLeftoverSchoolMemberships(options) {
  return revokeCampusStoryMembershipBinding(options);
}

function uniqueStoryStorageFirestoreDocs(source) {
  const match = source.match(
    /match \/schools\/\{schoolId\}\/stories\/\{storyId\}\/\{fileName\} \{([\s\S]*?)\n {4}match \//,
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
  stampMatchesLiveProfile,
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  loadCampusMembershipRows,
  summarizeBindingPlan,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
  clearProfileSchoolBindingForRevokedMembership,
  revokeCampusStoryMembershipBinding,
  inactivateLeftoverSchoolMemberships,
  uniqueStoryStorageFirestoreDocs,
};
