'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { syncConfiguredSchools } = require('./sync');

async function runCampusAnnouncementSync(deps = {}) {
  const db = deps.db || getFirestore();
  return syncConfiguredSchools({ ...deps, db });
}

const syncCampusAnnouncements = onSchedule(
  {
    schedule: 'every 20 minutes',
    region: 'asia-east1',
    timeZone: 'Asia/Taipei',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => runCampusAnnouncementSync(),
);

module.exports = {
  runCampusAnnouncementSync,
  syncCampusAnnouncements,
};
