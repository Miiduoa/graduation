const { randomBytes } = require('node:crypto');

function canonicalizePuStudentId(value) {
  if (typeof value !== 'string') return null;
  return /^(?:s)?([0-9]{7,10})(?:@pu\.edu\.tw)?$/i.exec(value.trim())?.[1] || null;
}

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function requireCurrentStudent(authUser, studentId) {
  const uid = authUser?.uid;
  if (typeof uid !== 'string' || authUser.schoolId !== 'pu' ||
      !uid.startsWith('pu-') || canonicalizePuStudentId(uid.slice(3)) !== studentId) {
    reject(403, '請使用目前登入帳號的靜宜學號重新連線。');
  }
  return uid;
}

function requireActiveAccount(profileSnapshot, memberSnapshot, studentId) {
  const profile = profileSnapshot.data();
  const member = memberSnapshot.data();
  // studentId on users is editable by the client. The signed UID is checked separately.
  if (!profileSnapshot.exists || profile?.schoolId !== 'pu' ||
      canonicalizePuStudentId(profile.studentId) !== studentId ||
      profile.accountDeletionInProgress === true || profile.status === 'deleted' ||
      !memberSnapshot.exists || member?.status !== 'active' ||
      (member.studentId != null && canonicalizePuStudentId(member.studentId) !== studentId)) {
    reject(403, '目前無法確認你的在校身分，請重新登入。');
  }
}

function validCookies(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, item]) =>
    key && !/[\s;=\r\n]/.test(key) && typeof item === 'string' && !/[;\r\n]/.test(item),
  );
}

function positiveUserId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function verifyLmsIdentity(profile, studentId, loginUserId) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    reject(502, '暫時無法確認 WOW Class 的登入身分，請稍後重新連線。');
  }
  const nested = profile.user && typeof profile.user === 'object' && !Array.isArray(profile.user)
    ? profile.user : {};
  const userId = positiveUserId(profile.id ?? profile.user_id ?? profile.userId ??
    nested.id ?? nested.user_id ?? nested.userId);
  const identifiers = [profile, nested].flatMap((row) =>
    [row.login_name, row.user_no, row.user_name, row.userName, row.email]
      .map(canonicalizePuStudentId).filter(Boolean),
  );
  if (!userId || identifiers.length === 0) {
    reject(502, '暫時無法確認 WOW Class 的登入身分，請稍後重新連線。');
  }
  if (identifiers.some((value) => value !== studentId) ||
      (loginUserId != null && positiveUserId(loginUserId) !== userId)) {
    reject(403, 'WOW Class 帳號與目前登入的學號不一致。');
  }
  const name = profile.name ?? profile.display_name ?? nested.name ?? nested.display_name;
  return { userId, userName: typeof name === 'string' ? name.trim().slice(0, 200) : null };
}

function expiresAtMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    if (date instanceof Date) return date.getTime();
  }
  return Number.NaN;
}

function createPuTronClassRefresher({ db, login, fetchIdentityProfile, sessionTtlMs, now = Date.now }) {
  return async ({ authUser, studentId: rawStudentId, password }) => {
    const studentId = canonicalizePuStudentId(rawStudentId);
    if (!studentId || typeof password !== 'string' || !password) {
      reject(400, '請輸入有效的學號與密碼。');
    }
    const uid = requireCurrentStudent(authUser, studentId);
    const profileRef = db.doc(`users/${uid}`);
    const memberRef = db.doc(`schools/pu/members/${uid}`);
    const [profileSnapshot, memberSnapshot] = await Promise.all([profileRef.get(), memberRef.get()]);
    requireActiveAccount(profileSnapshot, memberSnapshot, studentId);

    const result = await login(rawStudentId.trim().toUpperCase(), password);
    if (result?.success !== true || !validCookies(result.cookies) || !result.session) {
      reject(401, 'TronClass 登入失敗，請確認學號與密碼。');
    }
    let identity;
    try {
      identity = await fetchIdentityProfile(result.cookies);
    } catch {
      reject(502, '暫時無法確認 WOW Class 的登入身分，請稍後重新連線。');
    }
    const verified = verifyLmsIdentity(identity?.profile, studentId, result.session.userId);
    if (!validCookies(identity.cookies)) {
      reject(502, '暫時無法建立 WOW Class 連線，請稍後重試。');
    }

    const tronClassSessionId = randomBytes(16).toString('hex');
    const sessionRef = db.doc(`_puTronClassSessions/${tronClassSessionId}`);
    const latestPortal = db.collection('_puSessions').where('ownerUid', '==', uid)
      .orderBy('expiresAt', 'desc').limit(1);

    await db.runTransaction(async (tx) => {
      const [currentProfile, currentMember] = await tx.getAll(profileRef, memberRef);
      requireActiveAccount(currentProfile, currentMember, studentId);
      const portals = await tx.get(latestPortal);
      const portalSnapshot = portals.docs[0];
      const portal = portalSnapshot?.data();
      const timestamp = now();
      tx.create(sessionRef, {
        studentId,
        ownerUid: uid,
        cookies: identity.cookies,
        userId: verified.userId,
        userName: verified.userName,
        createdAt: new Date(timestamp),
        expiresAt: new Date(timestamp + sessionTtlMs),
      });
      // Use the same latest portal selected by the course reader. Never attach an older
      // or client-selected portal, and keep a verified standalone LMS refresh usable.
      if (portalSnapshot?.exists && portal?.ownerUid === uid &&
          canonicalizePuStudentId(portal.studentId) === studentId &&
          expiresAtMillis(portal.expiresAt) > timestamp) {
        tx.update(portalSnapshot.ref, { tronClassSessionId });
      }
    });

    return { success: true, tronClassSessionId, tronClassUserId: verified.userId };
  };
}

module.exports = { canonicalizePuStudentId, createPuTronClassRefresher };
