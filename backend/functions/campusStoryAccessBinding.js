'use strict';

function isClosedAccount(profile) {
  if (!profile) return false;
  return (
    profile.accountDeletionInProgress === true ||
    ['deleted', 'disabled', 'suspended', 'inactive'].includes(profile.status)
  );
}

function membershipBoundToSchool(membership, schoolId) {
  return (
    membership?.status === 'active' &&
    membership?.profileBoundSchoolId === schoolId &&
    Boolean(membership?.profileBoundGeneration)
  );
}

function stampMatchesLiveProfile(membership, profile) {
  if (!profile || isClosedAccount(profile)) return false;
  const stampGen = membership?.profileBoundGeneration;
  const liveGen = profile.bindingGeneration;
  return Boolean(stampGen) && stampGen === liveGen;
}

/** Server writers that create or activate Firestore school members. nuni-api does not. */
const TRUSTED_CAMPUS_STORY_MEMBER_CREATE_PATHS = [
  'writeSchoolLoginProfile.functions',
  'writeSchoolLoginProfile.web',
  'provisionUniversalDevAccount',
  'seedDemoUsers',
];

function nextBindingGeneration(account, createId) {
  return typeof account?.bindingGeneration === 'string' && account.bindingGeneration
    ? account.bindingGeneration
    : createId();
}

function campusStoryStampFields(schoolId, bindingGeneration) {
  return {
    profileBoundSchoolId: schoolId,
    profileBoundGeneration: bindingGeneration,
  };
}

function snapshotMillis(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  return null;
}

function restampEligibility({ membership, memberSnap, userSnap }) {
  if (!userSnap?.exists || !memberSnap?.exists) return { ok: false, reason: 'missing' };
  const profile = userSnap.data() || {};
  const data = membership || memberSnap.data() || {};
  if (isClosedAccount(profile)) return { ok: false, reason: 'closed-profile' };
  if (data.status !== 'active') return { ok: false, reason: 'inactive-membership' };
  const userCreated = snapshotMillis(userSnap.createTime);
  const memberCreated = snapshotMillis(memberSnap.createTime);
  if (userCreated == null || memberCreated == null) return { ok: false, reason: 'missing-create-time' };
  if (userCreated > memberCreated) return { ok: false, reason: 'rebuilt-profile' };
  return { ok: true };
}

async function loadExistingSchoolMemberships(db, uid) {
  if (!uid) return [];
  const schoolsSnap = await db.collection('schools').get();
  const memberships = [];
  for (const schoolDoc of schoolsSnap.docs) {
    const memberSnap = await db.collection('schools').doc(schoolDoc.id).collection('members').doc(uid).get();
    if (!memberSnap.exists) continue;
    memberships.push({
      schoolId: schoolDoc.id,
      exists: true,
      membership: memberSnap.data() || {},
    });
  }
  return memberships;
}

async function stampExistingCampusStoryMemberships({
  db,
  uid,
  FieldValue,
  randomUUID,
  loadMemberships,
}) {
  const memberships = await (loadMemberships || loadExistingSchoolMemberships)(db, uid);
  const existing = memberships.filter((item) => item.exists);
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    const memberItems = [];
    for (const item of existing) {
      const ref = db.collection('schools').doc(item.schoolId).collection('members').doc(uid);
      memberItems.push({ schoolId: item.schoolId, ref, snap: await tx.get(ref) });
    }
    if (!userSnap.exists) return { stamped: [], skipped: ['missing-profile'] };
    const profile = userSnap.data() || {};
    if (isClosedAccount(profile)) return { stamped: [], skipped: ['closed-profile'] };
    const bindingGeneration = nextBindingGeneration(profile, randomUUID);
    const stamped = [];
    const skipped = [];
    for (const { schoolId, ref, snap } of memberItems) {
      const eligibility = restampEligibility({
        membership: snap.exists ? snap.data() || {} : null,
        memberSnap: snap,
        userSnap,
      });
      if (!eligibility.ok) {
        skipped.push(`${schoolId}:${eligibility.reason}`);
        continue;
      }
      const data = snap.data() || {};
      if (membershipBoundToSchool(data, schoolId) && data.profileBoundGeneration === bindingGeneration) {
        skipped.push(`${schoolId}:already-bound`);
        continue;
      }
      tx.update(ref, campusStoryStampFields(schoolId, bindingGeneration));
      stamped.push(schoolId);
    }
    if (stamped.length > 0) {
      tx.set(userRef, { bindingGeneration, lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return { stamped, skipped, bindingGeneration };
  });
}

function createEnsureCampusStoryBindingHandler({
  db,
  FieldValue,
  randomUUID,
  HttpsError,
  loadMemberships,
}) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    return stampExistingCampusStoryMemberships({
      db,
      uid,
      FieldValue,
      randomUUID,
      loadMemberships,
    }).then((result) => ({ success: true, stamped: result.stamped }));
  };
}

function leftoverActiveMembershipKind(row) {
  const classified = classifyCampusStoryBinding(row);
  if (classified.kind === 'orphan-membership' || classified.kind === 'closed-profile') {
    return classified.kind;
  }
  return null;
}

function planOrphanSchoolMembershipCleanup(rows) {
  return rows
    .map((row) => {
      const kind = leftoverActiveMembershipKind(row);
      return kind ? { ...row, kind } : null;
    })
    .filter(Boolean);
}

async function inactivateOrphanSchoolMemberships({ db, FieldValue, entries }) {
  const changed = [];
  for (const entry of entries) {
    const path = await db.runTransaction(async (tx) => {
      const memberRef = db.collection('schools').doc(entry.schoolId).collection('members').doc(entry.uid);
      const userRef = db.collection('users').doc(entry.uid);
      const [memberSnap, userSnap] = await tx.getAll(memberRef, userRef);
      if (!memberSnap.exists) return null;
      const membership = memberSnap.data() || {};
      if (membership.status !== 'active') return null;
      if (userSnap.exists && !isClosedAccount(userSnap.data() || {})) return null;
      tx.update(memberRef, storyStampClearUpdate(FieldValue));
      return memberRef.path;
    });
    if (path) changed.push(path);
  }
  return changed;
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

function storyStampClearUpdate(FieldValue) {
  return {
    profileBoundSchoolId: FieldValue.delete(),
    profileBoundGeneration: FieldValue.delete(),
    status: 'inactive',
  };
}

async function closeCampusStoryAccess({ db, uid, FieldValue, userUpdate = null, memberRefs = [] }) {
  const userRef = db.collection('users').doc(uid);
  const chunks = [];
  for (let index = 0; index < memberRefs.length; index += 400) {
    chunks.push(memberRefs.slice(index, index + 400));
  }
  if (chunks.length === 0) chunks.push([]);
  const changed = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(userRef, ...chunk);
      if (index === 0 && userUpdate) tx.set(userRef, userUpdate, { merge: true });
      for (let offset = 0; offset < chunk.length; offset += 1) {
        const snap = snaps[offset + 1];
        const ref = chunk[offset];
        if (!snap.exists) continue;
        tx.update(ref, storyStampClearUpdate(FieldValue));
        changed.push(ref.path);
      }
    });
  }
  return changed;
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
  TRUSTED_CAMPUS_STORY_MEMBER_CREATE_PATHS,
  nextBindingGeneration,
  campusStoryStampFields,
  restampEligibility,
  loadExistingSchoolMemberships,
  stampExistingCampusStoryMemberships,
  createEnsureCampusStoryBindingHandler,
  leftoverActiveMembershipKind,
  planOrphanSchoolMembershipCleanup,
  inactivateOrphanSchoolMemberships,
  classifyCampusStoryBinding,
  planCampusStoryAccessBinding,
  loadCampusMembershipRows,
  summarizeBindingPlan,
  closeCampusStoryAccess,
  clearProfileSchoolBindingForRevokedMembership,
  revokeCampusStoryMembershipBinding,
  inactivateLeftoverSchoolMemberships,
  uniqueStoryStorageFirestoreDocs,
};
