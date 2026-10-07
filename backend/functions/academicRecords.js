const { HttpsError } = require('firebase-functions/v2/https');
const {
  assertTrustedOrigin,
  enforceRateLimit,
  requirePostJson,
  writeHttpError,
} = require('./securityUtils');
const { assertSessionOwner, verifyRequestFirebaseUser } = require('./sessionSecurity');

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
      const result = await fetchers[dataType](session.cookies, semester);
      if (!result?.success) {
        res.status(503).json({ error: result?.error || 'Failed to fetch campus data' });
        return;
      }
      res.json({ success: true, result });
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
      const result = await fetchers[dataType](session.cookies, '');
      if (result?.success === false && result.code === 'session-expired') {
        throw new HttpsError('failed-precondition', '校務連線已過期，請重新以學號登入。');
      }
      if (!result?.success || !Array.isArray(result[dataType])) {
        throw new HttpsError('unavailable', '目前無法取得學校資料，請稍後重試或重新以學號登入。');
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
        result,
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

module.exports = { createPuCampusDataHandler, createGetMyAcademicRecords };
