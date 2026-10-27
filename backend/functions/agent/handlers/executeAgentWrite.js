'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createAuthzHelpers } = require('../../authz');
const { fetchAssistantUserProfile } = require('../../lib/assistantFetchers');
const { runTool, byName } = require('../tools/registry');
const { assertToolInputBounds } = require('../inputLimits');
const { assertOnlineOrderingEnabled } = require('../../lib/onlineOrdering');
const { matchAgentProposal } = require('../actionProposal');
const { confirmedAgentWrite } = require('../actionReceipt');

const REGION = 'asia-east1';

const ALLOWED_TOOLS = new Set(
  [...byName.values()].filter((t) => t.requiresConfirmation === true).map((t) => t.name),
);

const db = getFirestore();
const { assertActiveSchoolMember } = createAuthzHelpers(db);

function sanitizeStepPayload(value, maxChars = 12000) {
  if (value == null) return {};
  if (typeof value !== 'object') return { value: String(value).slice(0, maxChars) };
  try {
    return JSON.parse(JSON.stringify(value).slice(0, maxChars));
  } catch {
    return { _truncated: true };
  }
}

async function appendAgentRunToolStep(uid, agentRunId, toolName, rawInput, output, durationMs) {
  const rid = String(agentRunId || '').trim();
  if (!rid || !uid) return;
  const ref = db.collection('users').doc(uid).collection('agentRuns').doc(rid);
  await db
    .runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const prev = snap.data() || {};
      const steps = Array.isArray(prev.steps) ? [...prev.steps] : [];
      steps.push({
        tool: toolName,
        input: sanitizeStepPayload(rawInput),
        output: sanitizeStepPayload(output),
        durationMs: typeof durationMs === 'number' ? durationMs : 0,
        at: Date.now(),
        phase: 'executeAgentWrite',
      });
      tx.set(
        ref,
        {
          steps,
          toolCalls: steps,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    })
    .catch((e) => console.warn('[executeAgentWrite] agentRuns append failed:', e?.message || e));
}

module.exports = onCall(
  {
    region: REGION,
    preflight(request) {
      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Must be logged in');
      }
      assertToolInputBounds(request.data?.input);
    },
  },
  async (request) => {
    const uid = request.auth?.uid;

    const toolName = String(request.data?.toolName || '').trim();
    if (!ALLOWED_TOOLS.has(toolName)) {
      throw new HttpsError('invalid-argument', 'Unsupported tool');
    }
    if (toolName === 'createOrder') assertOnlineOrderingEnabled();

    const reqCtx =
      request.data?.context && typeof request.data.context === 'object' ? request.data.context : {};
    const userProfile = await fetchAssistantUserProfile(uid);
    const requestedSchool = reqCtx.schoolId;
    if (requestedSchool !== undefined &&
      (typeof requestedSchool !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(requestedSchool))) {
      throw new HttpsError('invalid-argument', 'Invalid school');
    }
    const schoolId = requestedSchool || userProfile?.schoolId || null;
    if (!schoolId) throw new HttpsError('failed-precondition', 'Missing school membership');
    await assertActiveSchoolMember(schoolId, uid);

    const toolCtx = {
      uid,
      schoolId,
      timeZone: reqCtx.timezone || reqCtx.timeZone || 'Asia/Taipei',
      prefetched: {},
    };

    const rawInput =
      request.data?.input && typeof request.data.input === 'object' ? request.data.input : {};
    const agentRunId = String(request.data?.agentRunId || '').trim();
    if (!/^[a-f0-9-]{32,36}$/i.test(agentRunId)) {
      throw new HttpsError('failed-precondition', 'Please prepare the action in the assistant again');
    }
    const runRef = db.collection('users').doc(uid).collection('agentRuns').doc(agentRunId);
    let proposalIndex = -1;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      const index = matchAgentProposal(snap.exists ? snap.data() : null, {
        uid, schoolId, toolName, input: rawInput,
      });
      if (index < 0) {
        throw new HttpsError('permission-denied', 'Action is not part of a current assistant proposal');
      }
      if (snap.data()?.actionClaims?.[String(index)]) {
        throw new HttpsError('already-exists', 'Action already attempted; check the service record');
      }
      tx.set(runRef, {
        actionClaims: {
          [String(index)]: { status: 'started', startedAt: FieldValue.serverTimestamp() },
        },
      }, { merge: true });
      proposalIndex = index;
    });
    // 動作識別由已驗證的伺服器草稿決定，不能由客戶端指定群組或防重鍵。
    toolCtx.agentActionKey = `${agentRunId}:${proposalIndex}`;
    const finishClaim = async (status) => {
      await runRef.set({
        actionClaims: {
          [String(proposalIndex)]: {
            status,
            updatedAt: FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true }).catch((error) => {
        console.warn('[executeAgentWrite] claim update failed:', error?.message || error);
      });
    };

    const t0 = Date.now();
    try {
      const result = await runTool(toolName, toolCtx, rawInput);
      const durationMs = Date.now() - t0;
      if (result && typeof result === 'object' && result.success === false) {
        const errPayload = {
          success: false,
          toolName,
          errorCode: String(result.errorCode || 'tool_failed').slice(0, 80),
          errorMessage: String(result.errorMessage || '').slice(0, 400),
        };
        await appendAgentRunToolStep(uid, agentRunId, toolName, rawInput, errPayload, durationMs);
        await finishClaim('failed');
        return errPayload;
      }
      if (!confirmedAgentWrite(toolName, result, rawInput, { uid, schoolId })) {
        const unverified = {
          success: false,
          toolName,
          errorCode: 'unverified_receipt',
          errorMessage: 'Unable to confirm the operation. Check the service record before retrying.',
        };
        await appendAgentRunToolStep(uid, agentRunId, toolName, { keys: Object.keys(rawInput).slice(0, 16) }, unverified, durationMs);
        await finishClaim('unverified');
        return unverified;
      }
      const okPayload = { ...result, toolName, success: true };
      await appendAgentRunToolStep(uid, agentRunId, toolName, rawInput, okPayload, durationMs);
      await finishClaim('completed');
      return okPayload;
    } catch (e) {
      await finishClaim('unverified');
      const msg = String(e?.message || e).slice(0, 400);
      await appendAgentRunToolStep(
        uid,
        agentRunId,
        toolName,
        rawInput,
        { success: false, error: msg },
        Date.now() - t0,
      );
      // Preserve typed bounds / auth errors (e.g. resource-exhausted from inputLimits).
      if (e instanceof HttpsError) {
        throw e;
      }
      throw new HttpsError('invalid-argument', msg || 'Tool execution failed');
    }
  },
);
