'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { syncConfiguredSchools } = require('./sync');

function isCampusAnnouncementSyncEnabled(env = process.env) {
  return String(env.CAMPUS_ANNOUNCEMENT_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

function isCampusAnnouncementSyncDryRun(env = process.env) {
  return String(env.CAMPUS_ANNOUNCEMENT_SYNC_DRY_RUN || '').trim().toLowerCase() === 'true';
}

async function runCampusAnnouncementSync(deps = {}) {
  const env = deps.env || process.env;
  if (!isCampusAnnouncementSyncEnabled(env)) {
    return { skipped: true, reason: 'disabled' };
  }
  const dryRun = deps.dryRun === true || isCampusAnnouncementSyncDryRun(env);
  const db = dryRun ? undefined : deps.db || getFirestore();
  return syncConfiguredSchools({ ...deps, db, dryRun });
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
  isCampusAnnouncementSyncEnabled,
  isCampusAnnouncementSyncDryRun,
  runCampusAnnouncementSync,
  syncCampusAnnouncements,
};
