'use strict';

const { onCall } = require('firebase-functions/v2/https');
const { runCampusAssistantWithAgentRuntime } = require('../runtime');

const REGION = 'asia-east1';

module.exports = onCall(
  {
    region: REGION,
  },
  async (request) => runCampusAssistantWithAgentRuntime(request),
);
