'use strict';

const { onCall } = require('firebase-functions/v2/https');
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
