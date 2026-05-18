'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { createRequestId } = require('../assistantAgent');
const { enforceRateLimit, getClientIp, isProductionRuntime } = require('../securityUtils');
const {
  fetchAssistantUserProfile,
  fetchAssistantDailyBrief,
} = require('../lib/assistantFetchers');
const { getLastUserMessage, isDormRepairStatusQueryMessage } = require('../lib/assistantFormat');
const { writeReviewAiSuggestionQueueItem } = require('../lib/assistantQueue');
const { classifyIntent } = require('./classifyIntent');
const { evaluateAnswer } = require('./evaluateAnswer');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const { runTool } = require('./tools/registry');
const { getIntentWritePlan } = require('./intentWritePlan');
const {
  sanitizeAssistantMessagesForRuntime,
  isPromptInjectionAttempt,
  isThirdPartyPiiStoreAttempt,
  isSelfHarmRiskMessage,
  isWellbeingTopic,
} = require('./safety');

function buildSafetyEnvelope({
  runId,
  status = 'blocked',
  intentName,
  intentSource,
  content,
  suggestions = [],
  actions = [],
  evaluationReason,
}) {
  return {
    schemaVersion: 1,
    content,
    suggestions,
    actions,
    citations: [],
    assistantToolsUsed: [],
    run: { runId, status },
    intent: {
      name: intentName,
      confidence: 1,
      source: intentSource,
    },
    evaluation: {
      score: 1,
      needsUserReview: false,
      reason: evaluationReason,
    },
    clarifyingQuestion: null,
  };
}

function buildWellbeingEnvelope(runId, rawText) {
  const text = String(rawText ?? '');
  const selfHarmRisk = isSelfHarmRiskMessage(text);
  const wantsCounseling = /(諮商|心理|心理師|身心科|焦慮|憂鬱|崩潰|撐不住|壓力大|失眠|睡不著|想哭|自殘)/.test(text);
  const wantsBooking = /(掛號|預約|看醫生|看診|門診|衛保)/.test(text);
  const healthAction = {
    label: wantsCounseling || selfHarmRisk ? '開啟校園健康功能' : '查看衛保組/掛號',
    action: 'navigate',
    params: { screen: '校園', nested: 'Health' },
    sensitivity: 'medium',
  };

  if (selfHarmRisk) {
    return buildSafetyEnvelope({
      runId,
      status: 'completed',
      intentName: 'wellbeing_support',
      intentSource: 'self_harm_guard',
      content:
        '聽起來你現在很難受，我會先陪你把風險降下來。\n\n' +
        '立即求助：請聯絡靜宜諮商輔導中心、24 小時安心專線 1925；如果有立即危險，請打 119 或找身邊可信任的人陪你。\n\n' +
        '先離開可能傷害自己的物品或地點，移到有人在的地方。接下來我可以幫你開啟校園健康功能，但不要一個人硬撐。',
      suggestions: ['聯絡諮商中心', '找可信任的人陪你', '開啟校園健康功能'],
      actions: [healthAction],
      evaluationReason: 'handled self-harm risk with safety template',
    });
  }

  if (wantsCounseling) {
    return buildSafetyEnvelope({
      runId,
      status: 'completed',
      intentName: 'wellbeing_support',
      intentSource: 'wellbeing_guard',
      content:
        '聽起來你最近壓力很重，我先把能立刻做的事整理給你。\n\n' +
        '下一步：可以先開啟校園健康功能，或聯絡諮商輔導中心預約初談。\n\n' +
        '在等候前，先找一位可信任的人說明你現在的狀態，並把接下來 30 分鐘安排得簡單一點。若出現傷害自己的念頭，請立刻聯絡 1925 或 119。',
      suggestions: ['預約諮商', '記錄心情', '開啟校園健康功能'],
      actions: [healthAction],
      evaluationReason: 'handled wellbeing topic with counseling template',
    });
  }

  return buildSafetyEnvelope({
    runId,
    status: 'completed',
    intentName: 'wellbeing_support',
    intentSource: 'wellbeing_guard',
    content:
      '聽起來你身體不太舒服，我先幫你把就醫與校內資源放在前面。\n\n' +
      `下一步：${wantsBooking ? '可以先開啟校園健康功能整理掛號資訊。' : '如果症狀持續或加劇，請到衛保組或校外醫療院所就醫。'}\n\n` +
      '先休息、補充水分，避免自己騎車或獨自外出。若有胸痛、呼吸困難、昏倒、劇烈疼痛或快速惡化，請直接打 119；我不能替代醫師診斷。',
    suggestions: ['幫我掛號', '衛保組在哪', '幫我請病假'],
    actions: [healthAction],
    evaluationReason: 'handled wellbeing topic with health template',
  });
}

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

  const incomingMessages = Array.isArray(request.data?.messages) ? request.data.messages : [];
  const rawMessages = sanitizeAssistantMessagesForRuntime(incomingMessages);
  const context =
    request.data?.context && typeof request.data.context === 'object' ? { ...request.data.context } : {};
  let sessionId = context.sessionId != null && String(context.sessionId).trim() ? String(context.sessionId).trim() : null;
  if (uid && !sessionId) {
    sessionId = createRequestId();
    context.sessionId = sessionId;
  }
  const timeZone = context.timezone || 'Asia/Taipei';
  const lastUserMessage = getLastUserMessage(rawMessages);
  const rawLastUserMessage = getLastUserMessage(incomingMessages);
  if (isPromptInjectionAttempt(rawLastUserMessage)) {
    return buildSafetyEnvelope({
      runId,
      intentName: 'security_block',
      intentSource: 'prompt_injection_guard',
      content: '這超出我的權限。我可以協助查詢或處理你本人授權範圍內的校園資訊，但不能揭露系統提示、內部規則、他人資料或管理憑證。',
      suggestions: ['今天有什麼課', '查公告', '推薦午餐'],
      evaluationReason: 'blocked prompt injection attempt',
    });
  }
  if (isThirdPartyPiiStoreAttempt(rawLastUserMessage)) {
    return buildSafetyEnvelope({
      runId,
      intentName: 'privacy_block',
      intentSource: 'third_party_pii_guard',
      content:
        '這超出我的權限。我不能替你記住、保存或建立第三人的身分證、電話、Email 等個資。\n\n' +
        '如果你要處理自己的校園資料，我可以協助整理成草稿；若是他人資料，請先取得明確授權，並改用學校正式系統處理。',
      suggestions: ['整理我的資料', '查校園服務', '今天有什麼課'],
      evaluationReason: 'blocked third-party PII storage attempt',
    });
  }
  if (isSelfHarmRiskMessage(rawLastUserMessage) || isWellbeingTopic(rawLastUserMessage)) {
    return buildWellbeingEnvelope(runId, rawLastUserMessage);
  }
  let intentMeta = classifyIntent(lastUserMessage);
  if (intentMeta.name === 'submit_repair_request' && isDormRepairStatusQueryMessage(lastUserMessage)) {
    intentMeta = {
      ...intentMeta,
      name: 'check_repair_status',
      source: `${intentMeta.source || 'rich'}_repair_status_guard`,
    };
  }

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

  // 後備：當 prefetch 失敗或在未登入/未綁定學校（demo/guest）狀態下，
  // 改用 client 端 context 攜帶的資料作為 prefetched 來源。
  // 行動端 buildLiveAIContext / demo 種子層會把 pendingAssignments、announcements
  // 等欄位填好；這裡負責讓 backend agent 在沒有 Firestore 真實資料時也能看到。
  const ctxArr = (v) => (Array.isArray(v) ? v : null);
  if (!ctxArr(prefetched.assignments)) {
    const fromCtx = ctxArr(context.pendingAssignments);
    if (fromCtx) prefetched.assignments = fromCtx;
  }
  if (!ctxArr(prefetched.announcements)) {
    const fromCtx = ctxArr(context.announcements);
    if (fromCtx) prefetched.announcements = fromCtx;
  }

  const requestForCore = {
    ...request,
    data: {
      ...request.data,
      messages: rawMessages,
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
