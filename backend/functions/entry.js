'use strict';

// Keep existing exports stable while attendance is extracted from the monolithic
// application. Firebase loads this file through package.json's main field.
const application = require('./index');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { createNotificationService } = require('./lib/notificationService');
const { createLiveAttendanceHandlers } = require('./lib/liveAttendance');
const db = getFirestore(); // The existing application initializes the Admin app.
const messaging = getMessaging();
const { getUserPushTokens } = createNotificationService({ db, messaging });
const handlers = createLiveAttendanceHandlers({
  db, FieldValue, Timestamp, HttpsError,
  warn: (message) => console.warn(message),
  notifySessionStarted: async ({ groupId, sessionId, teacherId }) => {
    const group = db.collection('groups').doc(groupId);
    const members = await group.collection('members').where('status', '==', 'active').get();
    const uids = members.docs.filter((member) => member.id !== teacherId && member.data().role === 'member').map((member) => member.id);
    const tokens = [...new Set((await Promise.all(uids.map(getUserPushTokens))).flat().filter((token) => typeof token === 'string' && token.length > 0))];
    for (let offset = 0; offset < tokens.length; offset += 500) {
      await messaging.sendEachForMulticast({ tokens: tokens.slice(offset, offset + 500),
        notification: { title: '課堂點名已開啟', body: '請進入課程教室，使用老師提供的 QR 簽到。' },
        data: { type: 'live_session', groupId, sessionId, click_action: 'OPEN_CLASSROOM' } });
    }
  },
});
module.exports = {
  ...application,
  startLiveSession: onCall({ region: 'asia-east1' }, handlers.startLiveSession),
  endLiveSession: onCall({ region: 'asia-east1' }, handlers.endLiveSession),
  joinLiveSession: onCall({ region: 'asia-east1' }, handlers.joinLiveSession),
  verifyAttendanceClaim: onCall({ region: 'asia-east1' }, handlers.verifyAttendanceClaim),
};
