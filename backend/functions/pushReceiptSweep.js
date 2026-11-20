'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { createNotificationService } = require('./lib/notificationService');

exports.scheduledPushReceiptSweep = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'asia-east1',
    timeZone: 'Asia/Taipei',
  },
  async () => createNotificationService({ db: getFirestore() }).processPendingReceipts(),
);
