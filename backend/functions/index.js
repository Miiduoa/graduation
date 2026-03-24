const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const https = require('https');
const nodeCrypto = require('crypto');
const {
  SERVICE_ROLE_DOMAINS,
  buildSchoolDirectoryProfile,
  createAuthzHelpers,
  normalizeServiceRoleRecord,
  toSchoolMemberRole,
} = require('./authz');
const {
  evaluateSsoConfiguration,
  getProviderAdapter,
  normalizeSetupStatus,
  toPublicSsoConfig,
} = require('./sso/providerRegistry');
const { createNotificationService } = require('./lib/notificationService');
const {
  decryptSecretConfig,
  encryptSecretConfig,
  mergeSsoConfig,
  splitSsoConfig,
} = require('./sso/secretStore');
const { createValidationHelpers } = require('./security/validation');
const {
  assertTrustedOrigin,
  enforceRateLimit,
  getAppRuntimeEnv,
  getClientIp,
  getCorsOrigins,
  isProductionRuntime,
  isUniversalDevAccountsEnabled,
  requirePostJson,
  writeHttpError,
} = require('./securityUtils');
const {
  normalizeCafeteriaPilotStatus,
  resolveCafeteriaOrderingMetadata,
} = require('./cafeterias');

// TDX API 金鑰（透過 firebase functions:secrets:set 設定）
const TDX_CLIENT_ID = defineSecret('TDX_CLIENT_ID');
const TDX_CLIENT_SECRET = defineSecret('TDX_CLIENT_SECRET');
const SSO_CONFIG_ENCRYPTION_KEY = defineSecret('SSO_CONFIG_ENCRYPTION_KEY');

// TDX OAuth2 取得 Access Token
async function getTdxAccessToken(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    const options = {
      hostname: 'tdx.transportdata.tw',
      path: '/auth/realms/TDXConnect/protocol/openid-connect/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`TDX token error: ${data}`));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 呼叫 TDX API
async function fetchTdxApi(path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'tdx.transportdata.tw',
      path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

initializeApp();

const db = getFirestore();
const messaging = getMessaging();
const { getUserPushTokens, sendPushToUser, sendPushToMultipleUsers } = createNotificationService({
  db,
  messaging,
});
const {
  assertActiveSchoolMember,
  assertCafeteriaOperator,
  assertSchoolAdminOrEditor,
  assertServiceRole,
  getActiveSchoolMembership,
} = createAuthzHelpers(db);

const REGION = 'asia-east1';
const SSO_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WALLET_CURRENCY = 'TWD';
const EXTERNAL_PAYMENT_ENABLED = !isProductionRuntime();
const STRICT_CORS = getCorsOrigins();

// =====================================================
// 工具函數
// =====================================================

function normalizeSsoConfig(rawConfig = {}) {
  return {
    ...rawConfig,
    authorizationEndpoint: rawConfig.authorizationEndpoint || rawConfig.authUrl,
    authUrl: rawConfig.authUrl || rawConfig.authorizationEndpoint,
    tokenEndpoint: rawConfig.tokenEndpoint || rawConfig.tokenUrl,
    tokenUrl: rawConfig.tokenUrl || rawConfig.tokenEndpoint,
    userInfoEndpoint: rawConfig.userInfoEndpoint || rawConfig.userInfoUrl,
    userInfoUrl: rawConfig.userInfoUrl || rawConfig.userInfoEndpoint,
    samlEntryPoint: rawConfig.samlEntryPoint || rawConfig.idpSsoUrl,
    idpSsoUrl: rawConfig.idpSsoUrl || rawConfig.samlEntryPoint,
  };
}

function isAllowedRedirectUri(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  if (/^campus:\/\/auth\/callback(?:[/?#]|$)/i.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return STRICT_CORS.some((matcher) =>
      matcher instanceof RegExp ? matcher.test(parsed.origin) : parsed.origin === matcher,
    );
  } catch {
    return false;
  }
}

function getSsoPrivateDocRef(schoolId) {
  return db.collection('schools').doc(schoolId).collection('settings').doc('ssoPrivate');
}

async function getSchoolSsoDocuments(schoolId) {
  const [publicDoc, privateDoc] = await Promise.all([
    db.collection('schools').doc(schoolId).collection('settings').doc('sso').get(),
    getSsoPrivateDocRef(schoolId).get(),
  ]);

  return { publicDoc, privateDoc };
}

async function getFullSchoolSsoConfig(schoolId, encryptionKey) {
  const { publicDoc, privateDoc } = await getSchoolSsoDocuments(schoolId);
  const publicConfig = publicDoc.exists ? publicDoc.data() : null;
  const privateConfig = privateDoc.exists
    ? decryptSecretConfig(privateDoc.data()?.encryptedPayload, encryptionKey)
    : {};

  if (!publicConfig) {
    return null;
  }

  const merged = mergeSsoConfig(publicConfig, privateConfig);
  merged.schoolId = merged.schoolId || schoolId;
  merged.ssoConfig = merged.ssoConfig ? normalizeSsoConfig(merged.ssoConfig) : null;
  return merged;
}

async function writeSchoolSsoConfig({
  schoolId,
  publicConfig,
  secretConfig,
  encryptionKey,
  updatedBy,
}) {
  const publicRef = db.collection('schools').doc(schoolId).collection('settings').doc('sso');
  const privateRef = getSsoPrivateDocRef(schoolId);
  const encryptedPayload = encryptSecretConfig(secretConfig, encryptionKey);

  const publicPayload = {
    ...publicConfig,
    schoolId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy,
  };

  const writes = [publicRef.set(publicPayload, { merge: true })];

  if (encryptedPayload) {
    writes.push(
      privateRef.set(
        {
          encryptedPayload,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy,
        },
        { merge: true },
      ),
    );
  } else {
    writes.push(privateRef.delete().catch(() => null));
  }

  await Promise.all(writes);
}

async function syncAuthClaims(uid, userData = {}) {
  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();
  const currentUser = await db.collection('users').doc(uid).get();
  const profile = currentUser.exists ? currentUser.data() : {};
  const role = userData.role || profile?.role || 'student';
  const schoolId = userData.schoolId || profile?.schoolId || null;

  await auth.setCustomUserClaims(uid, {
    role,
    ...(schoolId ? { schoolId } : {}),
  });
}

async function resolveUserSchoolId(uid, preferredSchoolId = null) {
  if (preferredSchoolId) {
    return preferredSchoolId;
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    return null;
  }

  const userData = userDoc.data() || {};
  return userData.primarySchoolId || userData.schoolId || null;
}

function getUserSchoolScope(uid, schoolId) {
  return db.collection('users').doc(uid).collection('schools').doc(schoolId);
}

function getUserSchoolCollection(uid, schoolId, collectionName) {
  return getUserSchoolScope(uid, schoolId).collection(collectionName);
}

function getUserSchoolDoc(uid, schoolId, collectionName, docId) {
  return getUserSchoolCollection(uid, schoolId, collectionName).doc(docId);
}

function buildAvailabilityUpdate(currentData = {}, delta) {
  const updates = {};

  if (typeof currentData.availableCopies === 'number') {
    updates.availableCopies = FieldValue.increment(delta);
  }

  if (typeof currentData.available === 'number') {
    updates.available = FieldValue.increment(delta);
  }

  if (Object.keys(updates).length === 0) {
    updates.availableCopies = FieldValue.increment(delta);
  }

  return updates;
}

function resolveProvisionedRole({ existingLink, existingUser }) {
  return existingLink?.role || existingUser?.role || 'student';
}

const UNIVERSAL_DEV_ACCOUNT_PASSWORD = 'nickkookoo';
const UNIVERSAL_DEV_ACCOUNTS = [
  {
    uid: 'dev-universal-student',
    email: 'demohan513@gmail.com',
    displayName: '跨校測試學生',
    role: 'student',
  },
  {
    uid: 'dev-universal-teacher',
    email: 'miiduoa@icloud.com',
    displayName: '跨校測試教師',
    role: 'teacher',
  },
];

function normalizeDevAccountEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function authenticateUniversalDevAccount(email, password) {
  const normalizedEmail = normalizeDevAccountEmail(email);
  const normalizedPassword = String(password || '').trim();

  return (
    UNIVERSAL_DEV_ACCOUNTS.find(
      (account) =>
        account.email === normalizedEmail &&
        normalizedPassword === UNIVERSAL_DEV_ACCOUNT_PASSWORD,
    ) || null
  );
}

async function provisionUniversalDevAccount({ account, schoolId }) {
  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();

  let userRecord = null;
  let createdAuthUser = false;

  try {
    userRecord = await auth.getUserByEmail(account.email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  if (!userRecord) {
    try {
      userRecord = await auth.getUser(account.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        throw error;
      }
    }
  }

  if (userRecord) {
    userRecord = await auth.updateUser(userRecord.uid, {
      email: account.email,
      password: UNIVERSAL_DEV_ACCOUNT_PASSWORD,
      displayName: account.displayName,
      emailVerified: true,
      disabled: false,
    });
  } else {
    userRecord = await auth.createUser({
      uid: account.uid,
      email: account.email,
      password: UNIVERSAL_DEV_ACCOUNT_PASSWORD,
      displayName: account.displayName,
      emailVerified: true,
    });
    createdAuthUser = true;
  }

  const uid = userRecord.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const memberRef = db.collection('schools').doc(schoolId).collection('members').doc(uid);
  const memberDoc = await memberRef.get();

  await userRef.set(
    {
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      schoolId,
      primarySchoolId: schoolId,
      lastLoginAt: FieldValue.serverTimestamp(),
      devUniversalAccount: true,
      devUniversalScope: 'all-schools',
      schoolIds: FieldValue.arrayUnion(schoolId),
      ...(userDoc.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  await memberRef.set(
    {
      status: 'active',
      role: toSchoolMemberRole(account.role),
      devUniversalAccount: true,
      updatedAt: FieldValue.serverTimestamp(),
      ...(memberDoc.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  await syncAuthClaims(uid, {
    role: account.role,
    schoolId,
  });

  const customToken = await auth.createCustomToken(uid, {
    role: account.role,
    schoolId,
    devUniversalAccount: true,
  });

  return {
    uid,
    customToken,
    isNewUser: createdAuthUser || !userDoc.exists,
    role: account.role,
    displayName: account.displayName,
    email: account.email,
  };
}

async function reserveSsoTransaction({
  schoolId,
  provider,
  redirectUri,
  state,
  codeChallenge,
  nonce,
  source,
}) {
  const transactionRef = db.collection('ssoTransactions').doc();
  const now = Date.now();
  await transactionRef.set({
    schoolId,
    provider,
    redirectUri,
    state,
    codeChallenge: codeChallenge || null,
    nonce: nonce || null,
    source: source || 'unknown',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + SSO_TRANSACTION_TTL_MS),
    usedAt: null,
  });

  return {
    transactionId: transactionRef.id,
    expiresAt: new Date(now + SSO_TRANSACTION_TTL_MS).toISOString(),
  };
}

async function validateAndConsumeSsoTransaction({
  transactionId,
  schoolId,
  provider,
  redirectUri,
  state,
}) {
  const transactionRef = db.collection('ssoTransactions').doc(transactionId);
  const transactionDoc = await transactionRef.get();

  if (!transactionDoc.exists) {
    throw new HttpsError('not-found', 'SSO transaction not found');
  }

  const transactionData = transactionDoc.data();
  if (transactionData.usedAt) {
    throw new HttpsError('failed-precondition', 'SSO transaction already used');
  }

  if (transactionData.schoolId !== schoolId || transactionData.provider !== provider) {
    throw new HttpsError('permission-denied', 'SSO transaction does not match the current request');
  }

  if (transactionData.redirectUri !== redirectUri || transactionData.state !== state) {
    throw new HttpsError('permission-denied', 'SSO transaction validation failed');
  }

  const expiresAt = transactionData.expiresAt?.toDate?.();
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'SSO transaction has expired');
  }

  await db.runTransaction(async (transaction) => {
    const latestDoc = await transaction.get(transactionRef);
    const latest = latestDoc.data();
    if (!latestDoc.exists || latest?.usedAt) {
      throw new HttpsError('failed-precondition', 'SSO transaction already used');
    }
    transaction.update(transactionRef, {
      usedAt: FieldValue.serverTimestamp(),
    });
  });

  return transactionData;
}

function isSupportedExternalPaymentMethod(method) {
  return [
    'credit_card',
    'line_pay',
    'jko_pay',
    'apple_pay',
    'google_pay',
    'bank_transfer',
  ].includes(method);
}

async function getWalletSnapshot(uid, schoolId = null) {
  const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
  const canonicalWalletRef = resolvedSchoolId
    ? getUserSchoolDoc(uid, resolvedSchoolId, 'wallet', 'balance')
    : null;
  const canonicalWalletDoc = canonicalWalletRef ? await canonicalWalletRef.get() : null;
  const legacyWalletRef = db.collection('wallets').doc(uid);
  const legacyWalletDoc =
    !canonicalWalletDoc || !canonicalWalletDoc.exists ? await legacyWalletRef.get() : null;
  const wallet =
    canonicalWalletDoc && canonicalWalletDoc.exists
      ? canonicalWalletDoc.data()
      : legacyWalletDoc && legacyWalletDoc.exists
        ? legacyWalletDoc.data()
        : {
            available: 0,
            pending: 0,
            currency: DEFAULT_WALLET_CURRENCY,
          };

  return {
    ref: canonicalWalletRef || legacyWalletRef,
    legacyRef: legacyWalletRef,
    schoolId: resolvedSchoolId,
    data: wallet,
  };
}

async function appendWalletLedgerEntry({
  uid,
  schoolId = null,
  amount,
  type,
  status,
  description,
  paymentMethod,
  merchantId = null,
  sourceCollection = null,
  sourceId = null,
  metadata = {},
}) {
  const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);
  if (!resolvedSchoolId) {
    throw new HttpsError('invalid-argument', 'Missing schoolId');
  }

  const walletRef = getUserSchoolDoc(uid, resolvedSchoolId, 'wallet', 'balance');
  const legacyWalletRef = db.collection('wallets').doc(uid);
  const transactionRef = getUserSchoolCollection(uid, resolvedSchoolId, 'transactions').doc();

  await db.runTransaction(async (transaction) => {
    const walletDoc = await transaction.get(walletRef);
    const legacyWalletDoc = walletDoc.exists ? null : await transaction.get(legacyWalletRef);
    const wallet = walletDoc.exists
      ? walletDoc.data()
      : legacyWalletDoc && legacyWalletDoc.exists
        ? legacyWalletDoc.data()
        : {
            available: 0,
            pending: 0,
            currency: DEFAULT_WALLET_CURRENCY,
          };

    const currentAvailable = Number(wallet.available || 0);
    const nextAvailable = currentAvailable + amount;
    if (nextAvailable < 0) {
      throw new HttpsError('failed-precondition', 'Insufficient wallet balance');
    }

    const walletPayload = {
      available: nextAvailable,
      pending: Number(wallet.pending || 0),
      currency: wallet.currency || DEFAULT_WALLET_CURRENCY,
      lastUpdated: FieldValue.serverTimestamp(),
    };

    const ledgerPayload = {
      userId: uid,
      schoolId: resolvedSchoolId,
      amount,
      currency: walletPayload.currency,
      type,
      status,
      description,
      paymentMethod: paymentMethod || null,
      merchantId,
      sourceCollection,
      sourceId,
      metadata,
      balanceAfter: nextAvailable,
      createdAt: FieldValue.serverTimestamp(),
    };

    transaction.set(walletRef, walletPayload, { merge: true });
    transaction.set(
      transactionRef,
      {
        ...ledgerPayload,
        amount: Math.abs(amount),
        paymentMethodId: paymentMethod || null,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      db.collection('users').doc(uid),
      {
        balance: nextAvailable,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  const walletDoc = await walletRef.get();
  return {
    ledgerEntryId: transactionRef.id,
    schoolId: resolvedSchoolId,
    balance: Number(walletDoc.data()?.available || 0),
  };
}

async function getSchoolMemberUids(schoolId) {
  const membersSnap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('members')
    .where('status', '==', 'active')
    .get();
  return membersSnap.docs.map((doc) => doc.id);
}

async function getGroupMemberUids(groupId) {
  const membersSnap = await db
    .collection('groups')
    .doc(groupId)
    .collection('members')
    .where('status', '==', 'active')
    .get();
  return membersSnap.docs.map((doc) => doc.id);
}

function getSchoolDirectoryRef(schoolId, uid) {
  return db.collection('schools').doc(schoolId).collection('directory').doc(uid);
}

async function syncSchoolDirectoryEntry({ schoolId, uid, userData = null, membership = null }) {
  if (!schoolId || !uid) return;

  const [resolvedUserData, resolvedMembership] = await Promise.all([
    userData
      ? Promise.resolve(userData)
      : db
          .collection('users')
          .doc(uid)
          .get()
          .then((docSnap) => (docSnap.exists ? docSnap.data() : null)),
    membership ? Promise.resolve(membership) : getActiveSchoolMembership(schoolId, uid),
  ]);

  const directoryRef = getSchoolDirectoryRef(schoolId, uid);

  if (!resolvedUserData || !resolvedMembership) {
    await directoryRef.delete().catch(() => null);
    return;
  }

  const profile = buildSchoolDirectoryProfile({
    uid,
    userData: resolvedUserData,
    membership: resolvedMembership,
  });

  await directoryRef.set(
    {
      ...profile,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system-sync',
    },
    { merge: true },
  );
}

async function syncDirectoryEntriesForUser(uid, userData = null) {
  if (!uid) return;

  const membershipsSnap = await db
    .collectionGroup('members')
    .where(FieldPath.documentId(), '==', uid)
    .get()
    .catch(() => null);

  if (!membershipsSnap) return;

  const activeSchoolIds = [];
  for (const membershipDoc of membershipsSnap.docs) {
    const schoolId = membershipDoc.ref.parent.parent?.id;
    const membership = membershipDoc.data() || {};
    if (!schoolId) continue;

    if (membership.status && membership.status !== 'active') {
      await getSchoolDirectoryRef(schoolId, uid)
        .delete()
        .catch(() => null);
      continue;
    }

    activeSchoolIds.push(schoolId);
    await syncSchoolDirectoryEntry({
      schoolId,
      uid,
      userData,
      membership,
    });
  }

  if (activeSchoolIds.length === 0) {
    const schoolsSnap = await db
      .collection('schools')
      .get()
      .catch(() => null);
    for (const schoolDoc of schoolsSnap?.docs ?? []) {
      await getSchoolDirectoryRef(schoolDoc.id, uid)
        .delete()
        .catch(() => null);
    }
  }
}

async function logAdminAction({ schoolId, action, details = '', actorUid = '', actorEmail = '' }) {
  if (!schoolId || !action) return;

  await db.collection('schools').doc(schoolId).collection('adminLogs').add({
    action,
    details,
    actorUid,
    actorEmail,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function chunkItems(items, size = 400) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const {
  trimString,
  optionalTrimmedString,
  parsePositiveInteger,
  parseTimestampInput,
} = createValidationHelpers({
  HttpsError,
  FieldValue,
  Timestamp,
  toJsDate: (value) => toJsDate(value),
});

function normalizeSchoolAnnouncementInput(input = {}) {
  const title = trimString(input.title, 160);
  if (!title) {
    throw new HttpsError('invalid-argument', 'Announcement title is required');
  }

  return {
    title,
    body: trimString(input.body, 4000),
    source: optionalTrimmedString(input.source, 160),
    pinned: input.pinned === true,
  };
}

function normalizeSchoolEventInput(input = {}) {
  const title = trimString(input.title, 160);
  if (!title) {
    throw new HttpsError('invalid-argument', 'Event title is required');
  }

  const startsAt = parseTimestampInput(input.startsAt, 'startsAt', { required: false });
  const endsAt = parseTimestampInput(input.endsAt, 'endsAt', { required: false });
  const startsAtDate = startsAt instanceof Timestamp ? startsAt.toDate() : null;
  const endsAtDate = endsAt instanceof Timestamp ? endsAt.toDate() : null;

  if (startsAtDate && endsAtDate && endsAtDate.getTime() <= startsAtDate.getTime()) {
    throw new HttpsError('invalid-argument', 'endsAt must be later than startsAt');
  }

  return {
    title,
    description: trimString(input.description, 4000),
    location: trimString(input.location, 300),
    capacity: parsePositiveInteger(input.capacity, 'capacity'),
    startsAt,
    endsAt,
  };
}

function normalizeCafeteriaConfigInput(input = {}) {
  const cafeteriaId = trimString(input.cafeteriaId, 160);
  const name = trimString(input.name, 160);

  if (!cafeteriaId || !name) {
    throw new HttpsError('invalid-argument', 'Missing cafeteriaId or name');
  }

  return {
    cafeteriaId,
    name,
    location: optionalTrimmedString(input.location, 300),
    openingHours: optionalTrimmedString(input.openingHours, 300),
    brandKey: optionalTrimmedString(input.brandKey, 120),
    pilotStatus: normalizeCafeteriaPilotStatus(input.pilotStatus),
    orderingEnabled: input.orderingEnabled === true,
  };
}

function normalizeCafeteriaOperatorInput(input = {}) {
  const targetUid = trimString(input.targetUid, 160);
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Missing targetUid');
  }

  const role = ['owner', 'manager', 'staff'].includes(input.role) ? input.role : 'staff';
  const status = input.status === 'inactive' ? 'inactive' : 'active';

  return {
    targetUid,
    role,
    status,
    displayName: optionalTrimmedString(input.displayName, 160),
    email: optionalTrimmedString(input.email, 320),
  };
}

function getCafeteriaRef(schoolId, cafeteriaId) {
  return db.collection('schools').doc(schoolId).collection('cafeterias').doc(cafeteriaId);
}

async function syncCafeteriaOperatorCount(schoolId, cafeteriaId) {
  if (!schoolId || !cafeteriaId) return 0;

  const activeOperatorsSnap = await getCafeteriaRef(schoolId, cafeteriaId)
    .collection('operators')
    .where('status', '==', 'active')
    .get();

  const activeOperatorCount = activeOperatorsSnap.size;
  await getCafeteriaRef(schoolId, cafeteriaId).set(
    {
      activeOperatorCount,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return activeOperatorCount;
}

async function cafeteriaHasActiveOperator(schoolId, cafeteriaId) {
  const activeOperatorsSnap = await getCafeteriaRef(schoolId, cafeteriaId)
    .collection('operators')
    .where('status', '==', 'active')
    .limit(1)
    .get();

  return !activeOperatorsSnap.empty;
}

function generateGroupJoinCode(length = 8) {
  return nodeCrypto
    .randomBytes(length)
    .toString('base64url')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, length);
}

function normalizeAssistantText(value) {
  return String(value ?? '').trim();
}

function includesAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message.content === 'string') {
      return message.content.trim();
    }
  }
  return '';
}

function detectCampusAssistantIntent(rawText) {
  const text = normalizeAssistantText(rawText).toLowerCase();

  if (!text) return 'general';
  if (includesAnyKeyword(text, ['作業', '截止', 'deadline', '待辦', '繳交', 'due']))
    return 'assignment_status';
  if (includesAnyKeyword(text, ['公告', '消息', '通知'])) return 'announcements';
  if (includesAnyKeyword(text, ['活動', '講座', '演講', '報名', '參加'])) return 'events';
  if (includesAnyKeyword(text, ['吃', '午餐', '晚餐', '早餐', '餐', '菜單', '推薦']))
    return 'menus';
  if (
    includesAnyKeyword(text, ['在哪', '怎麼走', '地點', '位置', '圖書館', '教室', '行政', '餐廳'])
  )
    return 'pois';
  if (includesAnyKeyword(text, ['學分', '畢業', '選課'])) return 'credit_audit';
  if (includesAnyKeyword(text, ['功能', '怎麼用', '說明', '幫助'])) return 'help';
  if (includesAnyKeyword(text, ['摘要', '規劃', '今天', '今日', '成績', '提升', '安排']))
    return 'study_summary';
  return 'general';
}

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatAssistantDate(value, includeTime = false) {
  const date = toJsDate(value);
  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(
    'zh-TW',
    includeTime
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { month: 'numeric', day: 'numeric' },
  ).format(date);
}

function mapDocData(docSnap) {
  return { id: docSnap.id, ...(docSnap.data() || {}) };
}

async function fetchAssistantAnnouncements(schoolId) {
  if (!schoolId) return [];

  const rootSnap = await db
    .collection('announcements')
    .where('schoolId', '==', schoolId)
    .orderBy('publishedAt', 'desc')
    .limit(5)
    .get()
    .catch(() => null);

  if (rootSnap && !rootSnap.empty) {
    return rootSnap.docs.map(mapDocData);
  }

  const schoolSnap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('announcements')
    .orderBy('publishedAt', 'desc')
    .limit(5)
    .get()
    .catch(() => null);

  return schoolSnap?.docs.map(mapDocData) ?? [];
}

async function fetchAssistantEvents(schoolId) {
  if (!schoolId) return [];

  const rootSnap = await db
    .collection('events')
    .where('schoolId', '==', schoolId)
    .orderBy('startsAt', 'asc')
    .limit(10)
    .get()
    .catch(() => null);

  if (rootSnap && !rootSnap.empty) {
    return rootSnap.docs.map(mapDocData);
  }

  const schoolEvents = await db
    .collection('schools')
    .doc(schoolId)
    .collection('events')
    .orderBy('startsAt', 'asc')
    .limit(10)
    .get()
    .catch(() => null);

  if (schoolEvents && !schoolEvents.empty) {
    return schoolEvents.docs.map(mapDocData);
  }

  const schoolClubEvents = await db
    .collection('schools')
    .doc(schoolId)
    .collection('clubEvents')
    .orderBy('startsAt', 'asc')
    .limit(10)
    .get()
    .catch(() => null);

  return schoolClubEvents?.docs.map(mapDocData) ?? [];
}

async function fetchAssistantMenus(schoolId) {
  if (!schoolId) return [];

  const rootSnap = await db
    .collection('menus')
    .where('schoolId', '==', schoolId)
    .orderBy('availableOn', 'desc')
    .limit(8)
    .get()
    .catch(() => null);

  if (rootSnap && !rootSnap.empty) {
    return rootSnap.docs.map(mapDocData);
  }

  const schoolMenus = await db
    .collection('schools')
    .doc(schoolId)
    .collection('menus')
    .limit(8)
    .get()
    .catch(() => null);

  if (schoolMenus && !schoolMenus.empty) {
    return schoolMenus.docs.map(mapDocData);
  }

  const cafeteriaMenus = await db
    .collection('schools')
    .doc(schoolId)
    .collection('cafeteriaMenus')
    .limit(8)
    .get()
    .catch(() => null);

  return cafeteriaMenus?.docs.map(mapDocData) ?? [];
}

async function fetchAssistantPois(schoolId) {
  if (!schoolId) return [];

  const rootSnap = await db
    .collection('pois')
    .where('schoolId', '==', schoolId)
    .limit(20)
    .get()
    .catch(() => null);

  if (rootSnap && !rootSnap.empty) {
    return rootSnap.docs.map(mapDocData);
  }

  const schoolSnap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('pois')
    .limit(20)
    .get()
    .catch(() => null);

  return schoolSnap?.docs.map(mapDocData) ?? [];
}

async function fetchAssistantUserProfile(uid) {
  if (!uid) return null;
  const userDoc = await db
    .collection('users')
    .doc(uid)
    .get()
    .catch(() => null);
  return userDoc?.exists ? userDoc.data() : null;
}

async function fetchAssistantWeeklyReport(uid) {
  if (!uid) return null;

  const weeklySnap = await db
    .collection('users')
    .doc(uid)
    .collection('weeklyReports')
    .orderBy('generatedAt', 'desc')
    .limit(1)
    .get()
    .catch(() => null);

  if (weeklySnap && !weeklySnap.empty) {
    return weeklySnap.docs[0].data();
  }

  return null;
}

async function fetchAssistantPendingAssignments(uid, preferredGroupId) {
  if (!uid) return [];

  const groupsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('groups')
    .where('status', '==', 'active')
    .limit(10)
    .get()
    .catch(() => null);

  const groupDocs = groupsSnap?.docs ?? [];
  const groupMap = new Map(groupDocs.map((docSnap) => [docSnap.id, docSnap.data() || {}]));
  const groupIds = groupDocs.map((docSnap) => docSnap.id);

  if (preferredGroupId && groupIds.includes(preferredGroupId)) {
    groupIds.splice(groupIds.indexOf(preferredGroupId), 1);
    groupIds.unshift(preferredGroupId);
  }

  const now = Timestamp.now();
  const rows = await Promise.all(
    groupIds.slice(0, 8).map(async (groupId) => {
      const snap = await db
        .collection('groups')
        .doc(groupId)
        .collection('assignments')
        .where('dueAt', '>', now)
        .orderBy('dueAt', 'asc')
        .limit(groupId === preferredGroupId ? 5 : 3)
        .get()
        .catch(() => null);

      const groupName = groupMap.get(groupId)?.name ?? groupId;
      return (snap?.docs ?? []).map((docSnap) => ({
        id: docSnap.id,
        groupId,
        groupName,
        ...docSnap.data(),
      }));
    }),
  );

  return rows
    .flat()
    .sort(
      (a, b) =>
        (toJsDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (toJsDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 8);
}

function buildPoiResponse(queryText, pois) {
  const normalizedQuery = normalizeAssistantText(queryText);
  if (!normalizedQuery || pois.length === 0) return null;

  const best = pois
    .map((poi) => {
      let score = 0;
      const haystacks = [poi.name, poi.category, poi.description].map((value) =>
        String(value ?? ''),
      );
      haystacks.forEach((value) => {
        if (normalizedQuery.includes(value) || value.includes(normalizedQuery)) score += 3;
      });
      ['圖書館', '行政', '餐廳', '宿舍', '健康', '教室'].forEach((keyword) => {
        if (normalizedQuery.includes(keyword) && haystacks.some((value) => value.includes(keyword)))
          score += 2;
      });
      return { poi, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  return best?.score > 0 ? best.poi : pois[0];
}

// =====================================================
// 公告通知
// =====================================================

exports.onAnnouncementCreated = onDocumentCreated(
  {
    document: 'schools/{schoolId}/announcements/{announcementId}',
    region: REGION,
  },
  async (event) => {
    const { schoolId, announcementId } = event.params;
    const announcement = event.data?.data();

    if (!announcement) return;

    console.log(`New announcement in school ${schoolId}: ${announcement.title}`);

    const memberUids = await getSchoolMemberUids(schoolId);
    if (memberUids.length === 0) {
      console.log('No members to notify');
      return;
    }

    const notification = {
      title: `📢 ${announcement.source || '校園公告'}`,
      body: announcement.title || '(無標題)',
    };

    const data = {
      type: 'announcement',
      announcementId,
      schoolId,
      channel: 'announcements',
    };

    const results = await sendPushToMultipleUsers(memberUids, notification, data, 'announcements');
    console.log(`Announcement notification results:`, results.length);

    await db
      .collection('schools')
      .doc(schoolId)
      .collection('announcements')
      .doc(announcementId)
      .update({
        notificationSentAt: FieldValue.serverTimestamp(),
      });
  },
);

// =====================================================
// 活動通知
// =====================================================

exports.onEventCreated = onDocumentCreated(
  {
    document: 'schools/{schoolId}/clubEvents/{eventId}',
    region: REGION,
  },
  async (event) => {
    const { schoolId, eventId } = event.params;
    const eventData = event.data?.data();

    if (!eventData) return;

    console.log(`New event in school ${schoolId}: ${eventData.title}`);

    const memberUids = await getSchoolMemberUids(schoolId);
    if (memberUids.length === 0) return;

    const notification = {
      title: '🎉 新活動',
      body: eventData.title || '(無標題)',
    };

    const data = {
      type: 'event',
      eventId,
      schoolId,
      channel: 'events',
    };

    await sendPushToMultipleUsers(memberUids, notification, data, 'events');
  },
);

exports.eventReminder = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    const now = Timestamp.now();
    const oneDayLater = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);

    const schoolsSnap = await db.collection('schools').get();

    for (const schoolDoc of schoolsSnap.docs) {
      const schoolId = schoolDoc.id;

      const eventsSnap = await db
        .collection('schools')
        .doc(schoolId)
        .collection('clubEvents')
        .where('startsAt', '>=', now)
        .where('startsAt', '<=', oneDayLater)
        .get();

      for (const eventDoc of eventsSnap.docs) {
        const eventData = eventDoc.data();
        const eventId = eventDoc.id;
        const startsAt = eventData.startsAt?.toMillis();

        if (!startsAt) continue;

        const diffMs = startsAt - now.toMillis();
        const diffHours = diffMs / (1000 * 60 * 60);

        let reminderType = null;
        if (diffHours <= 1 && diffHours > 0.75 && !eventData.reminder1hSent) {
          reminderType = '1h';
        } else if (diffHours <= 24 && diffHours > 23.75 && !eventData.reminder1dSent) {
          reminderType = '1d';
        }

        if (!reminderType) continue;

        const registrationsSnap = await db
          .collection('schools')
          .doc(schoolId)
          .collection('registrations')
          .where('eventId', '==', eventId)
          .get();

        const registeredUids = registrationsSnap.docs.map((d) => d.data().userId).filter(Boolean);
        if (registeredUids.length === 0) continue;

        const notification = {
          title: reminderType === '1h' ? '⏰ 活動即將開始' : '📅 活動提醒',
          body: `${eventData.title} ${reminderType === '1h' ? '將在 1 小時後開始' : '明天將舉行'}`,
        };

        const data = {
          type: 'event_reminder',
          eventId,
          schoolId,
          reminderType,
          channel: 'events',
        };

        await sendPushToMultipleUsers(registeredUids, notification, data, 'events');

        await eventDoc.ref.update({
          [`reminder${reminderType === '1h' ? '1h' : '1d'}Sent`]: true,
        });

        console.log(
          `Sent ${reminderType} reminder for event ${eventId} to ${registeredUids.length} users`,
        );
      }
    }
  },
);

// =====================================================
// 群組通知
// =====================================================

exports.onGroupPostCreated = onDocumentCreated(
  {
    document: 'groups/{groupId}/posts/{postId}',
    region: REGION,
  },
  async (event) => {
    const { groupId, postId } = event.params;
    const post = event.data?.data();

    if (!post) return;

    const authorId = post.authorId;
    const memberUids = await getGroupMemberUids(groupId);
    const targetUids = memberUids.filter((uid) => uid !== authorId);

    if (targetUids.length === 0) return;

    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupName = groupDoc.data()?.name || '群組';

    let title = '';
    let categoryPref = 'groups';

    switch (post.kind) {
      case 'announcement':
        title = `📢 ${groupName}`;
        break;
      case 'question':
        title = `❓ ${groupName}`;
        break;
      default:
        title = `💬 ${groupName}`;
    }

    const notification = {
      title,
      body: post.title || post.body?.slice(0, 50) || '(新貼文)',
    };

    const data = {
      type: 'group_post',
      groupId,
      postId,
      channel: 'groups',
    };

    await sendPushToMultipleUsers(targetUids, notification, data, categoryPref);
  },
);

exports.onAssignmentCreated = onDocumentCreated(
  {
    document: 'groups/{groupId}/assignments/{assignmentId}',
    region: REGION,
  },
  async (event) => {
    const { groupId, assignmentId } = event.params;
    const assignment = event.data?.data();

    if (!assignment) return;

    const memberUids = await getGroupMemberUids(groupId);
    const teacherId = assignment.createdBy;
    const studentUids = memberUids.filter((uid) => uid !== teacherId);

    if (studentUids.length === 0) return;

    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupName = groupDoc.data()?.name || '課程';

    const dueAt = assignment.dueAt?.toDate();
    const dueStr = dueAt
      ? `${dueAt.getMonth() + 1}/${dueAt.getDate()} ${dueAt.getHours()}:${String(dueAt.getMinutes()).padStart(2, '0')}`
      : '';

    const notification = {
      title: `📝 ${groupName} 新作業`,
      body: `${assignment.title || '(無標題)'} ${dueStr ? `| 截止：${dueStr}` : ''}`,
    };

    const data = {
      type: 'assignment',
      groupId,
      assignmentId,
      channel: 'groups',
    };

    await sendPushToMultipleUsers(studentUids, notification, data, 'assignments');
  },
);

exports.onGradePublished = onDocumentUpdated(
  {
    document: 'groups/{groupId}/assignments/{assignmentId}/submissions/{submissionId}',
    region: REGION,
  },
  async (event) => {
    const { groupId, assignmentId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!before || !after) return;

    if (before.score === undefined && after.score !== undefined) {
      const studentId = after.studentId;
      if (!studentId) return;

      const assignmentDoc = await db
        .collection('groups')
        .doc(groupId)
        .collection('assignments')
        .doc(assignmentId)
        .get();
      const assignmentTitle = assignmentDoc.data()?.title || '作業';

      const groupDoc = await db.collection('groups').doc(groupId).get();
      const groupName = groupDoc.data()?.name || '課程';

      const notification = {
        title: `📊 ${groupName} 成績公布`,
        body: `${assignmentTitle} 成績已公布：${after.score} 分`,
      };

      const data = {
        type: 'grade',
        groupId,
        assignmentId,
        channel: 'groups',
      };

      await sendPushToUser(studentId, notification, data);
    }
  },
);

// =====================================================
// 私訊通知
// =====================================================

exports.onMessageCreated = onDocumentCreated(
  {
    document: 'conversations/{conversationId}/messages/{messageId}',
    region: REGION,
  },
  async (event) => {
    const { conversationId, messageId } = event.params;
    const message = event.data?.data();

    if (!message) return;

    const conversationDoc = await db.collection('conversations').doc(conversationId).get();
    const conversation = conversationDoc.data();

    const memberIds = Array.isArray(conversation?.memberIds)
      ? conversation.memberIds
      : Array.isArray(conversation?.participants)
        ? conversation.participants
        : [];

    if (memberIds.length === 0) return;

    const senderId = message.senderId;
    const recipientIds = memberIds.filter((uid) => uid !== senderId);

    if (recipientIds.length === 0) return;

    const senderDoc = await db.collection('users').doc(senderId).get();
    const senderName = senderDoc.data()?.displayName || '某人';

    const notification = {
      title: `💬 ${senderName}`,
      body: message.text?.slice(0, 100) || '(訊息)',
    };

    const data = {
      type: 'message',
      conversationId,
      messageId,
      peerId: senderId,
      channel: 'messages',
    };

    await sendPushToMultipleUsers(recipientIds, notification, data, 'messages');
  },
);

// =====================================================
// 失物招領通知
// =====================================================

exports.onLostFoundMatch = onDocumentCreated(
  {
    document: 'schools/{schoolId}/lostFound/{itemId}',
    region: REGION,
  },
  async (event) => {
    const { schoolId, itemId } = event.params;
    const newItem = event.data?.data();

    if (!newItem) return;

    const oppositeType = newItem.type === 'lost' ? 'found' : 'lost';

    const potentialMatchesSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('lostFound')
      .where('type', '==', oppositeType)
      .where('status', '==', 'active')
      .where('category', '==', newItem.category)
      .limit(5)
      .get();

    for (const matchDoc of potentialMatchesSnap.docs) {
      const matchData = matchDoc.data();
      const matchOwnerId = matchData.userId;

      if (matchOwnerId && matchOwnerId !== newItem.userId) {
        const notification = {
          title: newItem.type === 'lost' ? '🔍 可能的遺失物品配對' : '🎁 可能的拾獲物品配對',
          body: `有人${newItem.type === 'lost' ? '遺失了' : '拾獲了'}與您的物品相似的東西：${newItem.name}`,
        };

        const data = {
          type: 'lost_found_match',
          itemId,
          matchItemId: matchDoc.id,
          schoolId,
          channel: 'default',
        };

        await sendPushToUser(matchOwnerId, notification, data);
      }
    }
  },
);

// =====================================================
// HTTP Callable Functions
// =====================================================

exports.askCampusAssistant = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid ?? null;
    const rateLimitKey = uid || getClientIp(request.rawRequest || {});
    enforceRateLimit({
      scope: 'ask-campus-assistant',
      key: rateLimitKey,
      limit: 40,
      windowMs: 5 * 60 * 1000,
    });
    const rawMessages = Array.isArray(request.data?.messages) ? request.data.messages : [];
    const context =
      request.data?.context && typeof request.data.context === 'object' ? request.data.context : {};
    const lastUserMessage = getLastUserMessage(rawMessages);
    const intent = detectCampusAssistantIntent(lastUserMessage);

    const userProfile = uid ? await fetchAssistantUserProfile(uid) : null;
    const schoolId = userProfile?.schoolId ?? context.schoolId ?? null;
    const displayName = userProfile?.displayName ?? request.auth?.token?.name ?? null;

    if (!schoolId) {
      return {
        content: '目前無法判斷你所屬的學校。請先選擇學校，或登入後再試一次。',
        suggestions: ['今日公告', '近期活動', '推薦餐點'],
        debug: { intent, route: 'structured_v1', sourcesUsed: 0 },
      };
    }

    const response = {
      content: '',
      suggestions: [],
      actions: [],
      citations: [],
      debug: { intent, route: 'structured_v1', sourcesUsed: 0, hasAuth: Boolean(uid) },
    };

    if (intent === 'assignment_status' || intent === 'study_summary') {
      if (!uid) {
        response.content =
          '要查詢個人作業、週報或學習摘要，請先登入帳號。我也可以先幫你看公開的公告、活動或餐點資訊。';
        response.suggestions = ['今日公告', '近期活動', '推薦餐點'];
        return response;
      }

      const [pendingAssignments, weeklyReport, announcements] = await Promise.all([
        fetchAssistantPendingAssignments(uid, context.groupId),
        fetchAssistantWeeklyReport(uid),
        fetchAssistantAnnouncements(schoolId),
      ]);

      response.debug.sourcesUsed =
        pendingAssignments.length + (weeklyReport ? 1 : 0) + announcements.length;

      if (intent === 'assignment_status') {
        if (pendingAssignments.length === 0) {
          response.content =
            '目前沒有快到期的待繳作業。你可以改問我近期公告、活動，或請我幫你規劃今天的學習重點。';
          response.suggestions = ['今日摘要', '近期活動', '今日公告'];
          return response;
        }

        const earliest = pendingAssignments[0];
        const list = pendingAssignments
          .slice(0, 3)
          .map(
            (assignment, index) =>
              `${index + 1}. ${assignment.title ?? '未命名作業'}（${assignment.groupName ?? assignment.groupId}，截止：${formatAssistantDate(assignment.dueAt)}）`,
          )
          .join('\n');

        response.content = [
          `你目前有 ${pendingAssignments.length} 份作業待處理，最早截止的是「${earliest.title ?? '未命名作業'}」。`,
          '',
          list,
          weeklyReport?.summary ? `\n本週學習狀況：${weeklyReport.summary}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        response.suggestions = ['設定提醒', '今日摘要', '今日公告'];
        response.actions = [
          {
            label: '設定提醒',
            action: 'schedule_reminder',
            params: {
              title: earliest.title ?? '作業提醒',
              dueDate: toJsDate(earliest.dueAt)?.toISOString() ?? undefined,
            },
          },
        ];
        response.citations = pendingAssignments.slice(0, 3).map((assignment) => ({
          type: 'assignment',
          id: assignment.id,
          label: assignment.title ?? '未命名作業',
        }));
        return response;
      }

      const lines = [];
      if (displayName) {
        lines.push(`${displayName}，這是你目前最值得先關注的重點：`);
      } else {
        lines.push('這是你目前最值得先關注的重點：');
      }

      if (pendingAssignments.length > 0) {
        lines.push(
          `1. 待繳作業共有 ${pendingAssignments.length} 份，最近的是「${pendingAssignments[0].title ?? '未命名作業'}」，截止：${formatAssistantDate(pendingAssignments[0].dueAt)}。`,
        );
      } else {
        lines.push('1. 目前沒有快到期的待繳作業。');
      }

      if (weeklyReport?.summary) {
        lines.push(`2. 本週學習摘要：${weeklyReport.summary}`);
      }

      if (announcements.length > 0) {
        lines.push(`3. 最新公告可先看「${announcements[0].title ?? '未命名公告'}」。`);
      }

      response.content = lines.join('\n');
      response.suggestions = ['設定提醒', '今日公告', '近期活動'];
      if (pendingAssignments[0]) {
        response.actions = [
          {
            label: '設定提醒',
            action: 'schedule_reminder',
            params: {
              title: pendingAssignments[0].title ?? '作業提醒',
              dueDate: toJsDate(pendingAssignments[0].dueAt)?.toISOString() ?? undefined,
            },
          },
        ];
      }
      return response;
    }

    if (intent === 'announcements') {
      const announcements = await fetchAssistantAnnouncements(schoolId);
      response.debug.sourcesUsed = announcements.length;

      if (announcements.length === 0) {
        response.content =
          '目前沒有可用的公告資料。你可以稍後再試，或改問我近期活動、餐點與校園地點。';
        response.suggestions = ['近期活動', '推薦餐點', '找地點'];
        return response;
      }

      response.content = [
        `目前先幫你整理 ${Math.min(announcements.length, 3)} 則最新公告：`,
        '',
        announcements
          .slice(0, 3)
          .map(
            (announcement, index) =>
              `${index + 1}. ${announcement.title ?? '未命名公告'}${announcement.publishedAt ? `（${formatAssistantDate(announcement.publishedAt)}）` : ''}`,
          )
          .join('\n'),
      ].join('\n');
      response.suggestions = ['查看詳情', '近期活動', '推薦餐點'];
      response.actions = announcements.slice(0, 2).map((announcement) => ({
        label: `查看「${String(announcement.title ?? '公告').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: 'Today', nested: '公告詳情', id: announcement.id },
      }));
      response.citations = announcements.slice(0, 3).map((announcement) => ({
        type: 'announcement',
        id: announcement.id,
        label: announcement.title ?? '未命名公告',
      }));
      return response;
    }

    if (intent === 'events') {
      const events = (await fetchAssistantEvents(schoolId))
        .filter((event) => {
          const start = toJsDate(event.startsAt);
          return !start || start >= new Date(Date.now() - 60 * 60 * 1000);
        })
        .slice(0, 4);

      response.debug.sourcesUsed = events.length;

      if (events.length === 0) {
        response.content = '近期沒有查到即將開始的活動。你可以先看看最新公告，或等晚一點再來查詢。';
        response.suggestions = ['今日公告', '推薦餐點', '找地點'];
        return response;
      }

      response.content = [
        '近期值得關注的活動有：',
        '',
        events
          .slice(0, 3)
          .map(
            (event, index) =>
              `${index + 1}. ${event.title ?? '未命名活動'}${event.location ? `（${event.location}）` : ''}${event.startsAt ? `，${formatAssistantDate(event.startsAt, true)}` : ''}`,
          )
          .join('\n'),
      ].join('\n');
      response.suggestions = ['查看詳情', '今日公告', '找地點'];
      response.actions = events.slice(0, 2).map((event) => ({
        label: `查看「${String(event.title ?? '活動').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: 'Today', nested: '活動詳情', id: event.id },
      }));
      response.citations = events.slice(0, 3).map((event) => ({
        type: 'event',
        id: event.id,
        label: event.title ?? '未命名活動',
      }));
      return response;
    }

    if (intent === 'menus') {
      const menus = (await fetchAssistantMenus(schoolId)).slice(0, 5);
      response.debug.sourcesUsed = menus.length;

      if (menus.length === 0) {
        response.content = '目前沒有可用的菜單資料。你可以改問我校園地點或近期活動。';
        response.suggestions = ['找地點', '近期活動', '今日公告'];
        return response;
      }

      response.content = [
        '今天可以先考慮這幾樣：',
        '',
        menus
          .slice(0, 3)
          .map(
            (menu, index) =>
              `${index + 1}. ${menu.name ?? menu.title ?? '未命名餐點'}${menu.price != null ? ` - $${menu.price}` : ''}${menu.cafeteria ? `（${menu.cafeteria}）` : ''}`,
          )
          .join('\n'),
      ].join('\n');
      response.suggestions = ['其他選擇', '找地點', '近期活動'];
      response.actions = menus.slice(0, 2).map((menu) => ({
        label: `查看「${String(menu.name ?? menu.title ?? '餐點').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: '校園', nested: 'MenuDetail', id: menu.id },
      }));
      response.citations = menus.slice(0, 3).map((menu) => ({
        type: 'menu',
        id: menu.id,
        label: menu.name ?? menu.title ?? '未命名餐點',
      }));
      return response;
    }

    if (intent === 'pois') {
      const pois = await fetchAssistantPois(schoolId);
      const poi = buildPoiResponse(lastUserMessage, pois);
      response.debug.sourcesUsed = pois.length > 0 ? 1 : 0;

      if (!poi) {
        response.content =
          '我目前找不到符合的校園地點。你可以再說更具體一點，例如圖書館、行政大樓、餐廳或宿舍。';
        response.suggestions = ['圖書館', '行政大樓', '餐廳'];
        return response;
      }

      response.content = [
        `找到「${poi.name ?? '未命名地點'}」了。`,
        poi.category ? `分類：${poi.category}` : '',
        poi.description ? `說明：${poi.description}` : '',
        poi.openingHours ? `開放時間：${poi.openingHours}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      response.suggestions = ['查看詳情', '開啟導航', '其他地點'];
      response.actions = [
        {
          label: '查看詳情',
          action: 'navigate',
          params: { screen: '校園', nested: 'PoiDetail', id: poi.id },
        },
        {
          label: '開始導航',
          action: 'navigate',
          params: { screen: '校園', nested: 'PoiDetail', id: poi.id },
        },
      ];
      response.citations = [{ type: 'poi', id: poi.id, label: poi.name ?? '未命名地點' }];
      return response;
    }

    if (intent === 'credit_audit') {
      response.content =
        '學分試算與選課建議目前建議搭配既有的「學分試算」功能使用。後續可以再把畢業條件與修課紀錄接進 AI，做更精準的選課推薦。';
      response.suggestions = ['前往學分試算', '今日摘要', '近期活動'];
      response.actions = [
        {
          label: '前往學分試算',
          action: 'navigate',
          params: { screen: '我的', nested: 'CreditAuditStack' },
        },
      ];
      return response;
    }

    if (intent === 'help') {
      response.content = [
        '我目前可以幫你處理這些事情：',
        '1. 查最新公告與活動',
        '2. 推薦餐點與找校園地點',
        uid ? '3. 查看你的待繳作業與學習摘要' : '3. 登入後查看個人作業與學習摘要',
      ].join('\n');
      response.suggestions = ['今日公告', '近期活動', '推薦餐點'];
      return response;
    }

    const [announcements, events] = await Promise.all([
      fetchAssistantAnnouncements(schoolId),
      fetchAssistantEvents(schoolId),
    ]);
    response.debug.sourcesUsed = announcements.length + events.length;

    response.content = [
      '我目前最適合幫你做的是查詢校園資訊與整理學習重點。',
      announcements[0]?.title ? `最新公告：${announcements[0].title}` : '',
      events[0]?.title ? `近期活動：${events[0].title}` : '',
      uid ? '你也可以直接問我：我有哪些作業快截止？' : '你也可以直接問我：今天有什麼公告？',
    ]
      .filter(Boolean)
      .join('\n');
    response.suggestions = uid
      ? ['我有哪些作業快截止？', '今天有什麼公告？', '推薦午餐']
      : ['今天有什麼公告？', '近期活動', '推薦午餐'];
    return response;
  },
);

exports.sendTestNotification = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const result = await sendPushToUser(uid, {
      title: '🧪 測試通知',
      body: '這是一則測試推播通知，如果你看到這則訊息，表示推播設定正確！',
    });

    return result;
  },
);

exports.sendCustomNotification = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const adminCheck = await db.collection('admins').doc(uid).get();
    if (!adminCheck.exists) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }

    const { targetUids, title, body, data } = request.data;

    if (!targetUids || !Array.isArray(targetUids) || !title || !body) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const results = await sendPushToMultipleUsers(targetUids, { title, body }, data || {});

    return {
      success: true,
      results,
    };
  },
);

// =====================================================
// 作業截止提醒 (Scheduled)
// =====================================================

exports.assignmentDueReminder = onSchedule(
  {
    schedule: 'every 1 hours',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    const now = Timestamp.now();
    const oneDayLater = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);

    const groupsSnap = await db.collection('groups').get();

    for (const groupDoc of groupsSnap.docs) {
      const groupId = groupDoc.id;
      const groupName = groupDoc.data().name || '課程';

      const assignmentsSnap = await db
        .collection('groups')
        .doc(groupId)
        .collection('assignments')
        .where('dueAt', '>=', now)
        .where('dueAt', '<=', oneDayLater)
        .where('dueReminderSent', '!=', true)
        .get();

      for (const assignmentDoc of assignmentsSnap.docs) {
        const assignment = assignmentDoc.data();
        const assignmentId = assignmentDoc.id;

        const submissionsSnap = await db
          .collection('groups')
          .doc(groupId)
          .collection('assignments')
          .doc(assignmentId)
          .collection('submissions')
          .get();

        const submittedUids = new Set(submissionsSnap.docs.map((d) => d.data().studentId));

        const memberUids = await getGroupMemberUids(groupId);
        const teacherId = assignment.createdBy;
        const unsubmittedUids = memberUids.filter(
          (uid) => uid !== teacherId && !submittedUids.has(uid),
        );

        if (unsubmittedUids.length > 0) {
          const dueAt = assignment.dueAt?.toDate();
          const diffHours = dueAt
            ? Math.round((dueAt.getTime() - Date.now()) / (1000 * 60 * 60))
            : 24;

          const notification = {
            title: `⏰ ${groupName} 作業即將截止`,
            body: `${assignment.title || '作業'} 還有約 ${diffHours} 小時截止，請盡快繳交！`,
          };

          const data = {
            type: 'assignment_due',
            groupId,
            assignmentId,
            channel: 'groups',
          };

          await sendPushToMultipleUsers(unsubmittedUids, notification, data, 'assignments');

          await assignmentDoc.ref.update({ dueReminderSent: true });

          console.log(
            `Sent due reminder for assignment ${assignmentId} to ${unsubmittedUids.length} students`,
          );
        }
      }
    }
  },
);

// =====================================================
// iCal 訂閱 API
// =====================================================

function formatICalDate(date, allDay = false) {
  const d = date instanceof Date ? date : date.toDate();
  if (allDay) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeICalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function generateICalFeed(events, calendarName = '校園行事曆') {
  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus App//TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICalText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Taipei',
    '',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Taipei',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const event of events) {
    const uid = `${event.id}@campus-app.tw`;
    const dtstamp = formatICalDate(new Date());

    ical.push('BEGIN:VEVENT');
    ical.push(`UID:${uid}`);
    ical.push(`DTSTAMP:${dtstamp}`);

    if (event.allDay) {
      ical.push(`DTSTART;VALUE=DATE:${formatICalDate(event.startsAt, true)}`);
      if (event.endsAt) {
        ical.push(`DTEND;VALUE=DATE:${formatICalDate(event.endsAt, true)}`);
      }
    } else {
      ical.push(`DTSTART;TZID=Asia/Taipei:${formatICalDate(event.startsAt)}`);
      if (event.endsAt) {
        ical.push(`DTEND;TZID=Asia/Taipei:${formatICalDate(event.endsAt)}`);
      }
    }

    ical.push(`SUMMARY:${escapeICalText(event.title)}`);

    if (event.description) {
      ical.push(`DESCRIPTION:${escapeICalText(event.description)}`);
    }
    if (event.location) {
      ical.push(`LOCATION:${escapeICalText(event.location)}`);
    }
    if (event.url) {
      ical.push(`URL:${event.url}`);
    }
    if (event.categories && event.categories.length > 0) {
      ical.push(`CATEGORIES:${event.categories.map(escapeICalText).join(',')}`);
    }

    ical.push('END:VEVENT');
  }

  ical.push('END:VCALENDAR');
  return ical.join('\r\n');
}

exports.calendarSubscribe = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    const { schoolId, userId, type } = req.query;

    if (!schoolId) {
      res.status(400).send('Missing schoolId parameter');
      return;
    }

    try {
      const events = [];

      const schoolDoc = await db.collection('schools').doc(schoolId).get();
      const schoolName = schoolDoc.data()?.name || schoolId;

      if (!type || type === 'all' || type === 'events') {
        const eventsSnap = await db
          .collection('schools')
          .doc(schoolId)
          .collection('clubEvents')
          .orderBy('startsAt', 'desc')
          .limit(100)
          .get();

        for (const doc of eventsSnap.docs) {
          const data = doc.data();
          events.push({
            id: `event-${doc.id}`,
            title: data.title || '(無標題)',
            description: data.description,
            location: data.location,
            startsAt: data.startsAt?.toDate() || new Date(),
            endsAt: data.endsAt?.toDate(),
            categories: ['活動'],
            url: data.link,
          });
        }
      }

      if (userId && (!type || type === 'all' || type === 'assignments')) {
        const userGroupsSnap = await db
          .collection('users')
          .doc(userId)
          .collection('groups')
          .where('schoolId', '==', schoolId)
          .where('status', '==', 'active')
          .get();

        for (const groupRef of userGroupsSnap.docs) {
          const groupId = groupRef.data().groupId;
          if (!groupId) continue;

          const groupDoc = await db.collection('groups').doc(groupId).get();
          const groupName = groupDoc.data()?.name || '課程';

          const assignmentsSnap = await db
            .collection('groups')
            .doc(groupId)
            .collection('assignments')
            .orderBy('dueAt', 'desc')
            .limit(50)
            .get();

          for (const doc of assignmentsSnap.docs) {
            const data = doc.data();
            if (!data.dueAt) continue;

            events.push({
              id: `assignment-${groupId}-${doc.id}`,
              title: `[作業] ${data.title || '(無標題)'} - ${groupName}`,
              description: data.description,
              startsAt: data.dueAt.toDate(),
              allDay: true,
              categories: ['作業', groupName],
            });
          }
        }
      }

      if (userId && (!type || type === 'all' || type === 'registered')) {
        const registrationsSnap = await db
          .collection('schools')
          .doc(schoolId)
          .collection('registrations')
          .where('userId', '==', userId)
          .get();

        const registeredEventIds = new Set(registrationsSnap.docs.map((d) => d.data().eventId));

        for (const eventId of registeredEventIds) {
          const eventDoc = await db
            .collection('schools')
            .doc(schoolId)
            .collection('clubEvents')
            .doc(eventId)
            .get();

          if (eventDoc.exists) {
            const existingEvent = events.find((e) => e.id === `event-${eventId}`);
            if (existingEvent) {
              existingEvent.categories = [...(existingEvent.categories || []), '已報名'];
            }
          }
        }
      }

      events.sort((a, b) => {
        const aTime = a.startsAt instanceof Date ? a.startsAt.getTime() : 0;
        const bTime = b.startsAt instanceof Date ? b.startsAt.getTime() : 0;
        return aTime - bTime;
      });

      let calendarName = `${schoolName} 行事曆`;
      if (type === 'events') calendarName = `${schoolName} 活動`;
      if (type === 'assignments') calendarName = `${schoolName} 作業`;

      const icalContent = generateICalFeed(events, calendarName);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${schoolId}-calendar.ics"`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(icalContent);
    } catch (error) {
      console.error('Calendar subscribe error:', error);
      res.status(500).send('Internal server error');
    }
  },
);

exports.calendarWebhook = onRequest(
  {
    region: REGION,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const { schoolId, eventId, action } = req.body;

    if (!schoolId || !eventId || !action) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    console.log(`Calendar webhook: ${action} for event ${eventId} in school ${schoolId}`);

    res.json({ success: true, message: 'Webhook received' });
  },
);

// =====================================================
// SSO 認證相關
// =====================================================

exports.signInUniversalDevAccount = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
  },
  async (req, res) => {
    try {
      assertTrustedOrigin(req);
      requirePostJson(req);

      if (!isUniversalDevAccountsEnabled()) {
        res.status(403).json({
          error: `Universal dev accounts are disabled in ${getAppRuntimeEnv()} runtime`,
        });
        return;
      }

      const ip = getClientIp(req);
      enforceRateLimit({
        scope: 'universal-dev-login',
        key: ip,
        limit: 30,
        windowMs: 5 * 60 * 1000,
      });

      const email = normalizeDevAccountEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const schoolId = String(req.body?.schoolId || '').trim();

      if (!email || !password || !schoolId) {
        res.status(400).json({ error: 'Missing required fields: email, password, schoolId' });
        return;
      }

      const account = authenticateUniversalDevAccount(email, password);
      if (!account) {
        res.status(401).json({ error: 'Invalid universal dev account credentials' });
        return;
      }

      const result = await provisionUniversalDevAccount({
        account,
        schoolId,
      });

      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('signInUniversalDevAccount error:', error);
      writeHttpError(res, error, 'Failed to sign in universal dev account');
    }
  },
);

exports.createCustomToken = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
  },
  async (_req, res) => {
    res.status(410).json({
      error: 'createCustomToken has been removed. Use startSSOAuth + verifySSOCallback.',
    });
  },
);

exports.startSSOAuth = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
    secrets: [SSO_CONFIG_ENCRYPTION_KEY],
  },
  async (req, res) => {
    try {
      assertTrustedOrigin(req);
      requirePostJson(req);

      const ip = getClientIp(req);
      enforceRateLimit({
        scope: 'start-sso',
        key: ip,
        limit: 20,
        windowMs: 5 * 60 * 1000,
      });

      const { schoolId, provider, redirectUri, state, codeChallenge, nonce, source } =
        req.body || {};

      if (!schoolId || !provider || !redirectUri || !state) {
        res.status(400).json({
          error: 'Missing required fields: schoolId, provider, redirectUri, state',
        });
        return;
      }

      if (!isAllowedRedirectUri(redirectUri)) {
        res.status(400).json({ error: 'Redirect URI is not allowlisted' });
        return;
      }

      const encryptionKey = SSO_CONFIG_ENCRYPTION_KEY.value();
      const fullConfig = await getFullSchoolSsoConfig(schoolId, encryptionKey);
      if (!fullConfig?.ssoConfig) {
        res.status(404).json({ error: 'SSO is not configured for this school' });
        return;
      }

      const availability = evaluateSsoConfiguration(fullConfig);
      if (!availability.isLoginReady) {
        res.status(400).json({
          error: availability.message,
          reason: availability.reason,
          missingFields: availability.missingFields,
          setupStatus: availability.setupStatus,
        });
        return;
      }

      if (fullConfig.ssoConfig.provider !== provider) {
        res.status(400).json({
          error: `Configured provider is ${fullConfig.ssoConfig.provider}, not ${provider}`,
        });
        return;
      }

      if (provider === 'oidc' && (!codeChallenge || typeof codeChallenge !== 'string')) {
        res.status(400).json({ error: 'Missing PKCE code challenge' });
        return;
      }

      const reservation = await reserveSsoTransaction({
        schoolId,
        provider,
        redirectUri,
        state,
        codeChallenge,
        nonce,
        source,
      });

      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        ...reservation,
        ssoConfig: toPublicSsoConfig(fullConfig, fullConfig.ssoConfig).ssoConfig,
      });
    } catch (error) {
      console.error('startSSOAuth error:', error);
      writeHttpError(res, error, 'Failed to initialize SSO');
    }
  },
);

exports.verifySSOCallback = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
    secrets: [SSO_CONFIG_ENCRYPTION_KEY],
  },
  async (req, res) => {
    try {
      assertTrustedOrigin(req);
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const ip = getClientIp(req);
      enforceRateLimit({
        scope: 'verify-sso',
        key: ip,
        limit: 30,
        windowMs: 5 * 60 * 1000,
      });

      const input = req.method === 'POST' ? req.body || {} : req.query;
      const {
        provider,
        schoolId,
        code,
        ticket,
        SAMLResponse,
        redirectUri,
        transactionId,
        state,
        codeVerifier,
      } = input;

      if (!provider || !schoolId || !redirectUri) {
        res.status(400).json({
          error: 'Missing provider, schoolId, or redirectUri',
        });
        return;
      }

      if (!isAllowedRedirectUri(redirectUri)) {
        res.status(400).json({ error: 'Redirect URI is not allowlisted' });
        return;
      }

      const encryptionKey = SSO_CONFIG_ENCRYPTION_KEY.value();
      const fullConfig = await getFullSchoolSsoConfig(schoolId, encryptionKey);
      const ssoConfig = fullConfig?.ssoConfig || null;
      const availability = evaluateSsoConfiguration(fullConfig || {});

      if (!availability.isConfigured || !ssoConfig) {
        res.status(400).json({ error: availability.message, reason: availability.reason });
        return;
      }

      if (!availability.isLoginReady) {
        res.status(400).json({
          error: availability.message,
          reason: availability.reason,
          missingFields: availability.missingFields,
          setupStatus: availability.setupStatus,
        });
        return;
      }

      if (ssoConfig.provider !== provider) {
        res.status(400).json({
          error: `Configured provider is ${ssoConfig.provider}, not ${provider}`,
        });
        return;
      }

      const adapter = getProviderAdapter(provider);
      if (!adapter) {
        res.status(400).json({ error: `Unsupported provider: ${provider}` });
        return;
      }

      const missingCallbackFields = adapter.getMissingCallbackFields({
        code,
        ticket,
        SAMLResponse,
        redirectUri,
      });
      if (missingCallbackFields.length > 0) {
        res.status(400).json({
          error: `Missing callback parameters: ${missingCallbackFields.join(', ')}`,
        });
        return;
      }

      let transactionData = null;
      if (transactionId || state) {
        if (!transactionId || !state) {
          res.status(400).json({
            error: 'transactionId and state must be provided together',
          });
          return;
        }

        transactionData = await validateAndConsumeSsoTransaction({
          transactionId,
          schoolId,
          provider,
          redirectUri,
          state,
        });
      }

      const userInfo = await adapter.verify({
        code,
        ticket,
        SAMLResponse,
        redirectUri,
        ssoConfig,
        transactionId,
        state,
        codeVerifier,
        expectedCodeChallenge: transactionData?.codeChallenge || null,
        expectedNonce: transactionData?.nonce || null,
      });

      if (!userInfo || !userInfo.sub) {
        res.status(401).json({ error: 'Failed to verify SSO credentials' });
        return;
      }

      const { getAuth } = require('firebase-admin/auth');
      const auth = getAuth();

      const ssoLinkRef = db.collection('ssoLinks').doc(`${schoolId}_${userInfo.sub}`);
      const ssoLinkDoc = await ssoLinkRef.get();

      let uid;
      let isNewUser = false;
      let resolvedRole = 'student';
      const existingUserDoc = ssoLinkDoc.exists
        ? await db.collection('users').doc(ssoLinkDoc.data().firebaseUid).get()
        : null;

      if (ssoLinkDoc.exists) {
        uid = ssoLinkDoc.data().firebaseUid;
        resolvedRole = resolveProvisionedRole({
          existingLink: ssoLinkDoc.data(),
          existingUser: existingUserDoc?.exists ? existingUserDoc.data() : null,
        });

        const userRef = db.collection('users').doc(uid);
        await userRef.update({
          lastLoginAt: FieldValue.serverTimestamp(),
          displayName: userInfo.name || userInfo.displayName,
          email: userInfo.email,
          role: resolvedRole,
        });

        await db
          .collection('schools')
          .doc(schoolId)
          .collection('members')
          .doc(uid)
          .set(
            {
              status: 'active',
              role: toSchoolMemberRole(resolvedRole),
            },
            { merge: true },
          );
      } else {
        const userRecord = await auth.createUser({
          email: userInfo.email || `${userInfo.sub}@${schoolId}.sso.local`,
          displayName: userInfo.name || userInfo.displayName,
          emailVerified: true,
        });

        uid = userRecord.uid;
        isNewUser = true;
        resolvedRole = 'student';

        await ssoLinkRef.set({
          schoolId,
          ssoSub: userInfo.sub,
          firebaseUid: uid,
          email: userInfo.email,
          name: userInfo.name || userInfo.displayName,
          studentId: userInfo.studentId || userInfo.employee_id,
          department: userInfo.department || userInfo.ou,
          role: resolvedRole,
          createdAt: FieldValue.serverTimestamp(),
        });

        await db
          .collection('users')
          .doc(uid)
          .set({
            email: userInfo.email,
            displayName: userInfo.name || userInfo.displayName,
            studentId: userInfo.studentId || userInfo.employee_id,
            department: userInfo.department || userInfo.ou,
            role: resolvedRole,
            schoolId,
            createdAt: FieldValue.serverTimestamp(),
            lastLoginAt: FieldValue.serverTimestamp(),
          });

        await db
          .collection('schools')
          .doc(schoolId)
          .collection('members')
          .doc(uid)
          .set(
            {
              status: 'active',
              role: toSchoolMemberRole(resolvedRole),
              joinedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
      }

      const customToken = await auth.createCustomToken(uid, {
        schoolId,
        ssoSub: userInfo.sub,
        role: resolvedRole,
      });

      await syncAuthClaims(uid, {
        role: resolvedRole,
        schoolId,
      });

      res.json({
        success: true,
        customToken,
        uid,
        isNewUser,
        userInfo: {
          sub: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name || userInfo.displayName,
          displayName: userInfo.displayName || userInfo.name,
          studentId: userInfo.studentId || userInfo.student_id,
          student_id: userInfo.studentId || userInfo.student_id,
          employee_id: userInfo.employee_id,
          department: userInfo.department || userInfo.ou,
          ou: userInfo.ou || userInfo.department,
          affiliation: userInfo.affiliation,
          userType: userInfo.userType,
          role: resolvedRole,
        },
      });
    } catch (error) {
      const errorId = `sso_${Date.now()}_${nodeCrypto.randomBytes(4).toString('hex')}`;
      console.error(`SSO callback error [${errorId}]:`, error);
      res.status(500).json({
        error: 'SSO verification failed',
        correlationId: errorId,
      });
    }
  },
);

exports.getSSOConfig = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
    secrets: [SSO_CONFIG_ENCRYPTION_KEY],
  },
  async (req, res) => {
    const { schoolId } = req.query;

    if (!schoolId) {
      res.status(400).json({ error: 'Missing schoolId' });
      return;
    }

    try {
      assertTrustedOrigin(req);

      const encryptionKey = SSO_CONFIG_ENCRYPTION_KEY.value();
      const fullConfig = await getFullSchoolSsoConfig(schoolId, encryptionKey);

      if (!fullConfig) {
        res.json({
          schoolId,
          ssoConfig: null,
          allowEmailLogin: true,
          setupStatus: 'draft',
          availability: {
            reason: 'not-configured',
            missingFields: [],
            isConfigured: false,
            isEnabled: false,
            isComplete: false,
            isLoginReady: false,
            isProductionReady: false,
          },
        });
        return;
      }

      const safeConfig = toPublicSsoConfig(
        {
          ...fullConfig,
          schoolId: fullConfig.schoolId || schoolId,
        },
        fullConfig.ssoConfig,
      );

      res.set('Cache-Control', 'no-store');
      res.json(safeConfig);
    } catch (error) {
      console.error('Get SSO config error:', error);
      res.status(500).json({ error: 'Failed to get SSO configuration' });
    }
  },
);

exports.updateSSOConfig = onCall(
  {
    region: REGION,
    secrets: [SSO_CONFIG_ENCRYPTION_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    enforceRateLimit({
      scope: 'update-sso-config',
      key: uid,
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });

    const { schoolId, config, publicConfig, secretConfig } = request.data;

    if (!schoolId || (!config && !publicConfig)) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or SSO configuration');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);

    const normalizedConfig = config || publicConfig;
    const splitConfig = config
      ? splitSsoConfig(normalizedConfig)
      : {
          publicConfig: normalizedConfig,
          secretConfig: secretConfig || {},
        };

    splitConfig.publicConfig.setupStatus = normalizeSetupStatus(
      splitConfig.publicConfig.setupStatus,
      Boolean(splitConfig.publicConfig.ssoConfig),
    );

    const encryptionKey = SSO_CONFIG_ENCRYPTION_KEY.value();
    await writeSchoolSsoConfig({
      schoolId,
      publicConfig: splitConfig.publicConfig,
      secretConfig: splitConfig.secretConfig,
      encryptionKey,
      updatedBy: uid,
    });

    return { success: true };
  },
);

// =====================================================
// 使用者相關 API
// =====================================================

exports.getUserProfile = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    try {
      const userDoc = await db.collection('users').doc(uid).get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User profile not found');
      }

      const userData = userDoc.data();

      // 取得使用者統計
      const [groupsCount, favoriteCount] = await Promise.all([
        db.collection('users').doc(uid).collection('groups').count().get(),
        db.collection('users').doc(uid).collection('favorites').count().get(),
      ]);

      return {
        ...userData,
        stats: {
          groupsCount: groupsCount.data().count,
          favoriteCount: favoriteCount.data().count,
        },
      };
    } catch (error) {
      console.error('Get user profile error:', error);
      throw new HttpsError('internal', 'Failed to get user profile');
    }
  },
);

exports.updateUserProfile = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const {
      displayName,
      photoURL,
      avatarUrl,
      department,
      studentId,
      isPublicProfile,
      isDiscoverable,
    } = request.data;

    const updateData = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (displayName !== undefined) updateData.displayName = displayName;
    if (photoURL !== undefined) updateData.photoURL = photoURL;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (department !== undefined) updateData.department = department;
    if (studentId !== undefined) updateData.studentId = studentId;
    if (isPublicProfile !== undefined) updateData.isPublicProfile = Boolean(isPublicProfile);
    if (isDiscoverable !== undefined) updateData.isDiscoverable = Boolean(isDiscoverable);

    await db.collection('users').doc(uid).update(updateData);

    return { success: true };
  },
);

exports.onUserProfileChanged = onDocumentWritten(
  {
    region: REGION,
    document: 'users/{uid}',
  },
  async (event) => {
    const uid = event.params.uid;
    const afterData = event.data.after?.data();

    if (!afterData) {
      await syncDirectoryEntriesForUser(uid, null);
      return;
    }

    try {
      await syncAuthClaims(uid, afterData);
    } catch (error) {
      console.error('Failed to sync auth claims:', error);
    }

    try {
      await syncDirectoryEntriesForUser(uid, afterData);
    } catch (error) {
      console.error('Failed to sync school directory entries:', error);
    }
  },
);

exports.onSchoolMembershipChanged = onDocumentWritten(
  {
    region: REGION,
    document: 'schools/{schoolId}/members/{uid}',
  },
  async (event) => {
    const { schoolId, uid } = event.params;
    const membership = event.data.after?.data() || null;

    try {
      await syncSchoolDirectoryEntry({
        schoolId,
        uid,
        membership,
      });
    } catch (error) {
      console.error('Failed to sync school directory membership:', error);
    }
  },
);

exports.onCafeteriaOperatorChanged = onDocumentWritten(
  {
    region: REGION,
    document: 'schools/{schoolId}/cafeterias/{cafeteriaId}/operators/{uid}',
  },
  async (event) => {
    const { schoolId, cafeteriaId } = event.params;

    try {
      await syncCafeteriaOperatorCount(schoolId, cafeteriaId);
    } catch (error) {
      console.error('Failed to sync cafeteria operator count:', error);
    }
  },
);

// =====================================================
// 學校管理台 API
// =====================================================

exports.upsertSchoolAnnouncement = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const announcementId = optionalTrimmedString(request.data?.announcementId, 240);
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    const payload = normalizeSchoolAnnouncementInput(request.data);
    const announcements = db.collection('schools').doc(schoolId).collection('announcements');
    const targetRef = announcementId ? announcements.doc(announcementId) : announcements.doc();

    if (announcementId) {
      const existing = await targetRef.get();
      if (!existing.exists) {
        throw new HttpsError('not-found', 'Announcement not found');
      }
    }

    await targetRef.set(
      announcementId
        ? {
            ...payload,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
            updatedByEmail: actorEmail || null,
          }
        : {
            ...payload,
            schoolId,
            createdBy: uid,
            createdByEmail: actorEmail || null,
            publishedAt: FieldValue.serverTimestamp(),
          },
      { merge: announcementId != null },
    );

    await logAdminAction({
      schoolId,
      action: announcementId ? 'update_announcement' : 'create_announcement',
      details: `id=${targetRef.id};title=${payload.title}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      announcementId: targetRef.id,
    };
  },
);

exports.deleteSchoolAnnouncement = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const announcementId = trimString(request.data?.announcementId, 240);
    if (!schoolId || !announcementId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or announcementId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    await db.collection('schools').doc(schoolId).collection('announcements').doc(announcementId).delete();

    await logAdminAction({
      schoolId,
      action: 'delete_announcement',
      details: `id=${announcementId}`,
      actorUid: uid,
      actorEmail,
    });

    return { success: true };
  },
);

exports.bulkUpdateSchoolAnnouncements = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const action = trimString(request.data?.action, 40);
    const announcementIds = Array.from(
      new Set(
        Array.isArray(request.data?.announcementIds)
          ? request.data.announcementIds
              .filter((value) => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      ),
    );

    if (!schoolId || announcementIds.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or announcementIds');
    }
    if (!['delete', 'pin', 'unpin'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Invalid announcement bulk action');
    }
    if (announcementIds.length > 200) {
      throw new HttpsError('invalid-argument', 'Too many announcementIds');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);

    for (const chunk of chunkItems(announcementIds)) {
      const batch = db.batch();
      for (const announcementId of chunk) {
        const ref = db
          .collection('schools')
          .doc(schoolId)
          .collection('announcements')
          .doc(announcementId);
        if (action === 'delete') {
          batch.delete(ref);
        } else {
          batch.set(
            ref,
            {
              pinned: action === 'pin',
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: uid,
              updatedByEmail: actorEmail || null,
            },
            { merge: true },
          );
        }
      }
      await batch.commit();
    }

    await logAdminAction({
      schoolId,
      action:
        action === 'delete'
          ? 'batch_delete_announcements'
          : action === 'pin'
            ? 'batch_pin_announcements'
            : 'batch_unpin_announcements',
      details: `count=${announcementIds.length}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      count: announcementIds.length,
    };
  },
);

exports.upsertSchoolEvent = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const eventId = optionalTrimmedString(request.data?.eventId, 240);
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    const normalized = normalizeSchoolEventInput(request.data);
    const events = db.collection('schools').doc(schoolId).collection('clubEvents');
    const targetRef = eventId ? events.doc(eventId) : events.doc();

    if (eventId) {
      const existing = await targetRef.get();
      if (!existing.exists) {
        throw new HttpsError('not-found', 'Event not found');
      }
    }

    if (eventId) {
      const payload = {
        title: normalized.title,
        description: normalized.description,
        location: normalized.location,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByEmail: actorEmail || null,
        startsAt:
          normalized.startsAt instanceof Timestamp ? normalized.startsAt : FieldValue.delete(),
        endsAt: normalized.endsAt,
        capacity:
          normalized.capacity == null ? FieldValue.delete() : normalized.capacity,
      };

      await targetRef.set(payload, { merge: true });
    } else {
      await targetRef.set({
        title: normalized.title,
        description: normalized.description,
        location: normalized.location,
        schoolId,
        createdBy: uid,
        createdByEmail: actorEmail || null,
        startsAt:
          normalized.startsAt instanceof Timestamp
            ? normalized.startsAt
            : Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        ...(normalized.endsAt instanceof Timestamp ? { endsAt: normalized.endsAt } : {}),
        ...(normalized.capacity == null ? {} : { capacity: normalized.capacity }),
        registeredCount: 0,
      });
    }

    await logAdminAction({
      schoolId,
      action: eventId ? 'update_event' : 'create_event',
      details: `id=${targetRef.id};title=${normalized.title}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      eventId: targetRef.id,
    };
  },
);

exports.deleteSchoolEvent = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const eventId = trimString(request.data?.eventId, 240);
    if (!schoolId || !eventId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or eventId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    await db.collection('schools').doc(schoolId).collection('clubEvents').doc(eventId).delete();

    await logAdminAction({
      schoolId,
      action: 'delete_event',
      details: `id=${eventId}`,
      actorUid: uid,
      actorEmail,
    });

    return { success: true };
  },
);

exports.bulkDeleteSchoolEvents = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const eventIds = Array.from(
      new Set(
        Array.isArray(request.data?.eventIds)
          ? request.data.eventIds
              .filter((value) => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      ),
    );
    if (!schoolId || eventIds.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or eventIds');
    }
    if (eventIds.length > 200) {
      throw new HttpsError('invalid-argument', 'Too many eventIds');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);

    for (const chunk of chunkItems(eventIds)) {
      const batch = db.batch();
      for (const eventId of chunk) {
        batch.delete(db.collection('schools').doc(schoolId).collection('clubEvents').doc(eventId));
      }
      await batch.commit();
    }

    await logAdminAction({
      schoolId,
      action: 'batch_delete_events',
      details: `count=${eventIds.length}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      count: eventIds.length,
    };
  },
);

exports.updateSchoolMemberRole = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const targetUid = trimString(request.data?.targetUid, 160);
    const role = trimString(request.data?.role, 40);

    if (!schoolId || !targetUid || !['admin', 'editor', 'member'].includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid school member role update');
    }

    const actorMembership = await assertSchoolAdminOrEditor(schoolId, uid);
    const targetRef = db.collection('schools').doc(schoolId).collection('members').doc(targetUid);
    const targetDoc = await targetRef.get();

    if (!targetDoc.exists) {
      throw new HttpsError('not-found', 'School member not found');
    }

    if (role === 'admin' && actorMembership.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can promote another admin');
    }

    if (uid === targetUid && targetDoc.data()?.role === 'admin' && role !== 'admin') {
      throw new HttpsError('failed-precondition', 'Admin self-demotion is blocked');
    }

    const actorEmail = trimString(request.auth?.token?.email, 320);
    await targetRef.set(
      {
        role,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByEmail: actorEmail || null,
      },
      { merge: true },
    );

    await logAdminAction({
      schoolId,
      action: 'update_member_role',
      details: `member=${targetUid};role=${role}`,
      actorUid: uid,
      actorEmail,
    });

    return { success: true };
  },
);

exports.updateSchoolServiceRole = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const targetUid = trimString(request.data?.targetUid, 160);
    if (!schoolId || !targetUid) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or targetUid');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    await assertActiveSchoolMember(schoolId, targetUid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    const normalized = normalizeServiceRoleRecord({
      status: request.data?.status,
      orders: request.data?.orders,
      repairs: request.data?.repairs,
      packages: request.data?.packages,
      printing: request.data?.printing,
      health: request.data?.health,
    });

    await db
      .collection('schools')
      .doc(schoolId)
      .collection('serviceRoles')
      .doc(targetUid)
      .set(
        {
          ...normalized,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid,
          updatedByEmail: actorEmail || null,
        },
        { merge: true },
      );

    await logAdminAction({
      schoolId,
      action: 'update_service_role',
      details: `member=${targetUid};domains=${SERVICE_ROLE_DOMAINS.filter((domain) => normalized[domain]).join(',') || 'none'};status=${normalized.status}`,
      actorUid: uid,
      actorEmail,
    });

    return { success: true };
  },
);

exports.upsertSchoolCafeteriaConfig = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    const normalized = normalizeCafeteriaConfigInput(request.data);
    const cafeteriaRef = getCafeteriaRef(schoolId, normalized.cafeteriaId);
    const existingDoc = await cafeteriaRef.get();

    await cafeteriaRef.set(
      {
        schoolId,
        name: normalized.name,
        merchantId: normalized.cafeteriaId,
        pilotStatus: normalized.pilotStatus,
        orderingEnabled: normalized.orderingEnabled,
        location: normalized.location ?? FieldValue.delete(),
        openingHours: normalized.openingHours ?? FieldValue.delete(),
        brandKey: normalized.brandKey ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByEmail: actorEmail || null,
        ...(existingDoc.exists
          ? {}
          : {
              activeOperatorCount: 0,
              createdAt: FieldValue.serverTimestamp(),
            }),
      },
      { merge: true },
    );

    await logAdminAction({
      schoolId,
      action: existingDoc.exists ? 'update_cafeteria_config' : 'create_cafeteria_config',
      details: `cafeteria=${normalized.cafeteriaId};pilot=${normalized.pilotStatus};ordering=${normalized.orderingEnabled}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      cafeteriaId: normalized.cafeteriaId,
    };
  },
);

exports.upsertCafeteriaOperatorAssignment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const cafeteriaId = trimString(request.data?.cafeteriaId, 160);
    if (!schoolId || !cafeteriaId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or cafeteriaId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const cafeteriaRef = getCafeteriaRef(schoolId, cafeteriaId);
    const cafeteriaDoc = await cafeteriaRef.get();
    if (!cafeteriaDoc.exists) {
      throw new HttpsError('not-found', 'Cafeteria not found');
    }

    const actorEmail = trimString(request.auth?.token?.email, 320);
    const normalized = normalizeCafeteriaOperatorInput(request.data);
    const operatorRef = cafeteriaRef.collection('operators').doc(normalized.targetUid);
    const existingDoc = await operatorRef.get();

    await operatorRef.set(
      {
        status: normalized.status,
        role: normalized.role,
        displayName: normalized.displayName ?? null,
        email: normalized.email ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
        updatedByEmail: actorEmail || null,
        ...(existingDoc.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    const activeOperatorCount = await syncCafeteriaOperatorCount(schoolId, cafeteriaId);

    await logAdminAction({
      schoolId,
      action: 'upsert_cafeteria_operator',
      details: `cafeteria=${cafeteriaId};uid=${normalized.targetUid};role=${normalized.role};status=${normalized.status}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      activeOperatorCount,
    };
  },
);

exports.clearSchoolAdminTestData = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    await assertSchoolAdminOrEditor(schoolId, uid);
    const actorEmail = trimString(request.auth?.token?.email, 320);
    const [announcementsSnap, eventsSnap] = await Promise.all([
      db.collection('schools').doc(schoolId).collection('announcements').get(),
      db.collection('schools').doc(schoolId).collection('clubEvents').get(),
    ]);

    const refs = [...announcementsSnap.docs.map((docSnap) => docSnap.ref), ...eventsSnap.docs.map((docSnap) => docSnap.ref)];
    for (const chunk of chunkItems(refs)) {
      const batch = db.batch();
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    await logAdminAction({
      schoolId,
      action: 'clear_testing_data',
      details: `announcements=${announcementsSnap.size};events=${eventsSnap.size}`,
      actorUid: uid,
      actorEmail,
    });

    return {
      success: true,
      deleted: {
        announcements: announcementsSnap.size,
        events: eventsSnap.size,
      },
    };
  },
);

// =====================================================
// 群組管理 API
// =====================================================

exports.createGroup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { name, description, type, schoolId, isPrivate, isPublished, verification } =
      request.data;

    if (!name || !type || !schoolId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    let joinCode = null;
    for (let i = 0; i < 8; i += 1) {
      const candidate = generateGroupJoinCode(8);
      const existing = await db
        .collection('groups')
        .where('joinCode', '==', candidate)
        .limit(1)
        .get();
      if (existing.empty) {
        joinCode = candidate;
        break;
      }
    }

    if (!joinCode) {
      throw new HttpsError('resource-exhausted', 'Failed to allocate a unique join code');
    }

    const groupRef = await db.collection('groups').add({
      name,
      description: description || '',
      type,
      schoolId,
      isPrivate: !!isPrivate,
      isPublished: Boolean(isPublished),
      verification: verification || { status: 'unverified' },
      joinCode,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      memberCount: 1,
    });

    // 創建者自動成為管理員
    await db.collection('groups').doc(groupRef.id).collection('members').doc(uid).set({
      uid,
      role: 'owner',
      status: 'active',
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 記錄到使用者的群組列表
    await db.collection('users').doc(uid).collection('groups').doc(groupRef.id).set({
      groupId: groupRef.id,
      schoolId,
      type,
      name,
      joinCode,
      status: 'active',
      role: 'owner',
      joinedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      groupId: groupRef.id,
      joinCode,
    };
  },
);

exports.joinGroupByCode = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { joinCode, schoolId } = request.data;

    if (!joinCode || !schoolId) {
      throw new HttpsError('invalid-argument', 'Missing join code or schoolId');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const groupsSnap = await db
      .collection('groups')
      .where('joinCode', '==', String(joinCode).trim().toUpperCase())
      .limit(1)
      .get();

    if (groupsSnap.empty) {
      throw new HttpsError('not-found', 'Invalid join code');
    }

    const groupDoc = groupsSnap.docs[0];
    const groupId = groupDoc.id;
    const groupData = groupDoc.data();

    if (groupData.schoolId !== schoolId) {
      throw new HttpsError('permission-denied', 'Join code belongs to a different school');
    }

    // 檢查是否已經是成員
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(uid)
      .get();
    if (memberDoc.exists && memberDoc.data().status === 'active') {
      throw new HttpsError('already-exists', 'Already a member of this group');
    }

    const batch = db.batch();

    // 加入群組
    batch.set(db.collection('groups').doc(groupId).collection('members').doc(uid), {
      uid,
      role: 'member',
      status: 'active',
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 更新成員數
    batch.update(db.collection('groups').doc(groupId), {
      memberCount: FieldValue.increment(1),
    });

    // 記錄到使用者的群組列表
    batch.set(db.collection('users').doc(uid).collection('groups').doc(groupId), {
      groupId,
      schoolId: groupData.schoolId,
      type: groupData.type || null,
      name: groupData.name || null,
      joinCode: groupData.joinCode || null,
      status: 'active',
      role: 'member',
      joinedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      success: true,
      groupId,
      groupName: groupData.name,
    };
  },
);

exports.leaveGroup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { groupId } = request.data;

    if (!groupId) {
      throw new HttpsError('invalid-argument', 'Missing groupId');
    }

    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(uid)
      .get();

    if (!memberDoc.exists || memberDoc.data().status !== 'active') {
      throw new HttpsError('not-found', 'Not a member of this group');
    }

    if (memberDoc.data().role === 'owner') {
      throw new HttpsError(
        'failed-precondition',
        'Owner cannot leave the group. Transfer ownership first.',
      );
    }

    const batch = db.batch();

    batch.update(db.collection('groups').doc(groupId).collection('members').doc(uid), {
      status: 'left',
      leftAt: FieldValue.serverTimestamp(),
    });

    batch.update(db.collection('groups').doc(groupId), {
      memberCount: FieldValue.increment(-1),
    });

    batch.update(db.collection('users').doc(uid).collection('groups').doc(groupId), {
      status: 'left',
      leftAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return { success: true };
  },
);

// =====================================================
// 圖書館 API
// =====================================================

exports.searchBooks = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const { schoolId, query, limit = 20 } = request.data;

    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    let booksRef = db.collection('schools').doc(schoolId).collection('libraryBooks');

    if (query) {
      // 簡單的標題搜尋
      booksRef = booksRef
        .where('titleLower', '>=', query.toLowerCase())
        .where('titleLower', '<=', query.toLowerCase() + '\uf8ff');
    }

    const booksSnap = await booksRef.limit(limit).get();

    return {
      books: booksSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      total: booksSnap.size,
    };
  },
);

exports.borrowBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, bookId } = request.data;

    if (!schoolId || !bookId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const bookRef = db.collection('schools').doc(schoolId).collection('libraryBooks').doc(bookId);
    const bookDoc = await bookRef.get();

    if (!bookDoc.exists) {
      throw new HttpsError('not-found', 'Book not found');
    }

    const bookData = bookDoc.data();
    const availableCopies = Number(bookData.availableCopies ?? bookData.available ?? 0);
    if (availableCopies <= 0) {
      throw new HttpsError('failed-precondition', 'No copies available');
    }

    // 檢查借閱數量限制
    const userLoansSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('libraryLoans')
      .where('userId', '==', uid)
      .where('status', 'in', ['borrowed', 'active'])
      .get();

    if (userLoansSnap.size >= 10) {
      throw new HttpsError('failed-precondition', 'Maximum loan limit reached');
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const batch = db.batch();

    const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc();
    const scopedLoanRef = getUserSchoolDoc(uid, schoolId, 'libraryLoans', loanRef.id);
    const loanPayload = {
      userId: uid,
      schoolId,
      bookId,
      bookTitle: bookData.title || null,
      borrowedAt: FieldValue.serverTimestamp(),
      dueAt: Timestamp.fromDate(dueDate),
      status: 'borrowed',
      renewCount: 0,
    };
    batch.set(loanRef, loanPayload);
    batch.set(scopedLoanRef, loanPayload);

    batch.update(bookRef, buildAvailabilityUpdate(bookData, -1));

    await batch.commit();

    return {
      success: true,
      loanId: loanRef.id,
      dueAt: dueDate.toISOString(),
    };
  },
);

exports.returnBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, loanId } = request.data;

    if (!schoolId || !loanId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc(loanId);
    const loanDoc = await loanRef.get();

    if (!loanDoc.exists) {
      throw new HttpsError('not-found', 'Loan not found');
    }

    const loanData = loanDoc.data();
    if (loanData.userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your loan');
    }

    if (!['borrowed', 'active'].includes(loanData.status)) {
      throw new HttpsError('failed-precondition', 'Loan is not active');
    }

    const batch = db.batch();
    const scopedLoanRef = getUserSchoolDoc(uid, schoolId, 'libraryLoans', loanId);
    const bookRef = db.collection('schools').doc(schoolId).collection('libraryBooks').doc(loanData.bookId);
    const bookDocForReturn = await bookRef.get();

    batch.update(loanRef, {
      status: 'returned',
      returnedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      scopedLoanRef,
      {
        userId: uid,
        schoolId,
        status: 'returned',
        returnedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    batch.update(bookRef, buildAvailabilityUpdate(bookDocForReturn.data(), 1));

    await batch.commit();

    return { success: true };
  },
);

exports.renewBook = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, loanId } = request.data;

    if (!schoolId || !loanId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc(loanId);
    const loanDoc = await loanRef.get();

    if (!loanDoc.exists) {
      throw new HttpsError('not-found', 'Loan not found');
    }

    const loanData = loanDoc.data();
    if (loanData.userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your loan');
    }

    if (loanData.renewCount >= 2) {
      throw new HttpsError('failed-precondition', 'Maximum renewal limit reached');
    }

    const newDueDate = loanData.dueAt.toDate();
    newDueDate.setDate(newDueDate.getDate() + 7);

    await loanRef.update({
      dueAt: Timestamp.fromDate(newDueDate),
      renewCount: FieldValue.increment(1),
      lastRenewedAt: FieldValue.serverTimestamp(),
    });
    await getUserSchoolDoc(uid, schoolId, 'libraryLoans', loanId).set(
      {
        userId: uid,
        schoolId,
        dueAt: Timestamp.fromDate(newDueDate),
        renewCount: FieldValue.increment(1),
        lastRenewedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      success: true,
      newDueAt: newDueDate.toISOString(),
      renewCount: loanData.renewCount + 1,
    };
  },
);

// =====================================================
// 座位預約 API
// =====================================================

exports.reserveSeat = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, seatId, date, startTime, endTime } = request.data;

    if (!schoolId || !seatId || !date || !startTime || !endTime) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // 檢查是否有衝突預約
    const conflictsSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('seatReservations')
      .where('seatId', '==', seatId)
      .where('date', '==', date)
      .where('status', '==', 'active')
      .get();

    for (const doc of conflictsSnap.docs) {
      const existing = doc.data();
      // 時間重疊檢查
      if (
        (startTime >= existing.startTime && startTime < existing.endTime) ||
        (endTime > existing.startTime && endTime <= existing.endTime) ||
        (startTime <= existing.startTime && endTime >= existing.endTime)
      ) {
        throw new HttpsError('failed-precondition', 'Time slot already reserved');
      }
    }

    // 檢查用戶當日預約數量
    const userReservationsSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('seatReservations')
      .where('userId', '==', uid)
      .where('date', '==', date)
      .where('status', '==', 'active')
      .get();

    if (userReservationsSnap.size >= 2) {
      throw new HttpsError('failed-precondition', 'Maximum daily reservations reached');
    }

    const reservationRef = db.collection('schools').doc(schoolId).collection('seatReservations').doc();
    const scopedReservationRef = getUserSchoolDoc(uid, schoolId, 'seatReservations', reservationRef.id);
    const reservationPayload = {
      userId: uid,
      schoolId,
      seatId,
      date,
      startTime,
      endTime,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      transaction.set(reservationRef, reservationPayload);
      transaction.set(scopedReservationRef, reservationPayload);
    });

    return {
      success: true,
      reservationId: reservationRef.id,
    };
  },
);

exports.cancelSeatReservation = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, reservationId } = request.data;

    if (!schoolId || !reservationId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const reservationRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('seatReservations')
      .doc(reservationId);

    const reservationDoc = await reservationRef.get();

    if (!reservationDoc.exists) {
      throw new HttpsError('not-found', 'Reservation not found');
    }

    if (reservationDoc.data().userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your reservation');
    }

    const reservationData = reservationDoc.data();
    await reservationRef.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
    });
    await getUserSchoolDoc(uid, schoolId, 'seatReservations', reservationId).set(
      {
        ...reservationData,
        schoolId,
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { success: true };
  },
);

// =====================================================
// 收藏 API
// =====================================================

exports.toggleFavorite = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { itemType, itemId } = request.data;
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);

    if (!itemType || !itemId || !schoolId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const favoriteRef = getUserSchoolDoc(uid, schoolId, 'favorites', `${itemType}_${itemId}`);
    const favoriteDoc = await favoriteRef.get();

    if (favoriteDoc.exists) {
      await favoriteRef.delete();
      return { success: true, favorited: false };
    } else {
      await favoriteRef.set({
        itemType,
        itemId,
        schoolId: schoolId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true, favorited: true };
    }
  },
);

exports.getFavorites = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { itemType } = request.data;
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);

    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    let query = getUserSchoolCollection(uid, schoolId, 'favorites');

    if (itemType) {
      query = query.where('itemType', '==', itemType);
    }

    const favoritesSnap = await query
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
      .catch(async () =>
        (itemType
          ? db
              .collection('users')
              .doc(uid)
              .collection('favorites')
              .where('itemType', '==', itemType)
          : db.collection('users').doc(uid).collection('favorites')
        )
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get(),
      );

    return {
      favorites: favoritesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  },
);

// =====================================================
// 資料匯出 (GDPR 合規)
// =====================================================

function hasRequestedCategory(selectedCategories, category) {
  return selectedCategories.size === 0 || selectedCategories.has(category);
}

function mapSnapshotDocs(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function getRecentLoginAgeMs(request) {
  const authTime = request.auth?.token?.auth_time;
  if (typeof authTime !== 'number') {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - authTime * 1000;
}

async function deleteSnapshotDocs(snapshot) {
  for (const doc of snapshot.docs) {
    await doc.ref.delete();
  }
}

exports.exportUserData = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    try {
      const requestedCategories = new Set(
        Array.isArray(request.data?.categories)
          ? request.data.categories.filter((value) => typeof value === 'string')
          : [],
      );
      const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
      const userDoc = await db.collection('users').doc(uid).get();
      const exportData = {
        exportedAt: new Date().toISOString(),
        schoolId,
        userId: uid,
      };

      if (hasRequestedCategory(requestedCategories, 'profile')) {
        exportData.profile = userDoc.exists ? { id: uid, ...userDoc.data() } : null;
      }

      if (schoolId) {
        const [
          schoolScopeDoc,
          enrollmentsSnap,
          gradesSnap,
          calendarEventsSnap,
          libraryLoansSnap,
          seatReservationsSnap,
          ordersSnap,
          transactionsSnap,
          achievementsSnap,
          dailyBriefsSnap,
          weeklyReportsSnap,
          walletDoc,
        ] = await Promise.all([
          getUserSchoolScope(uid, schoolId).get(),
          getUserSchoolCollection(uid, schoolId, 'enrollments').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'grades').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'calendarEvents').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'libraryLoans').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'seatReservations').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'orders').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'transactions').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'achievements').limit(200).get(),
          getUserSchoolCollection(uid, schoolId, 'dailyBriefs').limit(100).get(),
          getUserSchoolCollection(uid, schoolId, 'weeklyReports').limit(100).get(),
          getUserSchoolDoc(uid, schoolId, 'wallet', 'balance').get(),
        ]);

        exportData.schoolScoped = {
          context: schoolScopeDoc.exists ? schoolScopeDoc.data() : null,
          enrollments: mapSnapshotDocs(enrollmentsSnap),
          grades: mapSnapshotDocs(gradesSnap),
          calendarEvents: mapSnapshotDocs(calendarEventsSnap),
          libraryLoans: mapSnapshotDocs(libraryLoansSnap),
          seatReservations: mapSnapshotDocs(seatReservationsSnap),
          orders: mapSnapshotDocs(ordersSnap),
          transactions: mapSnapshotDocs(transactionsSnap),
          achievements: mapSnapshotDocs(achievementsSnap),
          dailyBriefs: mapSnapshotDocs(dailyBriefsSnap),
          weeklyReports: mapSnapshotDocs(weeklyReportsSnap),
          wallet: walletDoc.exists ? walletDoc.data() : null,
        };
      }

      if (hasRequestedCategory(requestedCategories, 'favorites')) {
        const [legacyFavorites, scopedFavorites] = await Promise.all([
          db.collection('users').doc(uid).collection('favorites').limit(200).get(),
          schoolId
            ? getUserSchoolCollection(uid, schoolId, 'favorites').limit(200).get()
            : Promise.resolve({ docs: [] }),
        ]);

        exportData.favorites =
          scopedFavorites.docs.length > 0
            ? mapSnapshotDocs(scopedFavorites)
            : mapSnapshotDocs(legacyFavorites);
      }

      if (hasRequestedCategory(requestedCategories, 'groups')) {
        const [groupsSnap, postsSnap] = await Promise.all([
          db.collection('users').doc(uid).collection('groups').limit(200).get(),
          db.collectionGroup('posts').where('authorId', '==', uid).limit(200).get(),
        ]);

        exportData.groups = mapSnapshotDocs(groupsSnap);
        exportData.posts = postsSnap.docs.map((doc) => ({
          id: doc.id,
          groupId: doc.ref.parent.parent?.id || null,
          ...doc.data(),
        }));
      }

      if (hasRequestedCategory(requestedCategories, 'assignments')) {
        const [studentSubmissions, ownedSubmissions] = await Promise.all([
          db.collectionGroup('submissions').where('studentId', '==', uid).limit(200).get(),
          db.collectionGroup('submissions').where('userId', '==', uid).limit(200).get(),
        ]);
        const submissionMap = new Map();
        for (const doc of [...studentSubmissions.docs, ...ownedSubmissions.docs]) {
          submissionMap.set(doc.ref.path, { id: doc.id, ...doc.data() });
        }
        exportData.submissions = [...submissionMap.values()];
      }

      if (hasRequestedCategory(requestedCategories, 'registrations')) {
        const registrationsSnap = await db
          .collectionGroup('registrations')
          .where('userId', '==', uid)
          .limit(200)
          .get();
        exportData.registrations = registrationsSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((row) => !schoolId || row.schoolId === schoolId || row.eventId);
      }

      if (hasRequestedCategory(requestedCategories, 'messages')) {
        const conversationsSnap = await db
          .collection('conversations')
          .where('memberIds', 'array-contains', uid)
          .limit(50)
          .get();
        const conversations = [];
        for (const conversationDoc of conversationsSnap.docs) {
          if (schoolId && conversationDoc.data()?.schoolId && conversationDoc.data().schoolId !== schoolId) {
            continue;
          }
          const messagesSnap = await conversationDoc.ref
            .collection('messages')
            .orderBy('createdAt', 'asc')
            .limit(200)
            .get();
          const conversationData = conversationDoc.data();
          conversations.push({
            id: conversationDoc.id,
            ...conversationData,
            memberIds: Array.isArray(conversationData.memberIds)
              ? conversationData.memberIds
              : Array.isArray(conversationData.participants)
                ? conversationData.participants
                : [],
            messages: mapSnapshotDocs(messagesSnap),
          });
        }
        exportData.conversations = conversations;
      }

      if (hasRequestedCategory(requestedCategories, 'notifications')) {
        const [preferencesSnap, pushTokensSnap, notificationsSnap] = await Promise.all([
          db.collection('users').doc(uid).collection('settings').doc('notifications').get(),
          db.collection('users').doc(uid).collection('pushTokens').limit(50).get(),
          db.collection('notifications').where('userId', '==', uid).limit(100).get(),
        ]);

        exportData.notificationPreferences = preferencesSnap.exists ? preferencesSnap.data() : null;
        exportData.pushTokens = mapSnapshotDocs(pushTokensSnap);
        exportData.notifications = mapSnapshotDocs(notificationsSnap);
      }

      if (hasRequestedCategory(requestedCategories, 'lostfound') && schoolId) {
        const lostFoundSnap = await db
          .collection('schools')
          .doc(schoolId)
          .collection('lostFound')
          .where('userId', '==', uid)
          .limit(100)
          .get();
        exportData.lostFound = mapSnapshotDocs(lostFoundSnap);
      }

      return exportData;
    } catch (error) {
      console.error('Export user data error:', error);
      throw new HttpsError('internal', 'Failed to export user data');
    }
  },
);

exports.deleteUserAccount = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { confirmation } = request.data;

    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      throw new HttpsError('invalid-argument', 'Invalid confirmation');
    }

    if (getRecentLoginAgeMs(request) > 10 * 60 * 1000) {
      throw new HttpsError('failed-precondition', 'Recent login required before account deletion');
    }

    try {
      const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
      const userRef = db.collection('users').doc(uid);
      const userSchoolsSnap = await userRef.collection('schools').get();

      for (const subcol of ['favorites', 'groups', 'pushTokens', 'settings', 'busAlerts']) {
        await deleteSnapshotDocs(await userRef.collection(subcol).get());
      }

      for (const schoolDoc of userSchoolsSnap.docs) {
        for (const nestedSubcol of [
          'favorites',
          'enrollments',
          'grades',
          'calendarEvents',
          'libraryLoans',
          'seatReservations',
          'transactions',
          'orders',
          'achievements',
          'dailyBriefs',
          'weeklyReports',
          'wallet',
        ]) {
          await deleteSnapshotDocs(await schoolDoc.ref.collection(nestedSubcol).get());
        }

        await db
          .collection('schools')
          .doc(schoolDoc.id)
          .collection('members')
          .doc(uid)
          .delete()
          .catch(() => null);
        await schoolDoc.ref.delete().catch(() => null);
      }

      if (schoolId) {
        await db
          .collection('schools')
          .doc(schoolId)
          .collection('members')
          .doc(uid)
          .delete()
          .catch(() => null);
      }

      await deleteSnapshotDocs(
        await db.collection('notifications').where('userId', '==', uid).limit(200).get(),
      );
      await deleteSnapshotDocs(
        await db.collection('ssoLinks').where('firebaseUid', '==', uid).limit(50).get(),
      );
      await deleteSnapshotDocs(
        await db.collectionGroup('registrations').where('userId', '==', uid).limit(200).get(),
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('members')
            .where(FieldPath.documentId(), '==', uid)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('directory')
            .where(FieldPath.documentId(), '==', uid)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('serviceRoles')
            .where(FieldPath.documentId(), '==', uid)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('operators')
            .where(FieldPath.documentId(), '==', uid)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('submissions')
            .where('userId', '==', uid)
            .limit(200)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('peerReviews')
            .where('reviewerId', '==', uid)
            .limit(200)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );
      await deleteSnapshotDocs(
        (
          await db
            .collectionGroup('peerReviews')
            .where('submissionOwnerId', '==', uid)
            .limit(200)
            .get()
            .catch(() => null)
        ) || { docs: [] },
      );

      await userRef.set(
        {
          displayName: '已刪除使用者',
          email: `deleted_${uid}@deleted.local`,
          photoURL: null,
          avatarUrl: null,
          studentId: null,
          department: null,
          bio: null,
          phone: null,
          primarySchoolId: null,
          schoolId: null,
          pushToken: null,
          isPublicProfile: false,
          deletedAt: FieldValue.serverTimestamp(),
          status: 'deleted',
        },
        { merge: true },
      );

      // 刪除 Firebase Auth 帳號
      const { getAuth } = require('firebase-admin/auth');
      await getAuth().deleteUser(uid);

      return { success: true };
    } catch (error) {
      console.error('Delete user account error:', error);
      throw new HttpsError('internal', 'Failed to delete account');
    }
  },
);

// =====================================================
// 餐廳訂餐 API
// =====================================================

exports.createOrder = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = trimString(request.data?.schoolId, 120);
    const cafeteriaId = trimString(request.data?.cafeteriaId, 160);
    const items = Array.isArray(request.data?.items) ? request.data.items : [];
    const pickupTime = request.data?.pickupTime;
    const note = request.data?.note;
    const paymentMethod = request.data?.paymentMethod;

    if (!schoolId || !cafeteriaId || items.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);
    const cafeteriaDoc = await getCafeteriaRef(schoolId, cafeteriaId).get();
    if (!cafeteriaDoc.exists) {
      throw new HttpsError('not-found', 'Cafeteria not found');
    }

    const cafeteriaData = cafeteriaDoc.data() || {};
    const hasActiveOperator = await cafeteriaHasActiveOperator(schoolId, cafeteriaId);
    const { merchantId, cafeteriaName: cafeteria } = resolveCafeteriaOrderingMetadata(
      cafeteriaData,
      {
        cafeteriaId,
        fallbackName: request.data?.cafeteria,
        hasActiveOperator,
        HttpsError,
      },
    );

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    const orderPayload = {
      userId: uid,
      schoolId,
      cafeteriaId,
      merchantId,
      cafeteria,
      items,
      subtotal,
      tax,
      total,
      totalAmount: total,
      pickupTime: pickupTime || null,
      note: note || null,
      paymentMethod: paymentMethod || 'campus_card',
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    };

    const orderRef = db.collection('schools').doc(schoolId).collection('orders').doc();
    const userOrderRef = getUserSchoolDoc(uid, schoolId, 'orders', orderRef.id);

    await db.runTransaction(async (transaction) => {
      transaction.set(orderRef, orderPayload);
      transaction.set(userOrderRef, orderPayload);
    });

    return {
      success: true,
      orderId: orderRef.id,
      total,
    };
  },
);

exports.updateOrderStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, orderId, status } = request.data;

    if (!schoolId || !orderId || !status) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const validStatuses = ['confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new HttpsError('invalid-argument', 'Invalid status');
    }

    const orderRef = db.collection('schools').doc(schoolId).collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const order = orderDoc.data();
    const membership = await getActiveSchoolMembership(schoolId, uid);
    const hasSchoolOverride = ['admin', 'editor'].includes(membership?.role ?? '');

    if (!hasSchoolOverride) {
      const cafeteriaId = trimString(order?.cafeteriaId, 160);
      if (!cafeteriaId) {
        throw new HttpsError('permission-denied', 'Legacy orders without cafeteriaId are read-only');
      }
      await assertCafeteriaOperator(schoolId, cafeteriaId, uid);
    }

    if (order.status === 'cancelled' || order.status === 'completed') {
      throw new HttpsError('failed-precondition', 'Cannot update completed or cancelled orders');
    }

    await orderRef.update({
      status,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });
    await getUserSchoolDoc(order.userId, schoolId, 'orders', orderId).set(
      {
        status,
        [`${status}At`]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (['ready', 'cancelled'].includes(status)) {
      await sendPushToUser(
        order.userId,
        {
          title: status === 'ready' ? '🍽️ 餐點已備妥' : '❌ 訂單已取消',
          body: status === 'ready' ? '您的餐點已準備完成，請前往取餐' : '您的訂單已被取消',
        },
        {
          type: 'order',
          orderId,
          schoolId,
          channel: 'orders',
        },
      );
    }

    return { success: true };
  },
);

exports.cancelOrder = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, orderId, reason } = request.data;

    if (!schoolId || !orderId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const orderRef = db.collection('schools').doc(schoolId).collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const order = orderDoc.data();

    if (order.userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your order');
    }

    if (['preparing', 'ready', 'completed'].includes(order.status)) {
      throw new HttpsError('failed-precondition', 'Cannot cancel order in this status');
    }

    await orderRef.update({
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: reason || 'User cancelled',
    });
    await getUserSchoolDoc(uid, schoolId, 'orders', orderId).set(
      {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: reason || 'User cancelled',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { success: true };
  },
);

// =====================================================
// 宿舍服務 API
// =====================================================

exports.submitRepairRequest = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, dormitory, room, category, description, urgency, images } = request.data;

    if (!schoolId || !dormitory || !room || !category || !description) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const repairRef = await db
      .collection('schools')
      .doc(schoolId)
      .collection('repairRequests')
      .add({
        userId: uid,
        dormitory,
        room,
        category,
        description,
        urgency: urgency || 'normal',
        images: images || [],
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      requestId: repairRef.id,
    };
  },
);

exports.updateRepairStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, requestId, status, note } = request.data;

    if (!schoolId || !requestId || !status) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertServiceRole(schoolId, uid, 'repairs');

    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new HttpsError('invalid-argument', 'Invalid status');
    }

    const requestRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('repairRequests')
      .doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new HttpsError('not-found', 'Repair request not found');
    }

    await requestRef.update({
      status,
      staffNote: note || null,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });

    const repairData = requestDoc.data();
    if (['assigned', 'completed'].includes(status)) {
      await sendPushToUser(
        repairData.userId,
        {
          title: status === 'assigned' ? '🔧 報修已受理' : '✅ 報修已完成',
          body: status === 'assigned' ? '您的報修已派員處理' : '您的報修已完成，請確認',
        },
        {
          type: 'repair',
          requestId,
          schoolId,
          channel: 'dormitory',
        },
      );
    }

    return { success: true };
  },
);

exports.registerPackageArrival = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, recipientId, trackingNumber, courier, location, locker } = request.data;

    if (!schoolId || !recipientId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertServiceRole(schoolId, uid, 'packages');

    const packageRef = await db
      .collection('schools')
      .doc(schoolId)
      .collection('packages')
      .add({
        recipientId,
        trackingNumber: trackingNumber || null,
        courier: courier || 'unknown',
        location: location || '管理室',
        locker: locker || null,
        status: 'arrived',
        registeredBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

    await sendPushToUser(
      recipientId,
      {
        title: '📦 包裹到了！',
        body: locker
          ? `您的包裹已放入 ${locker}，請儘快領取`
          : `您的包裹已到達 ${location}，請儘快領取`,
      },
      {
        type: 'package',
        packageId: packageRef.id,
        schoolId,
        channel: 'dormitory',
      },
    );

    return {
      success: true,
      packageId: packageRef.id,
    };
  },
);

exports.confirmPackagePickup = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, packageId } = request.data;

    if (!schoolId || !packageId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const packageRef = db.collection('schools').doc(schoolId).collection('packages').doc(packageId);
    const packageDoc = await packageRef.get();

    if (!packageDoc.exists) {
      throw new HttpsError('not-found', 'Package not found');
    }

    if (packageDoc.data().recipientId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your package');
    }

    await packageRef.update({
      status: 'picked_up',
      pickedUpAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);

exports.reserveWashingMachine = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, dormitory, machineId, startTime } = request.data;

    if (!schoolId || !dormitory || !machineId || !startTime) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const machineRef = db.collection('schools').doc(schoolId).collection('washingMachines').doc(machineId);
    const machineDoc = await machineRef.get();
    if (!machineDoc.exists) {
      throw new HttpsError('not-found', 'Washing machine not found');
    }

    if (machineDoc.data().status !== 'available') {
      throw new HttpsError('failed-precondition', 'Machine is not available');
    }

    const existingReservation = await db
      .collection('schools')
      .doc(schoolId)
      .collection('washingReservations')
      .where('machineId', '==', machineId)
      .where('startTime', '==', startTime)
      .where('status', 'in', ['reserved', 'active'])
      .get();

    if (!existingReservation.empty) {
      throw new HttpsError('already-exists', 'This time slot is already reserved');
    }

    const reservationRef = db.collection('schools').doc(schoolId).collection('washingReservations').doc();
    const reservedUntil = new Date(Date.now() + 10 * 60 * 1000);

    await db.runTransaction(async (transaction) => {
      transaction.set(reservationRef, {
        userId: uid,
        schoolId,
        dormitory,
        machineId,
        startTime,
        status: 'reserved',
        reservedUntil: Timestamp.fromDate(reservedUntil),
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(machineRef, {
        status: 'reserved',
        reservedBy: uid,
        reservedUntil: Timestamp.fromDate(reservedUntil),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      success: true,
      reservationId: reservationRef.id,
      reservedUntil: reservedUntil.toISOString(),
    };
  },
);

exports.cancelWashingReservation = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, reservationId } = request.data;

    if (!schoolId || !reservationId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const reservationRef = db.collection('schools').doc(schoolId).collection('washingReservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();
    if (!reservationDoc.exists) {
      throw new HttpsError('not-found', 'Reservation not found');
    }

    const reservation = reservationDoc.data();
    if (reservation.userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your reservation');
    }

    if (['completed', 'cancelled'].includes(reservation.status)) {
      throw new HttpsError('failed-precondition', 'Reservation cannot be cancelled');
    }

    const machineRef = db.collection('schools').doc(schoolId).collection('washingMachines').doc(reservation.machineId);

    await db.runTransaction(async (transaction) => {
      transaction.update(reservationRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        machineRef,
        {
          status: 'available',
          reservedBy: null,
          reservedUntil: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    return { success: true };
  },
);

// =====================================================
// 列印服務 API
// =====================================================

exports.submitPrintJob = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, printerId, fileName, fileUrl, copies, color, duplex, pages } = request.data;

    if (!schoolId || !printerId || !fileName || !fileUrl) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const printerRef = db.collection('schools').doc(schoolId).collection('printers').doc(printerId);
    const printerDoc = await printerRef.get();
    const printerData = printerDoc.exists ? printerDoc.data() : null;

    const pageCount = pages || 1;
    const copyCount = copies || 1;
    const isColor = color || false;
    const isDuplex = duplex || false;

    const pricePerPage = isColor
      ? Number(printerData?.pricePerPage?.color ?? 5)
      : Number(printerData?.pricePerPage?.bw ?? 1);
    const totalPages = pageCount * copyCount;
    const cost = totalPages * pricePerPage;

    const jobRef = db.collection('schools').doc(schoolId).collection('printJobs').doc();
    await db.runTransaction(async (transaction) => {
      transaction.set(jobRef, {
        userId: uid,
        schoolId,
        printerId,
        fileName,
        fileUrl,
        copies: copyCount,
        color: isColor,
        duplex: isDuplex,
        pages: pageCount,
        totalPages,
        cost,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });

      if (printerDoc.exists) {
        transaction.update(printerRef, {
          queueLength: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return {
      success: true,
      jobId: jobRef.id,
      cost,
      estimatedTime: Math.ceil(totalPages / 10),
    };
  },
);

exports.updatePrintJobStatus = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, jobId, status } = request.data;

    if (!schoolId || !jobId || !status) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertServiceRole(schoolId, uid, 'printing');

    const validStatuses = ['pending', 'queued', 'printing', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new HttpsError('invalid-argument', 'Invalid status');
    }

    const jobRef = db.collection('schools').doc(schoolId).collection('printJobs').doc(jobId);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      throw new HttpsError('not-found', 'Print job not found');
    }

    await jobRef.update({
      status,
      [`${status}At`]: FieldValue.serverTimestamp(),
    });

    const jobData = jobDoc.data();
    if (status === 'completed') {
      await sendPushToUser(
        jobData.userId,
        {
          title: '🖨️ 列印完成',
          body: `${jobData.fileName} 已列印完成，請前往取件`,
        },
        {
          type: 'print',
          jobId,
          schoolId,
          channel: 'print',
        },
      );
    }

    return { success: true };
  },
);

exports.cancelPrintJob = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, jobId } = request.data;

    if (!schoolId || !jobId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const jobRef = db.collection('schools').doc(schoolId).collection('printJobs').doc(jobId);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      throw new HttpsError('not-found', 'Print job not found');
    }

    if (jobDoc.data().userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your print job');
    }

    if (jobDoc.data().status === 'printing') {
      throw new HttpsError('failed-precondition', 'Cannot cancel a job that is currently printing');
    }

    await db.runTransaction(async (transaction) => {
      transaction.update(jobRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });

      if (jobDoc.data().printerId) {
        transaction.set(
          db.collection('schools').doc(schoolId).collection('printers').doc(jobDoc.data().printerId),
          {
            queueLength: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    });

    return { success: true };
  },
);

// =====================================================
// 健康中心預約 API
// =====================================================

exports.bookHealthAppointment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = request.data.schoolId;
    const date = request.data.date;
    const time = request.data.time || request.data.timeSlot;
    const department = request.data.department;
    const doctorId = request.data.doctorId || null;
    const doctorName = request.data.doctorName || null;
    const symptoms = request.data.symptoms ?? request.data.reason ?? null;
    const note = request.data.note ?? request.data.notes ?? null;

    if (!schoolId || !date || !time || !department) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const existingAppointment = await db
      .collection('schools')
      .doc(schoolId)
      .collection('healthAppointments')
      .where('date', '==', date)
      .where('timeSlot', '==', time)
      .where('doctorId', '==', doctorId)
      .where('status', '==', 'scheduled')
      .get();

    if (!existingAppointment.empty) {
      throw new HttpsError('already-exists', 'This time slot is already booked');
    }

    const appointmentRef = await db
      .collection('schools')
      .doc(schoolId)
      .collection('healthAppointments')
      .add({
        userId: uid,
        schoolId,
        date,
        time,
        timeSlot: time,
        department,
        doctorId,
        doctorName,
        symptoms,
        reason: symptoms,
        note,
        notes: note,
        status: 'scheduled',
        createdAt: FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      appointmentId: appointmentRef.id,
    };
  },
);

exports.cancelHealthAppointment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, appointmentId, reason } = request.data;

    if (!schoolId || !appointmentId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const appointmentRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('healthAppointments')
      .doc(appointmentId);
    const appointmentDoc = await appointmentRef.get();

    if (!appointmentDoc.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    if (appointmentDoc.data().userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your appointment');
    }

    await appointmentRef.update({
      status: 'cancelled',
      cancelReason: reason || null,
      cancelledAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);

exports.rescheduleHealthAppointment = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const schoolId = request.data.schoolId;
    const appointmentId = request.data.appointmentId;
    const date = request.data.date;
    const time = request.data.time || request.data.timeSlot;

    if (!schoolId || !appointmentId || !date || !time) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const appointmentRef = db
      .collection('schools')
      .doc(schoolId)
      .collection('healthAppointments')
      .doc(appointmentId);
    const appointmentDoc = await appointmentRef.get();

    if (!appointmentDoc.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    if (appointmentDoc.data().userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your appointment');
    }

    if (appointmentDoc.data().status === 'completed') {
      throw new HttpsError('failed-precondition', 'Completed appointment cannot be rescheduled');
    }

    await appointmentRef.update({
      date,
      time,
      timeSlot: time,
      doctorId: request.data.doctorId || null,
      doctorName: request.data.doctorName || null,
      status: 'scheduled',
      rescheduledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  },
);

exports.getHealthRecords = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, limit: queryLimit } = request.data;

    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const recordsSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('healthRecords')
      .where('userId', '==', uid)
      .orderBy('visitDate', 'desc')
      .limit(queryLimit || 20)
      .get();

    return {
      records: recordsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  },
);

// =====================================================
// 校車服務 API
// =====================================================

exports.getBusArrivals = onCall(
  {
    region: REGION,
    secrets: [TDX_CLIENT_ID, TDX_CLIENT_SECRET],
  },
  async (request) => {
    const { schoolId, stopId, city, routeId } = request.data;

    if (!schoolId || !stopId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId or stopId');
    }

    const cacheRef = db.collection('busArrivals').doc(`${schoolId}_${stopId}`);
    const CACHE_TTL_MS = 60 * 1000; // 60 秒 Cache

    // 讀取 Firestore Cache
    const cached = await cacheRef.get().catch(() => null);
    if (cached && cached.exists) {
      const cacheData = cached.data();
      const cacheAge = Date.now() - (cacheData.cachedAt?.toMillis() ?? 0);
      if (cacheAge < CACHE_TTL_MS) {
        console.log(`[getBusArrivals] Cache hit for ${stopId}`);
        return { arrivals: cacheData.arrivals, fromCache: true };
      }
    }

    // 嘗試呼叫 TDX API
    const clientId = TDX_CLIENT_ID.value();
    const clientSecret = TDX_CLIENT_SECRET.value();

    if (!clientId || !clientSecret) {
      // 沒有 TDX 金鑰：回傳靜態資料
      const staticSnap = await db
        .collection('busArrivals')
        .where('schoolId', '==', schoolId)
        .where('stopId', '==', stopId)
        .orderBy('estimatedArrival', 'asc')
        .limit(10)
        .get()
        .catch(() => ({ docs: [] }));
      return {
        arrivals: staticSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fromCache: false,
        noApiKey: true,
      };
    }

    try {
      const accessToken = await getTdxAccessToken(clientId, clientSecret);
      const cityCode = city ?? 'Taipei';
      const apiPath = routeId
        ? `/api/basic/v3/Bus/EstimatedTimeOfArrival/City/${cityCode}/${encodeURIComponent(routeId)}?%24filter=StopUID%20eq%20'${encodeURIComponent(stopId)}'&%24format=JSON&%24top=20`
        : `/api/basic/v3/Bus/EstimatedTimeOfArrival/City/${cityCode}?%24filter=StopUID%20eq%20'${encodeURIComponent(stopId)}'&%24format=JSON&%24top=20`;

      const tdxData = await fetchTdxApi(apiPath, accessToken);
      const arrivals = Array.isArray(tdxData)
        ? tdxData.map((item) => ({
            routeId: item.RouteID ?? routeId,
            routeName: item.RouteName?.Zh_tw ?? item.RouteUID ?? '—',
            stopId: item.StopUID ?? stopId,
            stopName: item.StopName?.Zh_tw ?? '—',
            estimatedArrival: item.EstimateTime != null ? item.EstimateTime : null, // 秒數
            plateNo: item.PlateNumb ?? null,
            status: item.StopStatus ?? 0,
            direction: item.Direction ?? 0,
            fetchedAt: new Date().toISOString(),
          }))
        : [];

      // 寫入 Firestore Cache
      await cacheRef
        .set({
          schoolId,
          stopId,
          arrivals,
          cachedAt: FieldValue.serverTimestamp(),
        })
        .catch((e) => console.warn('[getBusArrivals] Cache write failed:', e));

      console.log(`[getBusArrivals] TDX fetch OK: ${arrivals.length} arrivals for ${stopId}`);
      return { arrivals, fromCache: false };
    } catch (err) {
      console.error('[getBusArrivals] TDX API error:', err);
      // 回傳 Firestore 靜態資料作為 fallback
      const staticSnap = await db
        .collection('busArrivals')
        .where('schoolId', '==', schoolId)
        .where('stopId', '==', stopId)
        .limit(10)
        .get()
        .catch(() => ({ docs: [] }));
      return {
        arrivals: staticSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fromCache: false,
        error: 'TDX API unavailable, using static data',
      };
    }
  },
);

exports.subscribeBusAlert = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { schoolId, routeId, stopId, alertBefore } = request.data;

    if (!schoolId || !routeId || !stopId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const alertRef = await db
      .collection('users')
      .doc(uid)
      .collection('busAlerts')
      .add({
        schoolId,
        routeId,
        stopId,
        alertBefore: alertBefore || 5,
        enabled: true,
        createdAt: FieldValue.serverTimestamp(),
      });

    return {
      success: true,
      alertId: alertRef.id,
    };
  },
);

exports.unsubscribeBusAlert = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { alertId } = request.data;

    if (!alertId) {
      throw new HttpsError('invalid-argument', 'Missing alertId');
    }

    const alertRef = db.collection('users').doc(uid).collection('busAlerts').doc(alertId);
    const alertDoc = await alertRef.get();

    if (!alertDoc.exists) {
      throw new HttpsError('not-found', 'Alert not found');
    }

    await alertRef.delete();

    return { success: true };
  },
);

exports.busArrivalReminder = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    console.log('Running bus arrival reminder check...');

    const now = new Date();
    const alertsSnap = await db.collectionGroup('busAlerts').where('enabled', '==', true).get();

    let sentCount = 0;

    for (const alertDoc of alertsSnap.docs) {
      const alert = alertDoc.data();
      const userId = alertDoc.ref.parent.parent.id;

      const arrivalsSnap = await db
        .collection('schools')
        .doc(alert.schoolId)
        .collection('busArrivals')
        .where('stopId', '==', alert.stopId)
        .where('routeId', '==', alert.routeId)
        .orderBy('estimatedArrival', 'asc')
        .limit(1)
        .get();

      if (arrivalsSnap.empty) continue;

      const arrival = arrivalsSnap.docs[0].data();
      const arrivalTime = arrival.estimatedArrival.toDate();
      const minutesUntilArrival = (arrivalTime - now) / 1000 / 60;

      if (minutesUntilArrival > 0 && minutesUntilArrival <= alert.alertBefore) {
        const lastNotified = alertDoc.data().lastNotifiedAt?.toDate();
        if (lastNotified && now - lastNotified < 10 * 60 * 1000) {
          continue;
        }

        await sendPushToUser(
          userId,
          {
            title: '🚌 公車即將到站',
            body: `${arrival.routeName || '校車'} 將在約 ${Math.ceil(minutesUntilArrival)} 分鐘後到達 ${arrival.stopName || '您訂閱的站點'}`,
          },
          {
            type: 'bus_arrival',
            routeId: alert.routeId,
            stopId: alert.stopId,
            channel: 'bus',
          },
        );

        await alertDoc.ref.update({
          lastNotifiedAt: FieldValue.serverTimestamp(),
        });

        sentCount++;
      }
    }

    console.log(`Bus arrival reminders sent: ${sentCount}`);
  },
);

// =====================================================
// 成績通知排程
// =====================================================

exports.gradePublishedNotification = onDocumentCreated(
  {
    document: 'schools/{schoolId}/grades/{gradeId}',
    region: REGION,
  },
  async (event) => {
    const { schoolId, gradeId } = event.params;
    const grade = event.data?.data();

    if (!grade) return;

    console.log(`New grade published for user ${grade.userId}: ${grade.courseName}`);

    await sendPushToUser(
      grade.userId,
      {
        title: '📊 成績已公布',
        body: `${grade.courseName} 成績已公布：${grade.letterGrade}`,
      },
      {
        type: 'grade',
        gradeId,
        schoolId,
        channel: 'grades',
      },
    );
  },
);

// =====================================================
// 支付系統 API
// =====================================================

async function createIntentDocument(collectionName, payload) {
  const ref = db.collection(collectionName).doc();
  await ref.set({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

function normalizePaymentMethod(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function assertValidAmount(amount, { min = 1, max = 100000 } = {}) {
  if (typeof amount !== 'number' || Number.isNaN(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Invalid amount');
  }
  if (amount < min) {
    throw new HttpsError('invalid-argument', `Amount must be at least ${min}`);
  }
  if (amount > max) {
    throw new HttpsError('invalid-argument', `Amount must not exceed ${max}`);
  }
}

async function createExternalTopupIntent({ uid, schoolId, amount, paymentMethod }) {
  const intentId = await createIntentDocument('topupIntents', {
    userId: uid,
    schoolId: schoolId || null,
    amount,
    currency: DEFAULT_WALLET_CURRENCY,
    paymentMethod,
    status: EXTERNAL_PAYMENT_ENABLED ? 'pending_provider' : 'provider_disabled',
  });

  if (!EXTERNAL_PAYMENT_ENABLED) {
    return {
      success: false,
      intentId,
      status: 'provider_disabled',
      errorCode: 'EXTERNAL_PROVIDER_DISABLED',
      errorMessage:
        'External top-up providers are disabled until webhook credentials are configured',
    };
  }

  return {
    success: false,
    intentId,
    status: 'pending_provider',
    errorCode: 'PROVIDER_NOT_READY',
    errorMessage: 'Payment provider integration is not active yet',
  };
}

async function getWalletBalancePayload(uid, schoolId = null) {
  const wallet = await getWalletSnapshot(uid, schoolId);
  return {
    schoolId: wallet.schoolId,
    balance: Number(wallet.data.available || 0),
    available: Number(wallet.data.available || 0),
    pending: Number(wallet.data.pending || 0),
    currency: wallet.data.currency || DEFAULT_WALLET_CURRENCY,
    lastUpdated: wallet.data.lastUpdated?.toDate?.()?.toISOString?.() || null,
  };
}

async function listLedgerEntriesPayload(uid, schoolId = null, queryLimit = 50, type = null) {
  const resolvedSchoolId = await resolveUserSchoolId(uid, schoolId);

  if (resolvedSchoolId) {
    let canonicalQuery = getUserSchoolCollection(uid, resolvedSchoolId, 'transactions').orderBy(
      'createdAt',
      'desc',
    );
    if (type && ['payment', 'topup', 'refund'].includes(type)) {
      canonicalQuery = canonicalQuery.where('type', '==', type);
    }

    const canonicalSnapshot = await canonicalQuery
      .limit(queryLimit)
      .get()
      .catch(() => null);
    if (canonicalSnapshot && !canonicalSnapshot.empty) {
      return canonicalSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString?.() || null,
      }));
    }
  }

  let legacyQuery = db
    .collection('ledgerEntries')
    .where('userId', '==', uid)
    .orderBy('createdAt', 'desc');
  if (type && ['payment', 'topup', 'refund'].includes(type)) {
    legacyQuery = legacyQuery.where('type', '==', type);
  }

  const snapshot = await legacyQuery.limit(queryLimit).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString?.() || null,
  }));
}

exports.createTopupIntent = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    enforceRateLimit({
      scope: 'create-topup-intent',
      key: uid,
      limit: 15,
      windowMs: 10 * 60 * 1000,
    });

    const amount = Number(request.data?.amount);
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
    const paymentMethod = normalizePaymentMethod(request.data?.paymentMethod);

    assertValidAmount(amount, { min: 100, max: 10000 });
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    if (!paymentMethod || !isSupportedExternalPaymentMethod(paymentMethod)) {
      throw new HttpsError('invalid-argument', 'Unsupported top-up payment method');
    }

    return createExternalTopupIntent({
      uid,
      schoolId,
      amount,
      paymentMethod,
    });
  },
);

exports.createPaymentIntent = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    enforceRateLimit({
      scope: 'create-payment-intent',
      key: uid,
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });

    const amount = Number(request.data?.amount);
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
    const paymentMethod = normalizePaymentMethod(request.data?.paymentMethod);
    const merchantId = String(request.data?.merchantId || '').trim();
    const description = String(request.data?.description || '').trim();

    assertValidAmount(amount, { min: 1, max: 100000 });
    if (!schoolId) {
      throw new HttpsError('invalid-argument', 'Missing schoolId');
    }

    if (!merchantId) {
      throw new HttpsError('invalid-argument', 'Missing merchantId');
    }

    const intentId = await createIntentDocument('paymentIntents', {
      userId: uid,
      schoolId,
      amount,
      currency: DEFAULT_WALLET_CURRENCY,
      paymentMethod,
      merchantId,
      description,
      status: 'created',
    });

    if (paymentMethod === 'campus_card') {
      const result = await appendWalletLedgerEntry({
        uid,
        schoolId,
        amount: -amount,
        type: 'payment',
        status: 'completed',
        description: description || 'Campus card payment',
        paymentMethod,
        merchantId,
        sourceCollection: 'paymentIntents',
        sourceId: intentId,
      });

      await db.collection('paymentIntents').doc(intentId).set(
        {
          status: 'completed',
          completedAt: FieldValue.serverTimestamp(),
          ledgerEntryId: result.ledgerEntryId,
          balanceAfter: result.balance,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        success: true,
        intentId,
        transactionId: result.ledgerEntryId,
        newBalance: result.balance,
        status: 'completed',
      };
    }

    if (!isSupportedExternalPaymentMethod(paymentMethod)) {
      await db.collection('paymentIntents').doc(intentId).set(
        {
          status: 'rejected',
          errorCode: 'UNSUPPORTED_PAYMENT_METHOD',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      throw new HttpsError('invalid-argument', 'Unsupported payment method');
    }

    await db
      .collection('paymentIntents')
      .doc(intentId)
      .set(
        {
          status: EXTERNAL_PAYMENT_ENABLED ? 'pending_provider' : 'provider_disabled',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    return {
      success: false,
      intentId,
      status: EXTERNAL_PAYMENT_ENABLED ? 'pending_provider' : 'provider_disabled',
      errorCode: EXTERNAL_PAYMENT_ENABLED ? 'PROVIDER_NOT_READY' : 'EXTERNAL_PROVIDER_DISABLED',
      errorMessage: EXTERNAL_PAYMENT_ENABLED
        ? 'Payment provider integration is not active yet'
        : 'External payment providers are disabled until webhook credentials are configured',
    };
  },
);

exports.providerWebhook = onRequest(
  {
    region: REGION,
    cors: false,
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      enforceRateLimit({
        scope: 'provider-webhook',
        key: getClientIp(req),
        limit: 60,
        windowMs: 5 * 60 * 1000,
      });

      const provider = String(req.query?.provider || req.body?.provider || '')
        .trim()
        .toLowerCase();
      if (provider !== 'linepay') {
        res.status(501).json({
          error: 'Payment provider webhook is not configured yet',
        });
        return;
      }

      res.status(501).json({
        error: 'Line Pay webhook verification is not configured yet',
      });
    } catch (error) {
      console.error('providerWebhook error:', error);
      writeHttpError(res, error, 'Webhook processing failed');
    }
  },
);

exports.processTopup = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
  },
  async (_req, res) => {
    res.status(410).json({
      code: 'DEPRECATED_ENDPOINT',
      message: 'processTopup has been removed. Use createTopupIntent instead.',
    });
  },
);

exports.processPayment = onRequest(
  {
    region: REGION,
    cors: STRICT_CORS,
  },
  async (_req, res) => {
    res.status(410).json({
      code: 'DEPRECATED_ENDPOINT',
      message: 'processPayment has been removed. Use createPaymentIntent instead.',
    });
  },
);

exports.getBalance = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
    return getWalletBalancePayload(uid, schoolId);
  },
);

exports.getWalletBalance = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    try {
      const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
      return getWalletBalancePayload(uid, schoolId);
    } catch (error) {
      console.error('getWalletBalance error:', error);
      throw new HttpsError('internal', 'Failed to get wallet balance');
    }
  },
);

exports.listLedgerEntries = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { limit: queryLimit = 50, type } = request.data || {};
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);

    try {
      return {
        entries: await listLedgerEntriesPayload(uid, schoolId, queryLimit, type),
      };
    } catch (error) {
      console.error('listLedgerEntries error:', error);
      throw new HttpsError('internal', 'Failed to list wallet ledger');
    }
  },
);

exports.getTransactionHistory = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const { limit: queryLimit = 50, type } = request.data || {};
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
    return {
      transactions: await listLedgerEntriesPayload(uid, schoolId, queryLimit, type),
    };
  },
);

exports.requestRefund = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const transactionId = String(request.data?.transactionId || '').trim();
    const reason = String(request.data?.reason || '').trim();
    const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);

    if (!transactionId) {
      throw new HttpsError('invalid-argument', 'Missing transactionId');
    }

    const transactionDoc = schoolId
      ? await getUserSchoolDoc(uid, schoolId, 'transactions', transactionId).get()
      : await db.collection('transactions').doc(transactionId).get();
    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transactionData = transactionDoc.data();
    if (transactionData.userId !== uid) {
      throw new HttpsError('permission-denied', 'This is not your transaction');
    }

    const refundRequestRef = await db.collection('refundRequests').add({
      userId: uid,
      schoolId: schoolId || null,
      transactionId,
      reason,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      refundRequestId: refundRequestRef.id,
      message: 'Refund request submitted',
    };
  },
);

// =====================================================
// 成就追蹤系統 (trackAchievement)
// =====================================================

exports.trackAchievement = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { achievementId, progress } = request.data;
  const schoolId = await resolveUserSchoolId(uid, request.data?.schoolId || null);
  if (!achievementId || progress === undefined) {
    throw new HttpsError('invalid-argument', 'Missing achievementId or progress');
  }

  const ACHIEVEMENT_REQUIREMENTS = {
    navigate_first: 1,
    event_first: 1,
    event_5: 5,
    group_join: 1,
    post_first: 1,
    post_10: 10,
    credit_check: 1,
    course_10: 10,
    ai_chat: 1,
    ai_master: 50,
    streak_7: 7,
    streak_30: 30,
    knowledge_contributor: 5,
    top_questioner: 3,
  };

  const requirement = ACHIEVEMENT_REQUIREMENTS[achievementId] ?? 1;
  const wasUnlocked = progress >= requirement;

  try {
    const achievementRef = schoolId
      ? getUserSchoolDoc(uid, schoolId, 'achievements', achievementId)
      : db.collection('users').doc(uid).collection('achievements').doc(achievementId);
    const existing = await achievementRef.get();
    const legacyExisting = !existing.exists
      ? await db
          .collection('users')
          .doc(uid)
          .collection('achievements')
          .doc(achievementId)
          .get()
          .catch(() => null)
      : null;
    const existingData = existing.exists ? existing.data() : legacyExisting?.data?.() || null;

    const newData = {
      progress,
      unlocked: wasUnlocked,
      schoolId: schoolId || null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (wasUnlocked && !existingData?.unlockedAt) {
      newData.unlockedAt = FieldValue.serverTimestamp();
    }

    await achievementRef.set(newData, { merge: true });

    // 同步更新排行榜
    if (schoolId && wasUnlocked && !existingData?.unlocked) {
      const ACHIEVEMENT_POINTS = {
        navigate_first: 15,
        event_first: 25,
        event_5: 75,
        group_join: 20,
        post_first: 30,
        post_10: 100,
        credit_check: 20,
        course_10: 80,
        ai_chat: 25,
        ai_master: 150,
        streak_7: 100,
        streak_30: 300,
        knowledge_contributor: 80,
        top_questioner: 50,
      };
      const points = ACHIEVEMENT_POINTS[achievementId] ?? 10;

      const leaderboardRef = db
        .collection('schools')
        .doc(schoolId)
        .collection('leaderboard')
        .doc(uid);
      await leaderboardRef.set(
        {
          points: FieldValue.increment(points),
          displayName: (await db.collection('users').doc(uid).get()).data()?.displayName ?? '同學',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return { success: true, unlocked: wasUnlocked };
  } catch (error) {
    console.error('trackAchievement error:', error);
    throw new HttpsError('internal', 'Failed to track achievement');
  }
});

// =====================================================
// 課堂互動 - Live Session
// =====================================================

exports.startLiveSession = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { groupId, classroomLat, classroomLng, qrExpiryMinutes = 5 } = request.data;
  if (!groupId) throw new HttpsError('invalid-argument', 'Missing groupId');

  const memberRef = db.collection('groups').doc(groupId).collection('members').doc(uid);
  const member = await memberRef.get();
  if (!member.exists || !['owner', 'instructor'].includes(member.data()?.role)) {
    throw new HttpsError('permission-denied', 'Only instructors can start a live session');
  }

  const sessionId = `${new Date().toISOString().slice(0, 10)}_${Date.now()}`;
  const qrToken = `${groupId}_${sessionId}_${Math.random().toString(36).slice(2, 10)}`;
  const qrExpiresAt = new Date(Date.now() + qrExpiryMinutes * 60 * 1000);

  const liveSessionRef = db
    .collection('groups')
    .doc(groupId)
    .collection('liveSessions')
    .doc(sessionId);
  const attendanceSessionRef = db
    .collection('groups')
    .doc(groupId)
    .collection('attendanceSessions')
    .doc(sessionId);
  const sessionPayload = {
    sessionId,
    teacherId: uid,
    startedAt: FieldValue.serverTimestamp(),
    endedAt: null,
    active: true,
    qrToken,
    qrExpiresAt: Timestamp.fromDate(qrExpiresAt),
    ...(classroomLat && classroomLng
      ? { location: { lat: classroomLat, lng: classroomLng, radiusM: 100 } }
      : {}),
    reactions: { understood: 0, partial: 0, confused: 0 },
    attendeeCount: 0,
  };

  await Promise.all([
    liveSessionRef.set(sessionPayload),
    attendanceSessionRef.set({
      sessionId,
      liveSessionId: sessionId,
      groupId,
      teacherId: uid,
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      active: true,
      attendeeCount: 0,
      attendanceMode: 'qr',
      source: 'live_session',
      qrEnabled: true,
      ...(classroomLat && classroomLng
        ? { location: { lat: classroomLat, lng: classroomLng, radiusM: 100 } }
        : {}),
    }),
  ]);

  // 推播通知給群組成員
  const membersSnap = await db.collection('groups').doc(groupId).collection('members').get();
  const studentUids = membersSnap.docs
    .filter((d) => d.id !== uid && !['instructor', 'owner'].includes(d.data()?.role))
    .map((d) => d.id);

  const groupDoc = await db.collection('groups').doc(groupId).get();
  const groupName = groupDoc.data()?.name ?? '課堂';

  const tokens = (await Promise.all(studentUids.map(getUserPushTokens))).flat().filter(Boolean);
  if (tokens.length > 0) {
    await messaging.sendEachForMulticast({
      tokens,
      notification: { title: `${groupName} 課堂開始`, body: '老師已開啟即時課堂互動，快進入！' },
      data: { type: 'live_session', groupId, sessionId, click_action: 'OPEN_CLASSROOM' },
    });
  }

  return { success: true, sessionId, qrToken, qrExpiresAt: qrExpiresAt.toISOString() };
});

exports.endLiveSession = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { groupId, sessionId } = request.data;
  if (!groupId || !sessionId)
    throw new HttpsError('invalid-argument', 'Missing groupId or sessionId');

  const sessionRef = db.collection('groups').doc(groupId).collection('liveSessions').doc(sessionId);
  const session = await sessionRef.get();

  if (!session.exists || session.data()?.teacherId !== uid) {
    throw new HttpsError('permission-denied', 'Not authorized to end this session');
  }

  await Promise.all([
    sessionRef.update({ active: false, endedAt: FieldValue.serverTimestamp() }),
    db.collection('groups').doc(groupId).collection('attendanceSessions').doc(sessionId).set(
      {
        active: false,
        endedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
  ]);
  return { success: true };
});

exports.submitPollResponse = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { groupId, sessionId, pollId, optionIdx } = request.data;
  if (!groupId || !sessionId || !pollId || optionIdx === undefined) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  const pollRef = db
    .collection('groups')
    .doc(groupId)
    .collection('liveSessions')
    .doc(sessionId)
    .collection('polls')
    .doc(pollId);

  await pollRef.update({ [`responses.${uid}`]: optionIdx });
  return { success: true };
});

exports.joinLiveSession = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { groupId, sessionId, qrToken } = request.data;
  if (!groupId || !sessionId) throw new HttpsError('invalid-argument', 'Missing required fields');

  const sessionRef = db.collection('groups').doc(groupId).collection('liveSessions').doc(sessionId);
  const session = await sessionRef.get();

  if (!session.exists || !session.data()?.active) {
    throw new HttpsError('not-found', 'Session not found or not active');
  }

  if (qrToken) {
    const sessionData = session.data();
    if (sessionData.qrToken !== qrToken) {
      throw new HttpsError('permission-denied', 'Invalid QR token');
    }
    if (sessionData.qrExpiresAt && sessionData.qrExpiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'QR code has expired');
    }
  }

  const attendanceSessionRef = db
    .collection('groups')
    .doc(groupId)
    .collection('attendanceSessions')
    .doc(sessionId);

  await db.runTransaction(async (transaction) => {
    const latestSession = await transaction.get(sessionRef);
    if (!latestSession.exists || !latestSession.data()?.active) {
      throw new HttpsError('not-found', 'Session not found or not active');
    }

    const latestSessionData = latestSession.data();
    const alreadyJoined = !!latestSessionData?.attendees?.[uid];
    const sessionUpdates = {
      [`attendees.${uid}`]: FieldValue.serverTimestamp(),
    };

    if (!alreadyJoined) {
      sessionUpdates.attendeeCount = FieldValue.increment(1);
    }

    transaction.update(sessionRef, sessionUpdates);
    transaction.set(
      attendanceSessionRef,
      {
        sessionId,
        liveSessionId: sessionId,
        groupId,
        teacherId: latestSessionData.teacherId,
        startedAt: latestSessionData.startedAt || FieldValue.serverTimestamp(),
        active: latestSessionData.active,
        attendanceMode: 'qr',
        source: 'live_session',
        ...(qrToken ? { qrEnabled: true } : {}),
        ...(latestSessionData.location ? { location: latestSessionData.location } : {}),
        [`attendees.${uid}`]: FieldValue.serverTimestamp(),
        ...(alreadyJoined ? {} : { attendeeCount: FieldValue.increment(1) }),
      },
      { merge: true },
    );
    transaction.set(
      attendanceSessionRef.collection('attendanceRecords').doc(uid),
      {
        uid,
        status: 'present',
        source: qrToken ? 'qr' : 'tap',
        checkedInAt: FieldValue.serverTimestamp(),
        sessionId,
        groupId,
      },
      { merge: true },
    );
  });

  return { success: true };
});

exports.submitReaction = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { groupId, sessionId, reaction } = request.data;
  if (!groupId || !sessionId || !['understood', 'partial', 'confused'].includes(reaction)) {
    throw new HttpsError('invalid-argument', 'Invalid reaction');
  }

  const sessionRef = db.collection('groups').doc(groupId).collection('liveSessions').doc(sessionId);
  const userReactionRef = sessionRef.collection('userReactions').doc(uid);

  const existing = await userReactionRef.get();
  const updates = { [`reactions.${reaction}`]: FieldValue.increment(1) };

  if (existing.exists && existing.data()?.reaction) {
    updates[`reactions.${existing.data().reaction}`] = FieldValue.increment(-1);
  }

  await Promise.all([
    sessionRef.update(updates),
    userReactionRef.set({ reaction, updatedAt: FieldValue.serverTimestamp() }),
  ]);

  return { success: true };
});

// =====================================================
// AI 每日簡報 (generateDailyBrief) - 每日 07:30
// =====================================================

exports.generateDailyBrief = onSchedule(
  { schedule: '30 7 * * *', region: REGION, timeZone: 'Asia/Taipei' },
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[generateDailyBrief] Running for ${today}`);

    try {
      const usersSnap = await db
        .collection('users')
        .where('role', 'in', ['student', 'teacher'])
        .limit(500)
        .get();

      await Promise.allSettled(
        usersSnap.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();

          // 取得用戶的課程（從 AsyncStorage 無法在後端讀，改由用戶 Firestore profile 存）
          const schoolId = userData.primarySchoolId || userData.schoolId;
          if (!schoolId) return;

          // 取得今日課程 (透過 schedule subcollection 或 直接從 groups 取)
          const briefParts = [];

          // 統計今日課程（查詢用戶加入的所有群組 members 紀錄）
          const memberSnap = await db
            .collectionGroup('members')
            .where('uid', '==', uid)
            .limit(20)
            .get()
            .catch(() => ({ docs: [] }));

          if (memberSnap.docs.length > 0) {
            briefParts.push(`今天你已加入 ${memberSnap.docs.length} 個學習群組。`);
          }

          // 取得最新公告（頂層 announcements 集合，依 schoolId 篩選）
          const announcementsSnap = await db
            .collection('announcements')
            .where('schoolId', '==', schoolId)
            .orderBy('publishedAt', 'desc')
            .limit(2)
            .get()
            .catch(() => ({ docs: [] }));

          if (announcementsSnap.docs.length > 0) {
            const titles = announcementsSnap.docs.map((d) => d.data().title).filter(Boolean);
            if (titles.length > 0) {
              briefParts.push(`最新公告：${titles.slice(0, 2).join('、')}。`);
            }
          }

          if (briefParts.length === 0) {
            briefParts.push('今天也要加油！有任何問題可以問 AI 助理。');
          }

          const content = briefParts.join(' ');

          await getUserSchoolDoc(uid, schoolId, 'dailyBriefs', today).set({
            content,
            schoolId,
            generatedAt: FieldValue.serverTimestamp(),
            date: today,
          });
        }),
      );

      console.log(`[generateDailyBrief] Completed for ${usersSnap.docs.length} users`);
    } catch (error) {
      console.error('[generateDailyBrief] Error:', error);
    }
  },
);

// =====================================================
// 學習週報 (generateWeeklyReport) - 每週日 22:00
// =====================================================

exports.generateWeeklyReport = onSchedule(
  { schedule: '0 22 * * 0', region: REGION, timeZone: 'Asia/Taipei' },
  async () => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    const weekId = `${weekStart.toISOString().slice(0, 10)}_${now.toISOString().slice(0, 10)}`;

    console.log(`[generateWeeklyReport] Running for week ${weekId}`);

    try {
      const usersSnap = await db
        .collection('users')
        .where('role', '==', 'student')
        .limit(500)
        .get();

      await Promise.allSettled(
        usersSnap.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();
          const schoolId = userData.primarySchoolId || userData.schoolId;
          if (!schoolId) return;

          // 統計本週成就解鎖數
          const achievementsSnap = await getUserSchoolCollection(uid, schoolId, 'achievements')
            .where('unlocked', '==', true)
            .where('updatedAt', '>=', Timestamp.fromDate(weekStart))
            .get()
            .catch(async () =>
              db
                .collection('users')
                .doc(uid)
                .collection('achievements')
                .where('unlocked', '==', true)
                .where('updatedAt', '>=', Timestamp.fromDate(weekStart))
                .get()
                .catch(() => ({ docs: [] })),
            );

          const newAchievements = achievementsSnap.docs.length;

          // 統計本週作業繳交情況
          const submissionsSnap = await db
            .collectionGroup('submissions')
            .where('uid', '==', uid)
            .where('submittedAt', '>=', Timestamp.fromDate(weekStart))
            .get()
            .catch(() => ({ docs: [] }));

          const totalSubmissions = submissionsSnap.docs.length;
          const onTimeSubmissions = submissionsSnap.docs.filter((d) => !d.data().isLate).length;
          const onTimeRate =
            totalSubmissions > 0 ? Math.round((onTimeSubmissions / totalSubmissions) * 100) : 100;

          const summaryParts = [];
          if (newAchievements > 0) summaryParts.push(`解鎖了 ${newAchievements} 個新成就`);
          if (totalSubmissions > 0)
            summaryParts.push(`完成了 ${totalSubmissions} 份作業，準時率 ${onTimeRate}%`);

          const summary =
            summaryParts.length > 0
              ? `本週你${summaryParts.join('、')}。繼續保持！`
              : '本週繼續努力，下週會更好！';

          await getUserSchoolDoc(uid, schoolId, 'weeklyReports', weekId).set({
            weekId,
            schoolId,
            weekStart: Timestamp.fromDate(weekStart),
            weekEnd: Timestamp.fromDate(now),
            summary,
            stats: {
              newAchievements,
              totalSubmissions,
              onTimeSubmissions,
              onTimeRate,
            },
            generatedAt: FieldValue.serverTimestamp(),
          });

          // 推播通知
          const tokens = await getUserPushTokens(uid);
          if (tokens.length > 0) {
            await messaging
              .sendEachForMulticast({
                tokens,
                notification: {
                  title: '📊 本週學習報告出爐了！',
                  body: summary,
                },
                data: { type: 'weekly_report', weekId },
              })
              .catch(() => {});
          }
        }),
      );

      console.log(`[generateWeeklyReport] Completed for week ${weekId}`);
    } catch (error) {
      console.error('[generateWeeklyReport] Error:', error);
    }
  },
);

console.log('Firebase Cloud Functions loaded successfully');
