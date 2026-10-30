const { HttpsError } = require('firebase-functions/v2/https');
const {
  assertTrustedOrigin,
  enforceRateLimit,
  requirePostJson,
  writeHttpError,
} = require('./securityUtils');
const { assertSessionOwner, verifyRequestFirebaseUser } = require('./sessionSecurity');
const {
  publicCampusDataResult,
  persistOwnedMypuCookies,
  deleteOwnedPuSessions,
} = require('./lib/puSessionStore');
const {
  ECAMPUS_PAUSED_CODE,
  ECAMPUS_PAUSED_MESSAGE,
  isEcampusFetchPaused,
  isEcampusPausedResult,
} = require('./lib/ecampusFetchPause');

function sessionExpiresAt(session) {
  const value = session?.expiresAt?.toDate?.();
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function hasCookies(session) {
  return (
    session?.cookies &&
    typeof session.cookies === 'object' &&
    Object.keys(session.cookies).length > 0
  );
}

function cookieMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (
    !entries.length ||
    entries.some(
      ([key, item]) =>
        !key || /[\s;=\r\n]/.test(key) || typeof item !== 'string' || /[;\r\n]/.test(item),
    )
  ) {
    return null;
  }
  return Object.fromEntries(entries);
}

/** getMyAcademicRecords 的暫停回應：不是錯誤，前端顯示「E 校園資料暫停更新中」。 */
function pausedAcademicRecords(uid, dataType) {
  return {
    success: true,
    paused: true,
    code: ECAMPUS_PAUSED_CODE,
    message: ECAMPUS_PAUSED_MESSAGE,
    ownerUid: uid,
    schoolId: 'pu',
    source: 'pu-campus',
    dataType,
    fetchedAt: null,
    result: null,
  };
}

function createPuCampusDataHandler({ db, fetchers, logger = console }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      assertTrustedOrigin(req);
      requirePostJson(req);
      const authUser = await verifyRequestFirebaseUser(req);
      const sessionId = String(req.body?.sessionId || '').trim();
      const dataType = String(req.body?.dataType || '').trim();
      const semester = String(req.body?.semester || '').trim();
      if (!sessionId || !dataType || sessionId.includes('/')) {
        res.status(400).json({ error: 'Missing or invalid sessionId or dataType' });
        return;
      }
      if (!Object.hasOwn(fetchers, dataType)) {
        res.status(400).json({ error: 'Invalid dataType' });
        return;
      }
      enforceRateLimit({
        scope: 'pu-campus-fetch-data',
        key: `${authUser.uid}:${dataType}`,
        limit: 60,
        windowMs: 5 * 60 * 1000,
      });
      const sessionRef = db.collection('_puSessions').doc(sessionId);
      const sessionDoc = await sessionRef.get();
      if (!sessionDoc.exists) {
        res.status(401).json({ error: 'Invalid or expired PU session' });
        return;
      }
      const session = sessionDoc.data();
      // Verify ownership before reading campus data or deleting an expired session.
      assertSessionOwner(session, authUser.uid);
      const expiresAt = sessionExpiresAt(session);
      if (!hasCookies(session) || !expiresAt || expiresAt <= new Date()) {
        await sessionRef.delete().catch(() => null);
        res.status(401).json({ error: 'Invalid or expired PU session' });
        return;
      }
      if (isEcampusFetchPaused()) {
        res.status(503).json({ error: ECAMPUS_PAUSED_MESSAGE, code: ECAMPUS_PAUSED_CODE });
        return;
      }
      const result =
        dataType === 'grades'
          ? await fetchers.grades(session.cookies, semester, {
              mypuCookies: cookieMap(session.mypuCookies),
            })
          : await fetchers[dataType](session.cookies, semester);
      if (isEcampusPausedResult(result)) {
        res.status(503).json({ error: ECAMPUS_PAUSED_MESSAGE, code: ECAMPUS_PAUSED_CODE });
        return;
      }
      if (!result?.success) {
        res.status(503).json({ error: result?.error || 'Failed to fetch campus data' });
        return;
      }
      const nextMypu = dataType === 'grades' ? cookieMap(result.mypuCookies) : null;
      if (nextMypu) {
        await persistOwnedMypuCookies(db, sessionRef, authUser.uid, nextMypu);
      }
      res.json({ success: true, result: publicCampusDataResult(dataType, result) });
    } catch (error) {
      logger.error('PU campus data request failed', error?.message);
      writeHttpError(res, error, 'Failed to fetch PU campus data');
    }
  };
}

function createGetMyAcademicRecords({ db, assertActiveSchoolMember, fetchers, logger = console }) {
  async function requireMembership(uid) {
    const membership = await assertActiveSchoolMember('pu', uid);
    if (membership?.status !== 'active') {
      throw new HttpsError('permission-denied', '目前無法確認你的在校身份。');
    }
  }
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    const data = request.data ?? {};
    const dataType = data.dataType;
    if (
      !['courses', 'grades'].includes(dataType) ||
      Object.keys(data).some((key) => key !== 'dataType')
    ) {
      throw new HttpsError('invalid-argument', '請選擇課表或成績資料。');
    }
    if (request.auth.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '此帳號尚未連結靜宜大學。');
    }
    try {
      enforceRateLimit({
        scope: 'my-academic-records',
        key: `${uid}:${dataType}`,
        limit: 20,
        windowMs: 5 * 60 * 1000,
      });
      const profile = await db.collection('users').doc(uid).get();
      if (!profile.exists || profile.data()?.schoolId !== 'pu') {
        throw new HttpsError('permission-denied', '此帳號尚未連結靜宜大學。');
      }
      await requireMembership(uid);
      // E 校園暫停時不讀 session、不打學校，直接回暫停狀態。
      if (isEcampusFetchPaused()) return pausedAcademicRecords(uid, dataType);
      const now = new Date();
      // PU sessions use a fixed TTL, so the greatest expiry is the newest session.
      const sessions = await db
        .collection('_puSessions')
        .where('ownerUid', '==', uid)
        .where('expiresAt', '>', now)
        .orderBy('expiresAt', 'desc')
        .limit(1)
        .get();
      const session = sessions.docs[0]?.data();
      if (
        !session ||
        session.ownerUid !== uid ||
        !hasCookies(session) ||
        !sessionExpiresAt(session) ||
        sessionExpiresAt(session) <= now
      ) {
        throw new HttpsError('failed-precondition', '校務連線已過期，請重新以學號登入。');
      }
      const sessionSnap = sessions.docs[0];
      const result =
        dataType === 'grades'
          ? await fetchers.grades(session.cookies, '', {
              mypuCookies: cookieMap(session.mypuCookies),
            })
          : await fetchers[dataType](session.cookies, '');
      if (isEcampusPausedResult(result)) return pausedAcademicRecords(uid, dataType);
      if (result?.success === false && result.code === 'session-expired') {
        throw new HttpsError('failed-precondition', '校務連線已過期，請重新以學號登入。');
      }
      if (!result?.success || !Array.isArray(result[dataType])) {
        throw new HttpsError('unavailable', '目前無法取得學校資料，請稍後重試或重新以學號登入。');
      }
      const nextMypu = dataType === 'grades' ? cookieMap(result.mypuCookies) : null;
      if (nextMypu) {
        await persistOwnedMypuCookies(db, sessionSnap.ref, uid, nextMypu);
      }
      // A membership revoked while the school request was pending must not return data.
      await requireMembership(uid);
      return {
        success: true,
        ownerUid: uid,
        schoolId: 'pu',
        source: 'pu-campus',
        dataType,
        fetchedAt: new Date().toISOString(),
        result: publicCampusDataResult(dataType, result),
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error?.statusCode === 429) {
        throw new HttpsError('resource-exhausted', '更新次數過多，請稍後重試。');
      }
      logger.error('Academic records request failed', error?.message);
      throw new HttpsError('unavailable', '目前無法取得學校資料，請稍後重試。');
    }
  };
}

function createPuFetchData({ db, fetchers, logger = console }) {
  return async (request) => {
    try {
      const ownerUid = request.auth?.uid;
      if (!ownerUid) {
        throw new HttpsError('unauthenticated', 'Must be logged in');
      }

      const { sessionId, dataType, semester } = request.data || {};
      if (!sessionId || !dataType) {
        throw new HttpsError('invalid-argument', 'Missing sessionId or dataType');
      }

      const allowedTypes = ['courses', 'grades', 'announcements', 'studentInfo'];
      if (!allowedTypes.includes(dataType) || !Object.hasOwn(fetchers, dataType)) {
        throw new HttpsError('invalid-argument', `Invalid dataType: ${dataType}`);
      }

      enforceRateLimit({
        scope: 'pu-fetch-data',
        key: `pu-fetch-${sessionId}`,
        limit: 20,
        windowMs: 5 * 60 * 1000,
      });

      const sessionRef = db.collection('_puSessions').doc(sessionId);
      const sessionDoc = await sessionRef.get();
      if (!sessionDoc.exists) {
        throw new HttpsError('permission-denied', 'Invalid or expired session');
      }

      const sessionData = sessionDoc.data();
      if (sessionData.ownerUid !== ownerUid) {
        throw new HttpsError('permission-denied', 'Session does not belong to this user');
      }

      const now = new Date();
      if (sessionData.expiresAt.toDate() < now) {
        await sessionRef.delete().catch(() => null);
        throw new HttpsError('permission-denied', 'Session expired');
      }

      if (isEcampusFetchPaused()) {
        throw new HttpsError('unavailable', ECAMPUS_PAUSED_MESSAGE, { code: ECAMPUS_PAUSED_CODE });
      }
      const result =
        dataType === 'grades'
          ? await fetchers.grades(sessionData.cookies, semester || '', {
              mypuCookies: cookieMap(sessionData.mypuCookies),
            })
          : await fetchers[dataType](sessionData.cookies, semester || '');
      if (isEcampusPausedResult(result)) {
        throw new HttpsError('unavailable', ECAMPUS_PAUSED_MESSAGE, { code: ECAMPUS_PAUSED_CODE });
      }
      if (!result?.success) {
        throw new HttpsError('unavailable', result?.error || 'Failed to fetch data');
      }

      const nextMypu = dataType === 'grades' ? cookieMap(result.mypuCookies) : null;
      if (nextMypu) {
        await persistOwnedMypuCookies(db, sessionRef, ownerUid, nextMypu);
      }

      logger.log?.(`[puFetchData] Successfully fetched ${dataType} for session: ${sessionId}`);
      return publicCampusDataResult(dataType, result);
    } catch (error) {
      logger.error?.('[puFetchData] Error:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error.message);
    }
  };
}

function createClearPuCampusSessions({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    const deleted = await deleteOwnedPuSessions(db, uid);
    return { success: true, deleted };
  };
}

module.exports = {
  createPuCampusDataHandler,
  createGetMyAcademicRecords,
  createPuFetchData,
  createClearPuCampusSessions,
};
