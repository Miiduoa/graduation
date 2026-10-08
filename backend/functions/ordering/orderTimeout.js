'use strict';

/**
 * Scheduled Functions: 訂單超時處理 + 閃購到期清理
 *
 * scheduledOrderTimeoutSweep — 每 5 分鐘跑一次
 *   - pending 超過 10 分鐘 → 自動取消 + push 通知
 *   - preparing 超過 30 分鐘 → push 通知學生 + 警示店家
 *   - ready 超過 20 分鐘 → 標記 NoShow
 *
 * scheduledFlashDealExpiry — 每 10 分鐘跑一次
 *   - 把過期的 flash deals 標記 inactive
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const REGION = 'asia-east1';

const { createOrderTimeoutSweep } = require('./orderTimeoutOperations');
const { createNotificationService } = require('../lib/notificationService');

module.exports.scheduledOrderTimeoutSweep = onSchedule(
  { schedule: 'every 5 minutes', region: REGION, timeZone: 'Asia/Taipei' },
  async () => {
    const db = getFirestore();
    const { sendPushToUser } = createNotificationService({ db, messaging: getMessaging() });
    await createOrderTimeoutSweep({ db, sendPushToUser })();
    return null;
  },
);

module.exports.scheduledFlashDealExpiry = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    let total = 0;

    const schoolsSnap = await db.collection('schools').get();
    for (const schoolDoc of schoolsSnap.docs) {
      const dealsRef = schoolDoc.ref.collection('flashDeals');
      const expired = await dealsRef
        .where('expiresAt', '<=', now)
        .where('active', '==', true)
        .limit(200)
        .get();
      if (expired.empty) continue;
      const batch = db.batch();
      expired.docs.forEach((d) => batch.update(d.ref, { active: false }));
      await batch.commit();
      total += expired.size;
    }
    console.info(`[scheduledFlashDealExpiry] expired ${total} deals`);
    return null;
  },
);
