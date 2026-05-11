/**
 * Callable finalizePostLogin：以後端 PU / TronClass session 取證，
 * 執行 resolveUserRoles、寫入 users / members.externalIds、courseRosters、postLoginRuns，並同步 custom claims。
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertSessionOwner } = require('../sessionSecurity');
const { enforceRateLimit } = require('../securityUtils');
const { puFetchCourses } = require('../puScraper');
const { tcFetchCourses, tcFetchProfile, tcFetchCourseMembers } = require('../tronClassScraper');
const { normalizeServiceRoleRecord } = require('../authz');
const { resolveUserRoles } = require('../../../packages/shared/dist-cjs/postLoginRoles');

const MAX_MEMBER_COURSES = 10;
const MAX_EMAIL_LOOKUPS = 40;
const MAX_POST_LOGIN_RUNS = 20;

function normEmail(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s || null;
}

async function findUidByEmail(db, emailNorm) {
  if (!emailNorm) return null;
  const snap = await db.collection('users').where('email', '==', emailNorm).limit(3).get();
  if (snap.empty) return null;
  if (snap.docs.length > 1) return null;
  return snap.docs[0].id;
}

/** 刪除最舊的 run，只保留最近 MAX_POST_LOGIN_RUNS 筆（分批讀取與刪除） */
async function pruneOldPostLoginRuns(userRef) {
  const dbInst = userRef.firestore;
  const PAGE = 100;
  const CHUNK = 400;
  for (;;) {
    const snap = await userRef
      .collection('postLoginRuns')
      .orderBy('createdAt', 'desc')
      .limit(PAGE)
      .get();
    if (snap.size <= MAX_POST_LOGIN_RUNS) return;
    const toDelete = snap.docs.slice(MAX_POST_LOGIN_RUNS);
    if (!toDelete.length) return;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const slice = toDelete.slice(i, i + CHUNK);
      const delBatch = dbInst.batch();
      slice.forEach((d) => delBatch.delete(d.ref));
      await delBatch.commit();
    }
  }
}

async function runFinalizePostLogin(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  enforceRateLimit({
    scope: 'finalize-post-login',
    key: uid,
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });

  const db = getFirestore();
  const puSessionId = String(request.data?.puSessionId || '').trim();
  const tronSessionId = String(request.data?.tronSessionId || '').trim();
  const semester = String(request.data?.semester || '').trim();

  if (!puSessionId) {
    throw new HttpsError('invalid-argument', 'puSessionId is required');
  }

  const puRef = db.collection('_puSessions').doc(puSessionId);
  const puSnap = await puRef.get();
  if (!puSnap.exists) {
    throw new HttpsError('failed-precondition', 'PU session not found');
  }
  const puData = puSnap.data() || {};
  assertSessionOwner(puData, uid);
  const puExpires = puData?.expiresAt?.toDate?.() ?? null;
  if (!puData?.cookies || !puExpires || puExpires < new Date()) {
    throw new HttpsError('failed-precondition', 'PU session expired');
  }

  let tronData = null;
  if (tronSessionId) {
    const tronRef = db.collection('_puTronClassSessions').doc(tronSessionId);
    const tronSnap = await tronRef.get();
    if (!tronSnap.exists) {
      throw new HttpsError('failed-precondition', 'TronClass session not found');
    }
    const tronCandidate = tronSnap.data() || {};
    try {
      assertSessionOwner(tronCandidate, uid);
    } catch {
      throw new HttpsError('permission-denied', 'TronClass session does not belong to this user');
    }
    const tronExpires = tronCandidate?.expiresAt?.toDate?.() ?? null;
    if (!tronCandidate?.cookies || !tronExpires || tronExpires < new Date()) {
      throw new HttpsError('failed-precondition', 'TronClass session expired');
    }
    tronData = tronCandidate;
  }

  const errors = [];
  const inputs = {
    hadPuSession: true,
    hadTronSession: !!tronData?.cookies,
    semester: semester || null,
    fetchedAt: new Date().toISOString(),
  };

  let puResult = { success: false, courses: [], studentInfo: null, semester: null };
  try {
    puResult = await puFetchCourses(puData.cookies, semester);
    if (!puResult.success) {
      errors.push({ code: 'pu_courses', message: puResult.error || 'pu_fetch_failed' });
    }
  } catch (e) {
    errors.push({ code: 'pu_courses', message: e instanceof Error ? e.message : String(e) });
  }

  let tcCourses = [];
  let tcProfile = null;
  if (tronData?.cookies) {
    try {
      const userId = tronData.userId ?? null;
      tcCourses = await tcFetchCourses(tronData.cookies, { userId, status: 'ongoing' });
      tcProfile = await tcFetchProfile(tronData.cookies, { userId });
    } catch (e) {
      errors.push({ code: 'tron_courses', message: e instanceof Error ? e.message : String(e) });
    }
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const userDoc = userSnap.exists ? userSnap.data() || {} : {};

  const schoolId =
    String(userDoc.schoolId || userDoc.primarySchoolId || request.data?.schoolId || '').trim() ||
    null;

  let schoolMemberDoc = null;
  let serviceRolesDoc = null;
  if (schoolId) {
    const memSnap = await db.collection('schools').doc(schoolId).collection('members').doc(uid).get();
    schoolMemberDoc = memSnap.exists ? memSnap.data() || {} : null;
    const srSnap = await db.collection('schools').doc(schoolId).collection('serviceRoles').doc(uid).get();
    serviceRolesDoc = srSnap.exists ? normalizeServiceRoleRecord(srSnap.data() || {}) : null;
  }

  const resolved = resolveUserRoles({
    userDoc: {
      role: userDoc.role,
      primaryRole: userDoc.primaryRole,
      email: userDoc.email,
      studentId: userDoc.studentId,
    },
    schoolMemberDoc,
    serviceRolesDoc,
    tcProfile,
    tcCourses: (tcCourses || []).map((c) => ({
      id: c.id,
      course_code: c.course_code,
      name: c.name,
      role: c.role,
    })),
  });

  const teachingCourseIds = (tcCourses || [])
    .filter((c) => String(c.role || '').toLowerCase() === 'teacher')
    .map((c) => c.id)
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_MEMBER_COURSES);

  const rosterSummaries = [];
  if (tronData?.cookies && teachingCourseIds.length) {
    const settled = await Promise.allSettled(
      teachingCourseIds.map(async (courseId) => {
        const members = await tcFetchCourseMembers(tronData.cookies, courseId);
        const accessUidSet = new Set([uid]);
        const emails = [];
        for (const m of members || []) {
          const em = normEmail(m.email || m.login_email || m.mail);
          if (em) emails.push(em);
        }
        const uniqueEmails = [...new Set(emails)].slice(0, MAX_EMAIL_LOOKUPS);
        const uidByEmail = await Promise.all(
          uniqueEmails.map(async (em) => ({ em, uid: await findUidByEmail(db, em) })),
        );
        for (const row of uidByEmail) {
          if (row.uid) accessUidSet.add(row.uid);
        }

        if (schoolId) {
          const rosterRef = db
            .collection('schools')
            .doc(schoolId)
            .collection('courseRosters')
            .doc(`tron_${courseId}`);
          const courseMeta = (tcCourses || []).find((c) => c.id === courseId) || {};
          const accessUidList = [...accessUidSet];
          await rosterRef.set(
            {
              tronCourseId: courseId,
              courseCode: courseMeta.course_code || null,
              courseName: courseMeta.name || null,
              members: (members || []).map((m) => ({
                tronMemberId: m.id,
                name: m.name || '',
                role: m.role || '',
                email: normEmail(m.email || m.login_email || m.mail),
              })),
              accessUids: FieldValue.arrayUnion(...accessUidList),
              updatedAt: FieldValue.serverTimestamp(),
              updatedByUid: uid,
            },
            { merge: true },
          );
        }

        return { courseId, memberCount: (members || []).length };
      }),
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') rosterSummaries.push(s.value);
      else errors.push({ code: 'tron_members', message: s.reason?.message || String(s.reason) });
    }
  }

  const puCoursesFailed = errors.some((e) => e.code === 'pu_courses');
  const tronCoursesFailed = errors.some((e) => e.code === 'tron_courses');
  const tronRostersFailed = errors.some((e) => e.code === 'tron_members');
  const partial = errors.length > 0;
  const sourcesUsed = {
    pu: true,
    tronCourses: !!(tronData?.cookies),
    tronProfile: !!(tronData?.cookies),
    rosters: !!(tronData?.cookies && teachingCourseIds.length > 0),
  };

  const externalIds = {
    puStudentId:
      puResult.studentInfo?.studentId ||
      puData.studentId ||
      (typeof userDoc.studentId === 'string' ? userDoc.studentId : null) ||
      null,
    tronUserId: tronData?.userId ?? null,
    lastResolvedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(
    userRef,
    {
      role: resolved.primaryRole,
      postLoginRoles: resolved.roles,
      teachingRoles: resolved.teachingRoles,
      orgRoles: resolved.orgRoles,
      lastPostLoginResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (schoolId) {
    const memRef = db.collection('schools').doc(schoolId).collection('members').doc(uid);
    batch.set(memRef, { externalIds }, { merge: true });
  }

  const runRef = userRef.collection('postLoginRuns').doc();
  batch.set(runRef, {
    inputs,
    resolvedRole: resolved.primaryRole,
    resolved: {
      primaryRole: resolved.primaryRole,
      roles: resolved.roles,
      teachingRoles: resolved.teachingRoles,
      orgRoles: resolved.orgRoles,
      confidence: resolved.confidence,
      reasons: resolved.reasons,
      usedAuthoritativeUserRole: resolved.usedAuthoritativeUserRole,
    },
    outputs: {
      puCourseCount: (puResult.courses || []).length,
      tcCourseCount: (tcCourses || []).length,
      rosterCourses: rosterSummaries.length,
      rosterMemberTotal: rosterSummaries.reduce((a, r) => a + (r.memberCount || 0), 0),
      sourcesUsed,
      partial,
      puCoursesFailed,
      tronCoursesFailed,
      tronRostersFailed,
    },
    errors,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  try {
    await pruneOldPostLoginRuns(userRef);
  } catch (e) {
    console.warn('[finalizePostLogin] prune postLoginRuns failed:', e);
  }

  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();
  const after = (await userRef.get()).data() || {};
  const claimSchoolId = after.schoolId || after.primarySchoolId || null;
  const postLoginRoles = Array.isArray(after.postLoginRoles) ? after.postLoginRoles : [];
  await auth.setCustomUserClaims(uid, {
    role: after.role || 'student',
    ...(claimSchoolId ? { schoolId: claimSchoolId } : {}),
    ...(postLoginRoles.length ? { roles: postLoginRoles.slice(0, 12) } : {}),
  });

  const coursesLite = (tcCourses || []).map((c) => ({
    id: String(c.id),
    code: c.course_code || '',
    name: c.name || '',
    source: 'tron',
    role: c.role || 'student',
    teacherUids: [],
    studentUids: [],
  }));

  return {
    success: true,
    runId: runRef.id,
    resolved,
    summaries: {
      puCourseCount: (puResult.courses || []).length,
      tcCourseCount: (tcCourses || []).length,
      rosterCourses: rosterSummaries.length,
      partial,
      sourcesUsed,
      puCoursesFailed,
      tronCoursesFailed,
      tronRostersFailed,
    },
    context: {
      user: { uid, email: userDoc.email || null },
      schoolId,
      courses: coursesLite,
      puCoursesSample: (puResult.courses || []).slice(0, 5).map((c) => ({
        code: c.code,
        name: c.name,
        teacherEmail: c.teacherEmail || null,
      })),
    },
  };
}

module.exports = {
  runFinalizePostLogin,
};
