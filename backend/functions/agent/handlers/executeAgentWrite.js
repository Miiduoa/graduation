'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createAuthzHelpers } = require('../../authz');
const { fetchAssistantUserProfile } = require('../../lib/assistantFetchers');
const { runTool, byName } = require('../tools/registry');

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
    const agentRunId =
      request.data?.agentRunId != null && String(request.data.agentRunId).trim()
        ? String(request.data.agentRunId).trim()
        : '';

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
        return errPayload;
      }
      const rest = result && typeof result === 'object' ? { ...result } : {};
      if ('success' in rest && rest.success !== true) delete rest.success;
      const okPayload = { success: true, toolName, ...rest };
      await appendAgentRunToolStep(uid, agentRunId, toolName, rawInput, okPayload, durationMs);
      return okPayload;
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 400);
      await appendAgentRunToolStep(
        uid,
        agentRunId,
        toolName,
        rawInput,
        { success: false, error: msg },
        Date.now() - t0,
      );
      throw new HttpsError('invalid-argument', msg || 'Tool execution failed');
    }
  },
);
