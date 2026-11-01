'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const { assertToolInputBounds } = require('../inputLimits');
const { createSemanticConsentTask, validateSemanticConsent } = require('../semanticConsentTask');
const runTask = createSemanticConsentTask();

const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});

module.exports = onCall(
  {
    region: 'asia-east1',
    timeoutSeconds: 30,
    memory: '256MiB',
    preflight(request) {
      if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
      assertToolInputBounds(request.data);
      validateSemanticConsent(request.data);
    },
  },
  async (request) => runTask(request.auth.uid, request.data),
);
