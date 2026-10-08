'use strict';

const { onCall: firebaseOnCall } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { runCampusAssistantWithAgentRuntime } = require('../runtime');

const REGION = 'asia-east1';

module.exports = onCall(
  {
    region: REGION,
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  async (request) => runCampusAssistantWithAgentRuntime(request),
);
