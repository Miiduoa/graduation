'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { runCampusAssistantWithAgentRuntime } = require('../runtime');
const { assertToolInputBounds } = require('../inputLimits');

const REGION = 'asia-east1';

module.exports = onCall(
  {
    region: REGION,
    timeoutSeconds: 300,
    memory: '1GiB',
    preflight(request) {
      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Must be logged in');
      }
      assertToolInputBounds(request.data);
    },
  },
  async (request) => runCampusAssistantWithAgentRuntime(request),
);
