'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { createAuthzHelpers } = require('../../authz');
const { fetchAssistantUserProfile } = require('../../lib/assistantFetchers');
const { runTool } = require('../tools/registry');

const REGION = 'asia-east1';

const ALLOWED_TOOLS = new Set(['submitLeaveRequest']);

const db = getFirestore();
const { assertActiveSchoolMember } = createAuthzHelpers(db);

module.exports = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const toolName = String(request.data?.toolName || '').trim();
    if (!ALLOWED_TOOLS.has(toolName)) {
      throw new HttpsError('invalid-argument', 'Unsupported tool');
    }

    const userProfile = await fetchAssistantUserProfile(uid);
    const schoolId = userProfile?.schoolId ?? null;
    if (!schoolId) {
      throw new HttpsError('failed-precondition', 'Missing school membership');
    }

    await assertActiveSchoolMember(schoolId, uid);

    const reqCtx = request.data?.context && typeof request.data.context === 'object' ? request.data.context : {};
    const toolCtx = {
      uid,
      schoolId,
      groupId: reqCtx.groupId,
      timeZone: reqCtx.timezone || reqCtx.timeZone || 'Asia/Taipei',
      prefetched: {},
    };

    const rawInput = request.data?.input && typeof request.data.input === 'object' ? request.data.input : {};

    try {
      const result = await runTool(toolName, toolCtx, rawInput);
      return { success: true, toolName, ...result };
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 400);
      throw new HttpsError('invalid-argument', msg || 'Tool execution failed');
    }
  },
);
