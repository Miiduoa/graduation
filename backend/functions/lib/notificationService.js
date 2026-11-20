'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push';
const EXPO_TOKEN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const INVALID_FCM = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
const PREFERENCES = Object.freeze({
  enabled: true,
  announcements: true,
  events: true,
  groups: true,
  assignments: true,
  grades: true,
  messages: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
});

function defaultNotificationPreferences() {
  return { ...PREFERENCES };
}
function parseHHMM(value) {
  const match = typeof value === 'string' && value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function isInQuietHours(prefs, date, timeZone) {
  if (!prefs?.quietHoursEnabled) return false;
  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  const value = date instanceof Date ? date : new Date(date);
  if (start == null || end == null || Number.isNaN(value.getTime()) || start === end) return false;
  let minutes = value.getHours() * 60 + value.getMinutes();
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    minutes =
      Number(parts.find((part) => part.type === 'hour').value) * 60 +
      Number(parts.find((part) => part.type === 'minute').value);
  }
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
function assertUid(uid) {
  if (typeof uid !== 'string' || !uid.trim() || uid.includes('/'))
    throw new Error('Invalid notification recipient');
}
function normalizePreferences(raw) {
  const result = defaultNotificationPreferences();
  for (const key of Object.keys(result)) {
    if (raw[key] === undefined) continue;
    if (
      typeof result[key] === 'boolean' ? typeof raw[key] !== 'boolean' : parseHHMM(raw[key]) == null
    ) {
      throw new Error('Invalid notification preferences');
    }
    result[key] = raw[key];
  }
  return result;
}

function createNotificationService({
  db,
  admin,
  messaging,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
  expoAccessToken = process.env.EXPO_ACCESS_TOKEN,
  logger = console,
} = {}) {
  const database = () => {
    const value = db || admin?.firestore();
    if (!value) throw new Error('Notification database unavailable');
    return value;
  };
  const user = (uid) => {
    assertUid(uid);
    return database().collection('users').doc(uid);
  };
  const preferenceRef = (uid) => user(uid).collection('settings').doc('notifications');
  async function getPreferences(uid) {
    const doc = await preferenceRef(uid).get();
    return normalizePreferences(doc.exists ? doc.data() : {});
  }
  async function tokenRows(uid) {
    const snapshot = await user(uid).collection('pushTokens').get();
    const rows = [];
    const seen = new Set();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (
        typeof data.token !== 'string' ||
        !data.token ||
        data.token.length > 4096 ||
        seen.has(data.token)
      )
        continue;
      const expo = EXPO_TOKEN.test(data.token);
      // An explicitly typed malformed Expo token must never reach FCM.
      if ((data.type === 'expo' || /^(?:Exponent|Expo)PushToken/.test(data.token)) && !expo)
        continue;
      seen.add(data.token);
      rows.push({
        token: data.token,
        type: expo ? 'expo' : 'fcm',
        ref: doc.ref,
        updateTime: doc.updateTime,
      });
    }
    return rows;
  }
  async function removeInvalidToken(row) {
    // A registration may have refreshed the same document while the provider request ran.
    await database().runTransaction(async (tx) => {
      const current = await tx.get(row.ref);
      if (
        current.exists &&
        current.data().token === row.token &&
        (!row.updateTime || current.updateTime?.isEqual(row.updateTime))
      )
        tx.delete(row.ref);
    });
  }
  async function expoRequest(path, payload) {
    const response = await fetchImpl(`${EXPO_ENDPOINT}/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Push provider request failed (${response.status})`);
    return response.json();
  }
  async function sendPushToUser(uid, notification, data = {}, category) {
    assertUid(uid);
    if (typeof notification?.title !== 'string' || typeof notification?.body !== 'string') {
      throw new Error('Notification title and body are required');
    }
    const normalizedData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value == null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value))
        throw new Error('Invalid notification data');
      normalizedData[key] = String(value);
    }
    if (Buffer.byteLength(JSON.stringify({ notification, data: normalizedData })) > 3500) {
      throw new Error('Notification payload is too large');
    }
    const profile = await user(uid).get();
    if (!profile.exists || profile.data().notificationDeliveryDisabled === true) {
      return { status: 'skipped', accepted: 0, failed: 0, reason: 'account_unavailable' };
    }
    const prefs = await getPreferences(uid);
    const preferenceCategory = category || normalizedData.channel;
    let reason = !prefs.enabled ? 'disabled' : null;
    if (!reason && preferenceCategory && prefs[preferenceCategory] === false)
      reason = 'category_disabled';
    if (!reason && isInQuietHours(prefs, now(), 'Asia/Taipei')) reason = 'quiet_hours';
    if (reason) return { status: 'skipped', accepted: 0, failed: 0, reason };
    const rows = await tokenRows(uid);
    if (!rows.length) return { status: 'skipped', accepted: 0, failed: 0, reason: 'no_tokens' };
    let accepted = 0;
    let failed = 0;
    let receiptTrackingFailed = 0;
    const warnings = [];
    for (const type of ['expo', 'fcm']) {
      const selected = rows.filter((row) => row.type === type);
      const size = type === 'expo' ? 100 : 500;
      for (let offset = 0; offset < selected.length; offset += size) {
        const batch = selected.slice(offset, offset + size);
        let results;
        try {
          if (type === 'expo') {
            const response = await expoRequest(
              'send',
              batch.map((row) => ({
                to: row.token,
                title: notification.title,
                body: notification.body,
                data: normalizedData,
                sound: 'default',
                ...(normalizedData.channel ? { channelId: normalizedData.channel } : {}),
              })),
            );
            if (!Array.isArray(response.data) || response.data.length !== batch.length)
              throw new Error('Invalid push tickets');
            results = response.data.map((ticket) => ({
              success:
                ticket.status === 'ok' &&
                typeof ticket.id === 'string' &&
                /^[A-Za-z0-9_-]{1,200}$/.test(ticket.id),
              receiptId: ticket.id,
              invalidToken: ticket.details?.error === 'DeviceNotRegistered',
            }));
          } else {
            if (!messaging?.sendEachForMulticast) throw new Error('FCM service unavailable');
            const response = await messaging.sendEachForMulticast({
              tokens: batch.map((row) => row.token),
              notification,
              data: normalizedData,
              ...(normalizedData.channel
                ? { android: { notification: { channelId: normalizedData.channel } } }
                : {}),
            });
            if (!Array.isArray(response.responses) || response.responses.length !== batch.length)
              throw new Error('Invalid FCM response');
            results = response.responses.map((item) => ({
              success: item.success === true,
              invalidToken: INVALID_FCM.has(item.error?.code),
            }));
          }
        } catch {
          failed += batch.length;
          warnings.push(`${type}_request_failed`);
          continue;
        }
        for (let i = 0; i < results.length; i += 1) {
          const result = results[i];
          const row = batch[i];
          if (result.success) {
            accepted += 1;
            if (type === 'expo') {
              try {
                await database().runTransaction(async (tx) => {
                  const currentUser = await tx.get(user(uid));
                  if (
                    !currentUser.exists ||
                    currentUser.data().notificationDeliveryDisabled === true
                  )
                    return;
                  tx.set(database().collection('pendingPushReceipts').doc(result.receiptId), {
                    uid,
                    token: row.token,
                    tokenPath: row.ref.path,
                    tokenUpdatedAt: row.updateTime || null,
                    createdAt: FieldValue.serverTimestamp(),
                    nextCheckAt: new Date(now().getTime() + 15 * 60000),
                  });
                });
              } catch {
                receiptTrackingFailed += 1;
                logger.warn('[notifications] Could not persist accepted push receipt');
              }
            }
          } else {
            failed += 1;
            if (result.invalidToken) {
              try {
                await removeInvalidToken(row);
              } catch {
                warnings.push('token_cleanup_failed');
              }
            }
          }
        }
      }
    }
    return {
      status: accepted ? (failed ? 'partial' : 'accepted') : 'failed',
      accepted,
      failed,
      ...(receiptTrackingFailed ? { receiptTrackingFailed } : {}),
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
    };
  }
  async function sendPushToMultipleUsers(uids, notification, data, category) {
    if (!Array.isArray(uids) || uids.length > 1000)
      throw new Error('Invalid notification recipients');
    const results = [];
    // Bound provider concurrency and preserve each recipient's preference decision.
    for (const uid of [...new Set(uids)]) {
      try {
        results.push({ uid, ...(await sendPushToUser(uid, notification, data, category)) });
      } catch {
        results.push({
          uid,
          status: 'failed',
          accepted: 0,
          failed: 0,
          reason: 'recipient_unavailable',
        });
      }
    }
    return results;
  }
  async function processPendingReceipts() {
    const snapshot = await database()
      .collection('pendingPushReceipts')
      .where('nextCheckAt', '<=', now())
      .orderBy('nextCheckAt', 'asc')
      .limit(100)
      .get();
    if (snapshot.empty) return { checked: 0, confirmed: 0, failed: 0, pending: 0 };
    const response = await expoRequest('getReceipts', { ids: snapshot.docs.map((doc) => doc.id) });
    if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data))
      throw new Error('Invalid push receipts');
    const stats = { checked: snapshot.docs.length, confirmed: 0, failed: 0, pending: 0 };
    for (const doc of snapshot.docs) {
      const record = doc.data();
      const receipt = response.data[doc.id];
      const createdAt = record.createdAt?.toDate?.();
      const expired =
        createdAt instanceof Date && now().getTime() - createdAt.getTime() >= 24 * 60 * 60000;
      if ((!receipt || !['ok', 'error'].includes(receipt.status)) && !expired) {
        const postponed = await database().runTransaction(async (tx) => {
          const pending = await tx.get(doc.ref);
          if (!pending.exists || (doc.updateTime && !pending.updateTime?.isEqual(doc.updateTime)))
            return false;
          tx.update(doc.ref, { nextCheckAt: new Date(now().getTime() + 15 * 60000) });
          return true;
        });
        if (postponed) stats.pending += 1;
        continue;
      }
      const validReceipt = receipt && ['ok', 'error'].includes(receipt.status);
      const status = !validReceipt
        ? 'receipt_expired'
        : receipt.status === 'ok'
          ? 'provider_confirmed'
          : 'provider_rejected';
      const code =
        typeof receipt?.details?.error === 'string' &&
        /^[A-Za-z]{1,80}$/.test(receipt.details.error)
          ? receipt.details.error
          : null;
      const committed = await database().runTransaction(async (tx) => {
        const [pending, profile] = await Promise.all([tx.get(doc.ref), tx.get(user(record.uid))]);
        if (!pending.exists || (doc.updateTime && !pending.updateTime?.isEqual(doc.updateTime)))
          return false;
        let tokenRef;
        let currentToken;
        if (
          code === 'DeviceNotRegistered' &&
          typeof record.tokenPath === 'string' &&
          record.tokenPath.startsWith(`users/${record.uid}/pushTokens/`) &&
          record.tokenPath.split('/').length === 4
        ) {
          tokenRef = database().doc(record.tokenPath);
          currentToken = await tx.get(tokenRef);
        }
        if (
          currentToken?.exists &&
          currentToken.data().token === record.token &&
          (!record.tokenUpdatedAt || currentToken.updateTime?.isEqual(record.tokenUpdatedAt))
        )
          tx.delete(tokenRef);
        if (profile.exists && profile.data().notificationDeliveryDisabled !== true) {
          tx.set(database().collection('pushReceiptResults').doc(doc.id), {
            uid: record.uid,
            status,
            code,
            checkedAt: FieldValue.serverTimestamp(),
          });
        }
        tx.delete(doc.ref);
        return true;
      });
      if (committed) {
        if (status === 'provider_confirmed') stats.confirmed += 1;
        else stats.failed += 1;
      }
    }
    return stats;
  }
  return {
    defaultPreferences: defaultNotificationPreferences,
    isInQuietHours,
    getPreferences,
    async setPreferences(uid, prefs) {
      const normalized = normalizePreferences(prefs);
      await preferenceRef(uid).set(normalized, { merge: true });
      return { uid, prefs: normalized, written: true };
    },
    async getUserPushTokens(uid) {
      return (await tokenRows(uid)).map((row) => row.token);
    },
    sendPushToUser,
    sendPushToMultipleUsers,
    processPendingReceipts,
  };
}

module.exports = { defaultNotificationPreferences, isInQuietHours, createNotificationService };
