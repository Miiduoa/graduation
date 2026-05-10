'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createRequestId } = require('../assistantAgent');
const { enforceRateLimit, getClientIp, isProductionRuntime } = require('../securityUtils');
const {
  fetchAssistantTodaySchedule,
  fetchAssistantPendingAssignments,
  fetchAssistantAnnouncements,
  fetchAssistantUserProfile,
  fetchAssistantDailyBrief,
} = require('../lib/assistantFetchers');
const { getLastUserMessage } = require('../lib/assistantFormat');
const { writeReviewAiSuggestionQueueItem } = require('../lib/assistantQueue');
const { classifyIntent } = require('./classifyIntent');
const { evaluateAnswer } = require('./evaluateAnswer');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const { runTool } = require('./tools/registry');
const { getIntentWritePlan } = require('./intentWritePlan');

async function runCampusAssistantWithAgentRuntime(request) {
  const runId = createRequestId();
  const startedAt = Date.now();
  const uid = request.auth?.uid ?? null;
  const rateLimitKey = uid || getClientIp(request.rawRequest || {});
  enforceRateLimit({
    scope: 'ask-campus-assistant',
    key: rateLimitKey,
    limit: 40,
    windowMs: 5 * 60 * 1000,
  });

  const rawMessages = Array.isArray(request.data?.messages) ? request.data.messages : [];
  const context =
    request.data?.context && typeof request.data.context === 'object' ? { ...request.data.context } : {};
  let sessionId = context.sessionId != null && String(context.sessionId).trim() ? String(context.sessionId).trim() : null;
  if (uid && !sessionId) {
    sessionId = createRequestId();
    context.sessionId = sessionId;
  }
  const timeZone = context.timezone || 'Asia/Taipei';
  const lastUserMessage = getLastUserMessage(rawMessages);
  const intentMeta = classifyIntent(lastUserMessage);

  const db = getFirestore();
  const steps = [];

  async function recordStep(tool, input, output, durationMs) {
    steps.push({
      tool,
      input: input && typeof input === 'object' ? input : { value: input },
      output: sanitizeStepOutput(output),
      durationMs,
      at: Date.now(),
    });
  }

  function sanitizeStepOutput(out) {
    if (out == null) return {};
    if (typeof out !== 'object') return { value: out };
    try {
      return JSON.parse(JSON.stringify(out).slice(0, 12000));
    } catch {
      return { _truncated: true };
    }
  }

  const userProfile = uid ? await fetchAssistantUserProfile(uid) : null;
  const schoolId = userProfile?.schoolId ?? context.schoolId ?? null;

  if (uid && schoolId) {
    await db
      .collection('users')
      .doc(uid)
      .collection('agentRuns')
      .doc(runId)
      .set({
        runId,
        userId: uid,
        schoolId,
        status: 'running',
        intent: intentMeta.name,
        steps: [],
        toolCalls: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      .catch((e) => console.warn('[agentRuns] init failed:', e?.message || e));
  }

  let prefetched = {};
  if (uid && schoolId) {
    const toolCtx = {
      uid,
      schoolId,
      groupId: context.groupId,
      timeZone,
      prefetched: {},
    };
    try {
      const t0 = Date.now();
      const todaySchedule = await runTool('getTodaySchedule', toolCtx, {});
      await recordStep('getTodaySchedule', {}, todaySchedule, Date.now() - t0);

      const t1 = Date.now();
      const assignments = await runTool('getAssignments', toolCtx, {
        preferredGroupId: context.groupId,
      });
      await recordStep('getAssignments', { groupId: context.groupId }, { count: assignments.length }, Date.now() - t1);

      const t2 = Date.now();
      const announcements = await runTool('getAnnouncements', toolCtx, { schoolId });
      await recordStep('getAnnouncements', { schoolId }, { count: announcements.length }, Date.now() - t2);

      const t3 = Date.now();
      const prioritySummary = await runTool('getPrioritySummary', { ...toolCtx, prefetched: { todaySchedule, assignments, announcements } }, {});
      await recordStep('getPrioritySummary', {}, prioritySummary, Date.now() - t3);

      const t4 = Date.now();
      const dailyBrief = await fetchAssistantDailyBrief(uid);
      await recordStep('fetchAssistantDailyBrief', {}, { hasBrief: Boolean(dailyBrief?.summary) }, Date.now() - t4);

      prefetched = { todaySchedule, assignments, announcements, dailyBrief, prioritySummary };
    } catch (e) {
      await recordStep('prefetch_error', {}, { error: String(e?.message || e) }, 0);
    }

    const writePlan = getIntentWritePlan(intentMeta.name);
    if (writePlan) {
      const tw0 = Date.now();
      if (writePlan.requiresConfirmation) {
        await recordStep(
          'intent_write_deferred',
          { intent: intentMeta.name, tool: writePlan.toolName },
          { reason: 'requires_confirmation' },
          Date.now() - tw0,
        );
      } else {
        try {
          const buildInput =
            typeof writePlan.buildInput === 'function' ? writePlan.buildInput : null;
          const toolInput = buildInput
            ? buildInput({ lastUserMessage, context, prefetched })
            : null;
          if (!toolInput || typeof toolInput !== 'object') {
            await recordStep(
              'intent_write_skipped',
              { intent: intentMeta.name, tool: writePlan.toolName },
              { reason: 'missing_or_invalid_input' },
              Date.now() - tw0,
            );
          } else {
            const writeCtx = {
              uid,
              schoolId,
              groupId: context.groupId,
              timeZone,
              prefetched,
            };
            const writeResult = await runTool(writePlan.toolName, writeCtx, toolInput);
            prefetched = {
              ...prefetched,
              autoWriteResults: {
                ...(prefetched.autoWriteResults && typeof prefetched.autoWriteResults === 'object'
                  ? prefetched.autoWriteResults
                  : {}),
                [writePlan.toolName]: writeResult,
              },
            };
            await recordStep(writePlan.toolName, toolInput, writeResult, Date.now() - tw0);
          }
        } catch (e) {
          await recordStep(
            'intent_write_error',
            { intent: intentMeta.name, tool: writePlan.toolName },
            { error: String(e?.message || e) },
            Date.now() - tw0,
          );
        }
      }
    }
  }

  const requestForCore = {
    ...request,
    data: {
      ...request.data,
      context,
    },
  };

  let coreResult;
  try {
    coreResult = await executeCampusAssistantCore({
      request: requestForCore,
      runId,
      startedAt,
      prefetched,
      recordStep,
      routingIntent: intentMeta.name,
    });
  } catch (err) {
    if (uid && schoolId) {
      await db
        .collection('users')
        .doc(uid)
        .collection('agentRuns')
        .doc(runId)
        .set(
          {
            status: 'failed',
            steps,
            toolCalls: steps,
            errorCode: 'runtime_error',
            errorMessage: String(err?.message || err).slice(0, 500),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => null);
    }
    throw err;
  }

  const { modelTrace, intent, ...responseRest } = coreResult;
  const response = { ...responseRest };
  delete response.modelTrace;

  const evaluation = await evaluateAnswer({
    userQuestion: lastUserMessage,
    answerText: response.content,
    intentConfidence: intentMeta.confidence,
  });

  let actionQueueId = null;
  let clarifyingQuestion = null;
  if (intentMeta.confidence < 0.62 && lastUserMessage) {
    clarifyingQuestion = '你想查的是公告、作業截止，還是今天的課程與課表呢？也可以換個說法再問一次。';
  }

  if (evaluation.needsUserReview && evaluation.score < 0.68 && uid && schoolId) {
    const { resolveAssistantActorRole } = require('../lib/assistantActions');
    const { resolvePermissionScope: resolveAgentPermissionScope } = require('../assistantAgent');
    const actorRole = resolveAssistantActorRole(userProfile?.role ?? request.auth?.token?.role);
    const permissionScope = resolveAgentPermissionScope(intent, Boolean(uid));
    actionQueueId = await writeReviewAiSuggestionQueueItem({
      uid,
      schoolId,
      runId,
      label: '確認 AI 建議',
      reason: evaluation.reason || '系統判定此回覆需要你再確認一次。',
      actorRole,
      permissionScope,
      urgency: evaluation.score < 0.5 ? 'high' : 'medium',
    }).catch((e) => {
      console.warn('[AI] review queue failed:', e?.message || e);
      return null;
    });
  }

  const envelope = {
    schemaVersion: 1,
    content: response.content,
    suggestions: response.suggestions,
    actions: response.actions,
    citations: response.citations,
    assistantToolsUsed: Array.isArray(response.assistantToolsUsed) ? response.assistantToolsUsed : [],
    error: response.error,
    usage: response.usage,
    debug: response.debug,
    run: { runId, status: 'completed' },
    intent: {
      name: intentMeta.name,
      confidence: intentMeta.confidence,
      source: intentMeta.source,
      ...(intentMeta.category && { category: intentMeta.category, subIntent: intentMeta.subIntent }),
    },
    evaluation: {
      score: evaluation.score,
      needsUserReview: evaluation.needsUserReview,
      reason: evaluation.reason,
    },
    clarifyingQuestion,
  };

  if (isProductionRuntime() && envelope.debug && typeof envelope.debug === 'object') {
    envelope.debug = {
      intent: envelope.debug.intent,
      route: envelope.debug.route,
      requestId: envelope.debug.requestId,
      sourcesUsed: envelope.debug.sourcesUsed,
      ...(envelope.debug.sessionId && { sessionId: envelope.debug.sessionId }),
    };
  }

  if (uid && schoolId) {
    await db
      .collection('users')
      .doc(uid)
      .collection('agentRuns')
      .doc(runId)
      .set(
        {
          runId,
          userId: uid,
          schoolId,
          status: 'completed',
          intent,
          steps,
          toolCalls: steps,
          finalAnswer: response.content,
          evaluationScore: evaluation.score,
          evaluationReason: evaluation.reason,
          actionQueueId,
          modelProvider: modelTrace?.provider,
          model: modelTrace?.model,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch((e) => console.warn('[agentRuns] finalize failed:', e?.message || e));
  }

  return envelope;
}

module.exports = { runCampusAssistantWithAgentRuntime };
