const { getAppRuntimeEnv } = require('./securityUtils');

function isLocalMockAuthAllowed() {
  return (
    getAppRuntimeEnv() === 'development' &&
    String(process.env.ALLOW_LOCAL_MOCK_AUTH || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function getBearerToken(req) {
  const header = String(req.get?.('authorization') || req.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function verifyRequestFirebaseUser(req, verifyIdToken = null) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Missing Firebase ID token');
    error.statusCode = 401;
    throw error;
  }

  try {
    if (verifyIdToken) {
      return await verifyIdToken(token);
    }

    const { getAuth } = require('firebase-admin/auth');
    return await getAuth().verifyIdToken(token);
  } catch (error) {
    const authError = new Error('Invalid Firebase ID token');
    authError.statusCode = 401;
    authError.cause = error;
    throw authError;
  }
}

function assertSessionOwner(sessionData, uid) {
  if (!sessionData?.ownerUid) {
    if (isLocalMockAuthAllowed()) {
      return;
    }
    const error = new Error('Session is missing owner binding');
    error.statusCode = 401;
    throw error;
  }

  if (sessionData.ownerUid !== uid) {
    const error = new Error('Session does not belong to the authenticated user');
    error.statusCode = 403;
    throw error;
  }
}

module.exports = {
  assertSessionOwner,
  getBearerToken,
  isLocalMockAuthAllowed,
  verifyRequestFirebaseUser,
};
