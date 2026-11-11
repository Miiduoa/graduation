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

const RESTAMP_COOLDOWN_MS = 5 * 60 * 1000;

function trustedProfileSchoolIds(profile) {
  const ids = [];
  for (const value of [profile?.schoolId, profile?.primarySchoolId]) {
    if (typeof value === 'string' && value && !ids.includes(value)) ids.push(value);
  }
  if (Array.isArray(profile?.schoolIds)) {
    for (const value of profile.schoolIds) {
      if (typeof value === 'string' && value && !ids.includes(value)) ids.push(value);
    }
  }
  return ids;
}

function schoolMemberSchoolId(path, uid) {
  if (typeof path !== 'string' || !uid) return null;
  const parts = path.split('/');
  if (parts.length === 4 && parts[0] === 'schools' && parts[2] === 'members' && parts[3] === uid) {
    return parts[1];
  }
  return null;
}

function listCatalogSchoolIds() {
  const { SCHOOLS } = require('./campusAnnouncements/catalog');
  return (SCHOOLS || []).map((entry) => entry.schoolId).filter((id) => typeof id === 'string' && id);
}

function listKnownSchoolIds(knownSchoolIds) {
  if (Array.isArray(knownSchoolIds)) {
    return [...new Set(knownSchoolIds.filter((id) => typeof id === 'string' && id))];
  }
  return listCatalogSchoolIds();
}

function lookupSchoolIds(profile, knownSchoolIds) {
  const ids = [];
  for (const value of [...listKnownSchoolIds(knownSchoolIds), ...trustedProfileSchoolIds(profile)]) {
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

function haltFields(kind, FieldValue) {
  return {
    campusStoryBindingHaltKind: kind,
    campusStoryBindingHaltAt: FieldValue.serverTimestamp(),
  };
}

function clearHaltFields(FieldValue) {
  return {
    campusStoryBindingHaltKind: FieldValue.delete(),
    campusStoryBindingHaltAt: FieldValue.delete(),
  };
}

function storyMediaStampClearUpdate(FieldValue) {
  return {
    profileBoundSchoolId: FieldValue.delete(),
    profileBoundGeneration: FieldValue.delete(),
  };
}

function cooldownActive(profile, nowMs) {
  const at = snapshotMillis(profile?.campusStoryBindingHaltAt);
  if (at == null) return false;
  return nowMs - at < RESTAMP_COOLDOWN_MS;
}

function memberHasStoryStamp(data) {
  return data?.profileBoundSchoolId != null || data?.profileBoundGeneration != null;
}

async function loadUserScopedSchoolIds(db, uid) {
  if (!uid || typeof db.collection !== 'function') return [];
  try {
    const snap = await db.collection('users').doc(uid).collection('schools').get();
    return (snap.docs || []).map((doc) => doc.id).filter((id) => typeof id === 'string' && id);
  } catch {
    return [];
  }
}

async function loadExistingSchoolMemberships(db, uid, profile, knownSchoolIds) {
  if (!uid) return [];
  const ids = lookupSchoolIds(profile, knownSchoolIds);
  for (const schoolId of await loadUserScopedSchoolIds(db, uid)) {
    if (!ids.includes(schoolId)) ids.push(schoolId);
  }
  const memberships = [];
  for (const schoolId of ids) {
    const memberSnap = await db.collection('schools').doc(schoolId).collection('members').doc(uid).get();
    if (!memberSnap.exists) continue;
    memberships.push({
      schoolId,
      exists: true,
      membership: memberSnap.data() || {},
    });
  }
  return memberships;
}

async function clearCampusStoryBindingHalt({ db, FieldValue, uid }) {
  if (!uid) return;
  await db.collection('users').doc(uid).set(clearHaltFields(FieldValue), { merge: true });
}

function clearFoundStoryStamps(tx, memberItems, FieldValue, exceptSchoolId) {
  const cleared = [];
  for (const { schoolId, ref, snap } of memberItems) {
    if (exceptSchoolId && schoolId === exceptSchoolId) continue;
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (!memberHasStoryStamp(data)) continue;
    tx.update(ref, storyMediaStampClearUpdate(FieldValue));
    cleared.push(schoolId);
  }
  return cleared;
}

async function stampExistingCampusStoryMemberships({
  db,
  uid,
  FieldValue,
  randomUUID,
  loadMemberships,
  knownSchoolIds,
  nowMs,
}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const userRef = db.collection('users').doc(uid);
  const preview = await userRef.get();
  if (!preview.exists) return { stamped: [], skipped: ['missing-profile'] };
  const previewProfile = preview.data() || {};
  if (isClosedAccount(previewProfile)) return { stamped: [], skipped: ['closed-profile'] };
  if (cooldownActive(previewProfile, now)) {
    return { stamped: [], skipped: ['cooldown'] };
  }

  const memberships = await (loadMemberships
    ? loadMemberships(db, uid, previewProfile, knownSchoolIds)
    : loadExistingSchoolMemberships(db, uid, previewProfile, knownSchoolIds));
  const existing = memberships.filter((item) => item.exists);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const memberItems = [];
    for (const item of existing) {
      const ref = db.collection('schools').doc(item.schoolId).collection('members').doc(uid);
      memberItems.push({ schoolId: item.schoolId, ref, snap: await tx.get(ref) });
    }
    if (!userSnap.exists) return { stamped: [], skipped: ['missing-profile'] };
    const profile = userSnap.data() || {};
    if (isClosedAccount(profile)) return { stamped: [], skipped: ['closed-profile'] };
    const skipped = [];
    const eligible = [];
    for (const item of memberItems) {
      const eligibility = restampEligibility({
        membership: item.snap.exists ? item.snap.data() || {} : null,
        memberSnap: item.snap,
        userSnap,
      });
      if (!eligibility.ok) {
        skipped.push(`${item.schoolId}:${eligibility.reason}`);
        continue;
      }
      eligible.push(item);
    }
    if (eligible.length !== 1) {
      const cleared = clearFoundStoryStamps(tx, memberItems, FieldValue);
      const kind = eligible.length > 1 ? 'multiple' : 'none';
      const userPatch = {
        ...haltFields(kind, FieldValue),
      };
      if (profile.schoolId) userPatch.schoolId = FieldValue.delete();
      if (profile.primarySchoolId) userPatch.primarySchoolId = FieldValue.delete();
      tx.set(userRef, userPatch, { merge: true });
      return {
        stamped: [],
        skipped: [
          ...skipped,
          ...(eligible.length > 1
            ? eligible.map((item) => `${item.schoolId}:multiple-schools`)
            : skipped.length ? [] : ['none']),
        ],
        cleared,
      };
    }
    const { schoolId, ref, snap } = eligible[0];
    const bindingGeneration = nextBindingGeneration(profile, randomUUID);
    const data = snap.data() || {};
    const stamped = [];
    const userPatch = { ...haltFields('unique', FieldValue) };
    if (membershipBoundToSchool(data, schoolId) && data.profileBoundGeneration === bindingGeneration) {
      skipped.push(`${schoolId}:already-bound`);
    } else {
      tx.update(ref, campusStoryStampFields(schoolId, bindingGeneration));
      stamped.push(schoolId);
      userPatch.bindingGeneration = bindingGeneration;
      userPatch.lastLoginAt = FieldValue.serverTimestamp();
    }
    if (profile.schoolId !== schoolId) userPatch.schoolId = schoolId;
    if (profile.primarySchoolId !== schoolId) userPatch.primarySchoolId = schoolId;
    if (typeof FieldValue.arrayUnion === 'function') {
      userPatch.schoolIds = FieldValue.arrayUnion(schoolId);
    }
    const cleared = clearFoundStoryStamps(tx, memberItems, FieldValue, schoolId);
    tx.set(userRef, userPatch, { merge: true });
    return { stamped, skipped, cleared, bindingGeneration };
  });
}

function createEnsureCampusStoryBindingHandler({
  db,
  FieldValue,
  randomUUID,
  HttpsError,
  loadMemberships,
  knownSchoolIds,
}) {
  // Firebase Auth callable only. Production Google login is nuni google-consumer
  // OAuth that stores sessionHandle; it never mints a Firebase customToken or uid.
  // Campus stories read Firestore campusStories and Storage schools/{id}/stories
  // through useAuth(), so platform Google users cannot use that media path.
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    return stampExistingCampusStoryMemberships({
      db,
      uid,
      FieldValue,
      randomUUID,
      loadMemberships,
      knownSchoolIds,
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
    const update = { ...clearHaltFields(FieldValue) };
    const fields = [];
    if (profile.schoolId === schoolId) {
      update.schoolId = FieldValue.delete();
      fields.push('schoolId');
    }
    if (profile.primarySchoolId === schoolId) {
      update.primarySchoolId = FieldValue.delete();
      fields.push('primarySchoolId');
    }
    tx.update(userRef, update);
    return fields.length ? { action: 'cleared-binding', fields } : { action: 'cleared-halt' };
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
  RESTAMP_COOLDOWN_MS,
  trustedProfileSchoolIds,
  candidateSchoolIds: trustedProfileSchoolIds,
  listKnownSchoolIds,
  lookupSchoolIds,
  schoolMemberSchoolId,
  loadExistingSchoolMemberships,
  stampExistingCampusStoryMemberships,
  clearHaltFields,
  clearCampusStoryBindingHalt,
  storyMediaStampClearUpdate,
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
