'use strict';

// Keep existing deployments stable while new handlers live in small, testable modules.
const existing = require('./index');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { createVerifyAttendanceClaim } = require('./attendance/verifyClaim');

module.exports = {
  ...existing,
  verifyAttendanceClaim: onCall(
    { region: 'asia-east1' },
    createVerifyAttendanceClaim({ db: getFirestore(), FieldValue, Timestamp, HttpsError }),
  ),
};
