'use strict';

const { getFirestore } = require('firebase-admin/firestore');
const { createAuthzHelpers } = require('../authz');
const {
  answerWithServerWebSearch,
  shouldUseServerWebSearch,
  resolvePermissionScope: resolveAgentPermissionScope,
} = require('../assistantAgent');
const {
  getLastUserMessage,
  detectCampusAssistantIntent,
  toJsDate,
  formatAssistantDate,
} = require('../lib/assistantFormat');

function extractRepairIdFromMessage(text) {
  const s = String(text ?? '');
  const labeled = s.match(/(?:單號|編號|repair\s*id|工單)[：:\s]*([A-Za-z0-9_-]{10,})/i);
  if (labeled) return labeled[1].trim();
  const loose = s.match(/\b([A-Za-z0-9]{20,28})\b/);
  return loose ? loose[1] : null;
}
const {
  assistantAction,
  resolveAssistantActorRole,
  filterAssistantActionsByRole,
  buildPoiResponse,
} = require('../lib/assistantActions');
const {
  fetchAssistantAnnouncements,
  fetchAssistantEvents,
  fetchAssistantMenus,
  fetchAssistantPois,
  fetchAssistantUserProfile,
  fetchAssistantWeeklyReport,
  fetchAssistantPendingAssignments,
} = require('../lib/assistantFetchers');
const {
  buildAuthorizedAssistantContext,
  webSourcesToCitations,
  buildModelBackedAssistantResponse,
} = require('../lib/assistantCompose');
const { queueAssistantActionDrafts, writeAssistantAuditLog } = require('../lib/assistantQueue');
const { resolveLeaveSubmitPayload } = require('../lib/leaveIntentResolve');
const {
  resolveReserveSeatInput,
  resolveBorrowBookInput,
  resolveRepairInput,
  resolveWashReserveInput,
  resolveFoodOrderInput,
} = require('../lib/campusWriteIntentResolve');
const searchCampusDocs = require('./tools/searchCampusDocs');
const { runTool } = require('./tools/registry');

const db = getFirestore();

/** 這些意圖走結構化寫入草稿（含確認卡），略過 LLM 主路徑以免搶答成一般聊天 */
const INTENTS_SKIP_LLM = new Set([
  'reserve_seat',
  'borrow_book',
  'renew_book',
  'return_book',
  'submit_repair_request',
  'check_repair_status',
  'leave_status',
  'wash_reserve',
  'food_order',
  'pois',
]);
const { assertActiveSchoolMember } = createAuthzHelpers(db);

function resolvePermissionScope(intent, hasAuth) {
  return resolveAgentPermissionScope(intent, hasAuth);
}

function extractLoanIdFromMessage(text) {
  const s = String(text ?? '');
  const labeled = s.match(/(?:借閱|loan|loanId|紀錄|編號|單號)[：:\s]*([A-Za-z0-9_-]{8,})/i);
  if (labeled) return labeled[1].trim();
  const loose = s.match(/\b([A-Za-z0-9_-]{18,32})\b/);
  return loose ? loose[1] : null;
}

function dueTime(row) {
  const d = toJsDate(row?.dueAt ?? row?.dueDate);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

function chooseLibraryLoan(loans, message) {
  if (!Array.isArray(loans) || loans.length === 0) return null;
  const text = String(message ?? '').toLowerCase();
  const explicitLoanId = extractLoanIdFromMessage(text);
  if (explicitLoanId) {
    const exact = loans.find((loan) => String(loan.id) === explicitLoanId || String(loan.loanId) === explicitLoanId);
    if (exact) return exact;
  }
  const titleMatch = text.match(/[《「『"]([^》」』"]{2,80})[》」』"]/)?.[1];
  if (titleMatch) {
    const matched = loans.find((loan) =>
      String(loan.bookTitle || loan.title || '').toLowerCase().includes(titleMatch.toLowerCase()),
    );
    if (matched) return matched;
  }
  const active = loans.filter((loan) => !['returned', 'cancelled'].includes(String(loan.status || '').toLowerCase()));
  const pool = active.length > 0 ? active : loans;
  return [...pool].sort((a, b) => dueTime(a) - dueTime(b))[0] || null;
}

async function resolveLibraryLoanInput({ uid, schoolId, timeZone, lastUserMessage }) {
  const loanId = extractLoanIdFromMessage(lastUserMessage);
  if (loanId) return { input: { loanId }, loan: { id: loanId } };

  const result = await runTool(
    'getLibraryLoans',
    { uid, schoolId, timeZone, prefetched: {} },
    { onlyOverdue: /逾期|過期/.test(String(lastUserMessage || '')) },
  ).catch(() => ({ loans: [] }));
  const loan = chooseLibraryLoan(result.loans, lastUserMessage);
  if (!loan?.id) return null;
  return { input: { loanId: String(loan.id) }, loan };
}

/**
 * 原有 askCampusAssistant 結構化流程（略增：prefetch 課表／日摘要注入 model 上下文；RAG 僅 searchCampusDocs）
 */
async function executeCampusAssistantCore({
  request,
  runId: requestId,
  startedAt,
  prefetched = {},
  recordStep = async () => {},
  routingIntent = null,
}) {
  const uid = request.auth?.uid ?? null;
  const rawMessages = Array.isArray(request.data?.messages) ? request.data.messages : [];
  const context =
    request.data?.context && typeof request.data.context === 'object' ? request.data.context : {};
  const timeZone = context.timezone || 'Asia/Taipei';
  const lastUserMessage = getLastUserMessage(rawMessages);
  const intent =
    typeof routingIntent === 'string' && routingIntent.trim()
      ? routingIntent.trim()
      : detectCampusAssistantIntent(lastUserMessage);

  const userProfile = uid ? await fetchAssistantUserProfile(uid) : null;
  const schoolId = userProfile?.schoolId ?? context.schoolId ?? null;
  const displayName = userProfile?.displayName ?? request.auth?.token?.name ?? null;
  const actorRole = resolveAssistantActorRole(userProfile?.role ?? request.auth?.token?.role);
  const permissionScope = resolvePermissionScope(intent, Boolean(uid));
  const source = 'cloud_functions';
  const freshness = 'live';
  let modelTrace = { provider: 'structured', model: null, usage: null, errors: [] };

  if (!schoolId) {
    await writeAssistantAuditLog({
      uid,
      schoolId: null,
      intent,
      provider: 'structured',
      model: null,
      latencyMs: Date.now() - startedAt,
      tokenUsage: null,
      sources: [],
      actionCount: 0,
      errorCode: 'missing_school',
      requestId,
    }).catch((error) => console.warn('[AI] audit log failed:', error?.message || error));
    return {
      content: '目前無法判斷你所屬的學校。請先選擇學校，或登入後再試一次。',
      suggestions: ['今日公告', '近期活動', '推薦餐點'],
      debug: {
        intent,
        route: 'structured_v1',
        sourcesUsed: 0,
        source,
        freshness,
        permissionScope,
        actorRole,
        requestId,
      },
      modelTrace,
      intent,
    };
  }

  if (uid) {
    await assertActiveSchoolMember(schoolId, uid);
  }

  const response = {
    content: '',
    suggestions: [],
    actions: [],
    citations: [],
    debug: {
      intent,
      route: 'structured_v1',
      sourcesUsed: 0,
      hasAuth: Boolean(uid),
      source,
      freshness,
      permissionScope,
      actorRole,
      requestId,
    },
  };

  const finalizeResponse = async () => {
    response.actions = filterAssistantActionsByRole(response.actions, actorRole, permissionScope);
    await queueAssistantActionDrafts(uid, response.actions, {
      schoolId,
      actorRole,
      permissionScope,
      requestId,
    }).catch((error) => {
      console.warn('[AI] action queue draft failed:', error?.message || error);
      response.debug.actionQueueError = 'write_failed';
    });
    response.usage = modelTrace.usage || undefined;
    response.debug.permissionScope = permissionScope;
    response.debug.actorRole = actorRole;
    response.debug.source = source;
    response.debug.freshness = freshness;
    response.debug.modelProvider = modelTrace.provider;
    response.debug.model = modelTrace.model;
    if (modelTrace.errors?.length) response.debug.modelErrors = modelTrace.errors.slice(0, 2);
    if (uid && context.sessionId) {
      response.debug.sessionId = String(context.sessionId);
    }
    await writeAssistantAuditLog({
      uid,
      schoolId,
      intent,
      provider: modelTrace.provider,
      model: modelTrace.model,
      latencyMs: Date.now() - startedAt,
      tokenUsage: modelTrace.usage,
      sources: response.citations
        .map((citation) => citation.source || `${citation.type}:${citation.id}`)
        .slice(0, 12),
      actionCount: response.actions.length,
      errorCode: response.error ? 'response_error' : null,
      requestId,
    }).catch((error) => console.warn('[AI] audit log failed:', error?.message || error));
    return { ...response, modelTrace, intent };
  };

  if (shouldUseServerWebSearch(lastUserMessage, intent)) {
    const t0 = Date.now();
    const webAnswer = await answerWithServerWebSearch(lastUserMessage);
    await recordStep('answerWithServerWebSearch', { intent }, { ok: Boolean(webAnswer) }, Date.now() - t0);
    if (webAnswer) {
      response.content = webAnswer.content;
      response.suggestions = webAnswer.suggestions || ['看來源', '再查一次', '換個問法'];
      response.citations = webSourcesToCitations(webAnswer.sources);
      response.debug.route = 'agent_web_search';
      response.debug.sourcesUsed = webAnswer.sources?.length || 0;
      response.debug.webConfidence = webAnswer.confidence;
      return await finalizeResponse();
    }
  }

  if (!INTENTS_SKIP_LLM.has(intent) && lastUserMessage) {
    const tFetch = Date.now();
    const [announcements, events, menus, pois] = await Promise.all([
      fetchAssistantAnnouncements(schoolId),
      fetchAssistantEvents(schoolId),
      fetchAssistantMenus(schoolId),
      fetchAssistantPois(schoolId),
    ]);
    await recordStep(
      'fetchCampusBasics',
      { schoolId },
      { counts: { announcements: announcements.length, events: events.length, menus: menus.length, pois: pois.length } },
      Date.now() - tFetch,
    );

    const tRag = Date.now();
    const ragResult = await searchCampusDocs.execute(
      { uid, schoolId, groupId: context.groupId, timeZone },
      { query: lastUserMessage },
    );
    const campusChunks = ragResult.campusChunks ?? [];
    const ragWebAnswer =
      ragResult.webFallback && ragResult.webFallback.content
        ? {
            content: ragResult.webFallback.content,
            sources: ragResult.webFallback.sources || [],
            confidence: ragResult.webFallback.confidence,
          }
        : null;
    await recordStep(
      'searchCampusDocs',
      { queryLen: lastUserMessage.length },
      { chunkCount: campusChunks.length, webFallback: Boolean(ragWebAnswer) },
      Date.now() - tRag,
    );

    const structuredContext = buildAuthorizedAssistantContext({
      schoolId,
      displayName,
      actorRole,
      intent,
      announcements,
      events,
      menus,
      pois,
      todaySchedule: prefetched.todaySchedule || null,
      dailyBrief: prefetched.dailyBrief || null,
    });
    const modelBacked = await buildModelBackedAssistantResponse({
      rawMessages,
      lastUserMessage,
      schoolId,
      actorRole,
      permissionScope,
      structuredContext,
      knowledgeChunks: campusChunks,
      webAnswer: ragWebAnswer,
      toolCtx: {
        uid,
        schoolId,
        groupId: context.groupId,
        timeZone,
        prefetched,
        intent,
      },
      uid,
      sessionId: context.sessionId != null && String(context.sessionId).trim() ? String(context.sessionId).trim() : null,
    });
    modelTrace = {
      provider: modelBacked.modelResult?.provider || 'none',
      model: modelBacked.modelResult?.model || null,
      usage: modelBacked.modelResult?.usage || null,
      errors: modelBacked.modelResult?.errors || [],
    };
    if (modelBacked.response) {
      response.content = modelBacked.response.content;
      response.suggestions =
        modelBacked.response.suggestions.length > 0
          ? modelBacked.response.suggestions
          : ['查看詳情', '今日摘要', '推薦餐點'];
      response.actions = modelBacked.response.actions;
      response.citations = modelBacked.response.citations;
      if (
        Array.isArray(modelBacked.response.assistantToolsUsed) &&
        modelBacked.response.assistantToolsUsed.length > 0
      ) {
        response.assistantToolsUsed = modelBacked.response.assistantToolsUsed;
      }
      if (Array.isArray(modelBacked.response.cards) && modelBacked.response.cards.length > 0) {
        response.cards = modelBacked.response.cards;
      }
      response.debug.route = 'agent_model_rag';
      response.debug.sourcesUsed =
        campusChunks.length +
        announcements.length +
        events.length +
        menus.length +
        pois.length +
        (ragWebAnswer?.sources?.length || 0);
      return await finalizeResponse();
    }
  }

  if (intent === 'leave_status') {
    if (!uid) {
      response.content = '要查請假審核狀態請先登入，我才能讀取你的申請紀錄。';
      response.suggestions = ['今日公告', '查課表', '功能說明'];
      return await finalizeResponse();
    }

    const toolCtx = {
      uid,
      schoolId,
      groupId: context.groupId,
      timeZone,
      prefetched: {},
    };
    let leaveRows = { items: [], count: 0 };
    try {
      leaveRows = await runTool('getLeaveRequestStatus', toolCtx, { limit: 10 });
    } catch (e) {
      console.warn('[AI] getLeaveRequestStatus failed:', e?.message || e);
      response.content = '目前無法讀取請假紀錄，請稍後再試或聯絡管理員。';
      response.suggestions = ['查課表', '今日公告', '功能說明'];
      return await finalizeResponse();
    }

    const items = Array.isArray(leaveRows.items) ? leaveRows.items : [];
    if (items.length === 0) {
      response.content = '你最近沒有請假申請紀錄，或資料尚未同步。若剛送出請假，可稍後再問一次。';
      response.suggestions = ['我要請假', '查課表', '今日公告'];
      return await finalizeResponse();
    }

    const statusZh = (s) => {
      const x = String(s || '').toLowerCase();
      if (x === 'pending') return '待審核';
      if (x === 'approved' || x === 'accepted') return '已核准';
      if (x === 'rejected' || x === 'denied') return '已駁回';
      return s || '未知';
    };

    const lines = items.map((row, i) => {
      const date = row.date || '（日期待定）';
      const typ = row.type || '—';
      const st = statusZh(row.status);
      return `${i + 1}. ${date}｜${typ}｜${st}`;
    });

    response.content = ['以下是您最近的請假申請狀態（最多 10 筆）：', '', ...lines].join('\n');
    response.suggestions = ['我要請假', '查課表', '今日公告'];
    response.debug.sourcesUsed = items.length;
    return await finalizeResponse();
  }

  if (intent === 'check_repair_status') {
    if (!uid) {
      response.content = '先登入才能查宿舍報修。';
      response.suggestions = ['功能說明'];
      return await finalizeResponse();
    }

    const toolCtx = {
      uid,
      schoolId,
      groupId: context.groupId,
      timeZone,
      prefetched: {},
    };

    const repairId = extractRepairIdFromMessage(lastUserMessage);
    if (repairId) {
      try {
        const tOne = Date.now();
        const one = await runTool('getDormRepairStatus', toolCtx, { repairId });
        await recordStep('getDormRepairStatus', { repairId }, one, Date.now() - tOne);
        if (one?.forbidden) {
          response.content = '查不到這筆報修，或它不屬於你的帳號；可改問「我的報修」列出清單。';
          response.suggestions = ['我的報修'];
          return await finalizeResponse();
        }
        if (!one?.found) {
          response.content = '找不到這筆報修；若剛送出，請稍後到宿舍「我的報修」確認，或改問「我的報修」。';
          response.suggestions = ['我的報修'];
          return await finalizeResponse();
        }
        const st = String(one.status || 'unknown');
        const stZh =
          st === 'pending'
            ? '待處理'
            : st === 'assigned' || st === 'in_progress'
              ? '處理中'
              : st === 'completed'
                ? '已完成'
                : st === 'cancelled'
                  ? '已取消'
                  : st;
        const loc = `${one.dormitory || '—'} ${one.room || ''}`.trim();
        const descShort = one.description ? String(one.description).slice(0, 48) : '';
        response.content = [
          `報修單 ${one.repairId}：${stZh}｜${loc}｜${one.category || '—'}`,
          descShort ? `摘要：${descShort}${String(one.description).length > 48 ? '…' : ''}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        response.suggestions = ['我的報修'];
        response.actions = [
          assistantAction({
            label: '開啟宿舍／我的報修',
            action: 'navigate',
            params: { screen: '校園', nested: 'Dormitory' },
            requiresConfirmation: false,
            sensitivity: 'low',
            evidenceRefs: [{ type: 'system', id: 'dorm-repairs', label: '宿舍報修' }],
          }),
        ];
        response.debug.sourcesUsed = 1;
        return await finalizeResponse();
      } catch (e) {
        console.warn('[AI] getDormRepairStatus failed:', e?.message || e);
        response.content = '暫時讀不到這筆報修狀態，請稍後再試或到宿舍頁查看。';
        response.suggestions = ['我的報修'];
        return await finalizeResponse();
      }
    }

    let listRows = { items: [], count: 0 };
    try {
      const tList = Date.now();
      listRows = await runTool('listMyDormRepairs', toolCtx, { limit: 15 });
      await recordStep('listMyDormRepairs', { limit: 15 }, listRows, Date.now() - tList);
    } catch (e) {
      console.warn('[AI] listMyDormRepairs failed:', e?.message || e);
      response.content = '暫時讀不到報修列表，請稍後再試或到宿舍「我的報修」查看。';
      response.suggestions = ['我的報修'];
      return await finalizeResponse();
    }

    const items = Array.isArray(listRows.items) ? listRows.items : [];
    if (items.length === 0) {
      response.content = '最近沒有宿舍報修紀錄；若剛送出，請稍後再問或到宿舍頁確認。';
      response.suggestions = ['我要報修'];
      return await finalizeResponse();
    }

    const statusZh = (s) => {
      const x = String(s || '').toLowerCase();
      if (x === 'pending') return '待處理';
      if (x === 'assigned' || x === 'in_progress') return '處理中';
      if (x === 'completed') return '已完成';
      if (x === 'cancelled') return '已取消';
      return s || '未知';
    };

    const lines = items.map((row, i) => {
      const loc = `${row.dormitory || ''} ${row.room || ''}`.trim() || '—';
      return `${i + 1}. ${row.repairId}｜${statusZh(row.status)}｜${loc}`;
    });

    response.content = [`宿舍報修 ${items.length} 筆（最多顯示 15）：`, '', ...lines].join('\n');
    response.suggestions = ['我要報修'];
    response.actions = [
      assistantAction({
        label: '開啟宿舍／我的報修',
        action: 'navigate',
        params: { screen: '校園', nested: 'Dormitory' },
        requiresConfirmation: false,
        sensitivity: 'low',
        evidenceRefs: [{ type: 'system', id: 'dorm-repairs', label: '宿舍報修' }],
      }),
    ];
    response.debug.sourcesUsed = items.length;
    return await finalizeResponse();
  }

  if (intent === 'leave_request') {
    if (!uid) {
      response.content = '請假需要知道你的身分與課程。請先登入後再讓我幫你整理。';
      response.suggestions = ['今日公告', '查課表', '功能說明'];
      return await finalizeResponse();
    }

    const contextCourseId =
      context.courseId != null && String(context.courseId).trim()
        ? String(context.courseId).trim()
        : null;

    const leavePayload = await resolveLeaveSubmitPayload({
      uid,
      lastUserMessage,
      timeZone,
      prefetchedTodaySchedule: prefetched.todaySchedule,
      contextCourseId,
    });

    if (leavePayload.incomplete || !leavePayload.courseId) {
      response.content = [
        '我想幫你送出請假，但目前無法從你的課表對應到具體課程或日期。',
        '',
        '請在訊息裡補上「哪一天」（例如：明天、下禮拜三、5/12）以及課程名稱；若在課程頁開啟助理，也會優先帶入目前課程。',
      ].join('\n');
      response.suggestions = ['明天微積分請假', '查課表', '查請假規則'];
      response.citations = [
        { type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' },
      ];
      return await finalizeResponse();
    }

    response.content = [
      '我已從你的課表與訊息整理出請假內容，送出前請再確認。',
      '',
      `預計請假日期：${leavePayload.date}`,
      `假別：${leavePayload.type}`,
      '',
      '點「送出請假」後會在伺服端建立待審申請，不會在未確認時直接生效。',
    ].join('\n');
    response.suggestions = ['改成病假', '換一天', '查請假規則'];
    response.actions = [
      assistantAction({
        label: '送出請假',
        action: 'queue_action',
        params: {
          toolName: 'submitLeaveRequest',
          input: {
            courseId: leavePayload.courseId,
            date: leavePayload.date,
            type: leavePayload.type,
          },
          agentRunId: requestId,
        },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'leave-request-submit', label: '請假申請' }],
      }),
    ];
    response.citations = [
      { type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' },
    ];
    return await finalizeResponse();
  }

  if (intent === 'reserve_seat') {
    if (!uid) {
      response.content = '預約座位需要先登入。登入後再告訴我日期、時段與座位（或說「圖書館三樓隨便一席」）。';
      response.suggestions = ['功能說明', '今日公告', '查課表'];
      return await finalizeResponse();
    }
    const seatInput = resolveReserveSeatInput(lastUserMessage, timeZone);
    if (!seatInput) {
      response.content = [
        '我可以幫你建立「圖書館／自習室」座位預約草稿，但目前無法從這句話辨識日期、時間或座位。',
        '',
        '請補上例如：明天早上 9:00、圖書館三樓 A-15（或說隨便一席）。',
      ].join('\n');
      response.suggestions = ['明天 9:00 圖書館三樓隨便一席', '查課表', '今日公告'];
      return await finalizeResponse();
    }
    response.content = [
      '我已整理座位預約內容，確認後才會寫入 seatReservations。',
      '',
      `座位：${seatInput.seatId}｜日期：${seatInput.date}｜${seatInput.startTime}–${seatInput.endTime}`,
    ].join('\n');
    response.suggestions = ['改時段', '換座位', '查課表'];
    response.actions = [
      assistantAction({
        label: '確認預約座位',
        action: 'queue_action',
        params: { toolName: 'reserveSeat', input: seatInput, agentRunId: requestId },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'reserve-seat', label: '座位預約' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'borrow_book') {
    if (!uid) {
      response.content = '借書需要先登入。請用《書名》或書籍 ID 告訴我要借哪一本。';
      response.suggestions = ['功能說明', '今日公告', '查課表'];
      return await finalizeResponse();
    }
    const bookInput = await resolveBorrowBookInput(lastUserMessage, schoolId);
    if (!bookInput) {
      response.content = [
        '我可以幫你建立借書草稿，但找不到對應的館藏 bookId。',
        '',
        '請用《完整或部分書名》再試一次，或到圖書館查詢館藏代碼。',
      ].join('\n');
      response.suggestions = ['借《資料結構》', '查課表', '今日公告'];
      return await finalizeResponse();
    }
    response.content = '我已整理借書申請，確認後會建立 libraryLoans 並扣庫存。';
    response.suggestions = ['換一本', '查借閱', '今日公告'];
    response.actions = [
      assistantAction({
        label: '確認借書',
        action: 'queue_action',
        params: { toolName: 'borrowBook', input: bookInput, agentRunId: requestId },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'borrow-book', label: '圖書借閱' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'renew_book' || intent === 'return_book') {
    if (!uid) {
      response.content = intent === 'renew_book' ? '續借需要先登入，我才能讀取你的借閱紀錄。' : '還書登記需要先登入，我才能讀取你的借閱紀錄。';
      response.suggestions = ['登入後查借閱', '今日公告', '功能說明'];
      return await finalizeResponse();
    }

    const resolvedLoan = await resolveLibraryLoanInput({ uid, schoolId, timeZone, lastUserMessage });
    if (!resolvedLoan) {
      response.content = [
        intent === 'renew_book'
          ? '我可以幫你建立續借確認，但目前找不到可續借的借閱紀錄。'
          : '我可以幫你建立還書確認，但目前找不到未歸還的借閱紀錄。',
        '',
        '請補上借閱紀錄編號，或先問「我有哪些書還沒還？」讓我列出清單。',
      ].join('\n');
      response.suggestions = ['我有哪些書還沒還？', '今日摘要', '功能說明'];
      return await finalizeResponse();
    }

    const isRenew = intent === 'renew_book';
    const loanTitle = resolvedLoan.loan.bookTitle || resolvedLoan.loan.title || resolvedLoan.loan.bookId || resolvedLoan.loan.id;
    response.content = [
      isRenew ? '我已整理續借確認，確認後才會更新借閱期限。' : '我已整理還書確認，確認後才會更新借閱狀態。',
      '',
      `書籍：${loanTitle}`,
      resolvedLoan.loan.dueAt ? `到期：${formatAssistantDate(toJsDate(resolvedLoan.loan.dueAt), timeZone)}` : '',
    ].filter(Boolean).join('\n');
    response.suggestions = isRenew ? ['查看借閱', '改續借其他書', '今日摘要'] : ['查看借閱', '改還其他書', '今日摘要'];
    response.actions = [
      assistantAction({
        label: isRenew ? '確認續借' : '確認還書',
        action: 'queue_action',
        params: {
          toolName: isRenew ? 'renewBook' : 'returnBook',
          input: resolvedLoan.input,
          agentRunId: requestId,
        },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: isRenew ? 'renew-book' : 'return-book', label: isRenew ? '圖書續借' : '圖書還書' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'submit_repair_request') {
    if (!uid) {
      response.content = '報修要先登入，並說明棟別、房號與狀況。';
      response.suggestions = ['功能說明'];
      return await finalizeResponse();
    }
    const repairInput = resolveRepairInput(lastUserMessage);
    if (!repairInput) {
      response.content = '請補上位置與狀況（例：A棟 301 冷氣不冷）。';
      response.suggestions = ['A棟301冷氣不冷'];
      return await finalizeResponse();
    }
    const descSnippet = repairInput.description.slice(0, 120);
    response.content = `已整理好報修草稿：${repairInput.dormitory} ${repairInput.room}｜${repairInput.category}。${descSnippet}${
      repairInput.description.length > 120 ? '…' : ''
    }`;
    response.suggestions = ['我的報修'];
    response.actions = [
      assistantAction({
        label: '確認送出報修',
        action: 'queue_action',
        params: { toolName: 'createDormRepairRequest', input: repairInput, agentRunId: requestId },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'repair-request', label: '宿舍報修' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'wash_reserve') {
    if (!uid) {
      response.content = '預約洗衣機需要先登入。請告訴我時段（例如：今晚 8 點）。';
      response.suggestions = ['功能說明', '今日公告', '查課表'];
      return await finalizeResponse();
    }
    const washInput = await resolveWashReserveInput(lastUserMessage, schoolId);
    if (!washInput) {
      response.content =
        '我可以幫你預約洗衣機，但目前找不到可預約的機台或無法解析時間。請確認學校是否已建立 washingMachines 資料。';
      response.suggestions = ['今晚八點洗衣', '今日公告', '查課表'];
      return await finalizeResponse();
    }
    response.content = [
      '我已整理洗衣機預約草稿，確認後會寫入 washingReservations 並更新機台狀態。',
      '',
      `機台：${washInput.machineId}｜開始：${washInput.startTime}｜${washInput.dormitory}`,
    ].join('\n');
    response.suggestions = ['改時間', '今日公告', '查課表'];
    response.actions = [
      assistantAction({
        label: '確認預約洗衣',
        action: 'queue_action',
        params: { toolName: 'reserveWashingMachine', input: washInput, agentRunId: requestId },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'wash-reserve', label: '洗衣預約' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'food_order') {
    if (!uid) {
      response.content = '訂餐要先登入，並說明餐廳與品項（例：學生餐廳雞排飯＋紅茶）。';
      response.suggestions = ['功能說明'];
      return await finalizeResponse();
    }
    const orderInput = await resolveFoodOrderInput(lastUserMessage, schoolId);
    if (!orderInput) {
      response.content = '目前對不到菜單品項或餐廳資料，請換個品名或到學餐頁確認。';
      response.suggestions = ['換個說法點餐'];
      return await finalizeResponse();
    }
    response.content = `已整理好訂餐草稿（${orderInput.items.length} 項），按下確認後會送出。`;
    response.suggestions = ['修改品項'];
    response.actions = [
      assistantAction({
        label: '確認下單',
        action: 'queue_action',
        params: { toolName: 'createOrder', input: orderInput, agentRunId: requestId },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'create-order', label: '餐廳訂單' }],
      }),
    ];
    response.citations = [{ type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' }];
    return await finalizeResponse();
  }

  if (intent === 'assignment_planning') {
    if (!uid) {
      response.content = '要依你的作業截止時間拆解任務，請先登入。我可以先提供一般讀書計畫模板。';
      response.suggestions = ['一般讀書計畫', '今日公告', '功能說明'];
      return await finalizeResponse();
    }

    const pendingAssignments = Array.isArray(prefetched.assignments)
      ? prefetched.assignments
      : await fetchAssistantPendingAssignments(uid, context.groupId);
    response.debug.sourcesUsed = pendingAssignments.length;
    const target = pendingAssignments[0];

    if (!target) {
      response.content =
        '目前沒有抓到快截止的作業。你可以指定一份作業名稱，我會幫你拆成可執行步驟。';
      response.suggestions = ['今日摘要', '查作業', '查公告'];
      return await finalizeResponse();
    }

    response.content = [
      `我先用「${target.title ?? '未命名作業'}」幫你拆成今天可執行的計畫：`,
      '',
      '1. 先讀題目與評分規準，列出交付物。',
      '2. 用 25 分鐘完成資料收集或大綱。',
      '3. 用 45 分鐘完成第一版內容。',
      '4. 截止前預留 20 分鐘檢查格式與附件。',
      '',
      `截止時間：${formatAssistantDate(target.dueAt, true) || '未設定'}`,
    ].join('\n');
    response.suggestions = ['設定提醒', '更細拆步驟', '查看作業'];
    response.actions = [
      assistantAction({
        label: '拆成待辦',
        action: 'split_assignment',
        params: { assignmentId: target.id, groupId: target.groupId },
        requiresConfirmation: true,
        sensitivity: 'medium',
        evidenceRefs: [{ type: 'assignment', id: target.id, label: target.title ?? '作業' }],
      }),
      assistantAction({
        label: '設定提醒',
        action: 'schedule_reminder',
        params: {
          title: target.title ?? '作業提醒',
          dueDate: toJsDate(target.dueAt)?.toISOString() ?? undefined,
        },
        requiresConfirmation: true,
        sensitivity: 'medium',
        evidenceRefs: [{ type: 'assignment', id: target.id, label: target.title ?? '作業' }],
      }),
    ];
    response.citations = [{ type: 'assignment', id: target.id, label: target.title ?? '作業' }];
    return await finalizeResponse();
  }

  if (intent === 'assignment_status' || intent === 'study_summary') {
    if (!uid) {
      response.content =
        '要查詢個人作業、週報或學習摘要，請先登入帳號。我也可以先幫你看公開的公告、活動或餐點資訊。';
      response.suggestions = ['今日公告', '近期活動', '推薦餐點'];
      return await finalizeResponse();
    }

    const pendingAssignments = Array.isArray(prefetched.assignments)
      ? prefetched.assignments
      : await fetchAssistantPendingAssignments(uid, context.groupId);
    const [weeklyReport, announcements] = await Promise.all([
      fetchAssistantWeeklyReport(uid),
      Array.isArray(prefetched.announcements)
        ? Promise.resolve(prefetched.announcements)
        : fetchAssistantAnnouncements(schoolId),
    ]);

    response.debug.sourcesUsed =
      pendingAssignments.length + (weeklyReport ? 1 : 0) + announcements.length;

    if (intent === 'assignment_status') {
      if (pendingAssignments.length === 0) {
        response.content =
          '目前沒有快到期的待繳作業。你可以改問我近期公告、活動，或請我幫你規劃今天的學習重點。';
        response.suggestions = ['今日摘要', '近期活動', '今日公告'];
        return await finalizeResponse();
      }

      const earliest = pendingAssignments[0];
      const list = pendingAssignments
        .slice(0, 3)
        .map(
          (assignment, index) =>
            `${index + 1}. ${assignment.title ?? '未命名作業'}（${assignment.groupName ?? assignment.groupId}，截止：${formatAssistantDate(assignment.dueAt)}）`,
        )
        .join('\n');

      response.content = [
        `你目前有 ${pendingAssignments.length} 份作業待處理，最早截止的是「${earliest.title ?? '未命名作業'}」。`,
        '',
        list,
        weeklyReport?.summary ? `\n本週學習狀況：${weeklyReport.summary}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      response.suggestions = ['設定提醒', '今日摘要', '今日公告'];
      response.actions = [
        assistantAction({
          label: '設定提醒',
          action: 'schedule_reminder',
          params: {
            title: earliest.title ?? '作業提醒',
            dueDate: toJsDate(earliest.dueAt)?.toISOString() ?? undefined,
          },
          requiresConfirmation: true,
          sensitivity: 'medium',
          evidenceRefs: [
            { type: 'assignment', id: earliest.id, label: earliest.title ?? '作業' },
          ],
        }),
      ];
      response.citations = pendingAssignments.slice(0, 3).map((assignment) => ({
        type: 'assignment',
        id: assignment.id,
        label: assignment.title ?? '未命名作業',
      }));
      return await finalizeResponse();
    }

    const lines = [];
    if (displayName) {
      lines.push(`${displayName}，這是你目前最值得先關注的重點：`);
    } else {
      lines.push('這是你目前最值得先關注的重點：');
    }

    if (pendingAssignments.length > 0) {
      lines.push(
        `1. 待繳作業共有 ${pendingAssignments.length} 份，最近的是「${pendingAssignments[0].title ?? '未命名作業'}」，截止：${formatAssistantDate(pendingAssignments[0].dueAt)}。`,
      );
    } else {
      lines.push('1. 目前沒有快到期的待繳作業。');
    }

    if (weeklyReport?.summary) {
      lines.push(`2. 本週學習摘要：${weeklyReport.summary}`);
    }

    if (announcements.length > 0) {
      lines.push(`3. 最新公告可先看「${announcements[0].title ?? '未命名公告'}」。`);
    }

    response.content = lines.join('\n');
    response.suggestions = ['設定提醒', '今日公告', '近期活動'];
    if (pendingAssignments[0]) {
      response.actions = [
        assistantAction({
          label: '設定提醒',
          action: 'schedule_reminder',
          params: {
            title: pendingAssignments[0].title ?? '作業提醒',
            dueDate: toJsDate(pendingAssignments[0].dueAt)?.toISOString() ?? undefined,
          },
          requiresConfirmation: true,
          sensitivity: 'medium',
          evidenceRefs: [
            {
              type: 'assignment',
              id: pendingAssignments[0].id,
              label: pendingAssignments[0].title ?? '作業',
            },
          ],
        }),
      ];
    }
    return await finalizeResponse();
  }

  if (intent === 'announcements') {
    const announcements = Array.isArray(prefetched.announcements)
      ? prefetched.announcements
      : await fetchAssistantAnnouncements(schoolId);
    response.debug.sourcesUsed = announcements.length;

    if (announcements.length === 0) {
      response.content =
        '目前沒有可用的公告資料。你可以稍後再試，或改問我近期活動、餐點與校園地點。';
      response.suggestions = ['近期活動', '推薦餐點', '找地點'];
      return await finalizeResponse();
    }

    response.content = [
      `目前先幫你整理 ${Math.min(announcements.length, 3)} 則最新公告：`,
      '',
      announcements
        .slice(0, 3)
        .map(
          (announcement, index) =>
            `${index + 1}. ${announcement.title ?? '未命名公告'}${announcement.publishedAt ? `（${formatAssistantDate(announcement.publishedAt)}）` : ''}`,
        )
        .join('\n'),
    ].join('\n');
    response.suggestions = ['查看詳情', '近期活動', '推薦餐點'];
    response.actions = announcements.slice(0, 2).map((announcement) =>
      assistantAction({
        label: `查看「${String(announcement.title ?? '公告').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: 'Today', nested: '公告詳情', id: announcement.id },
        evidenceRefs: [
          { type: 'announcement', id: announcement.id, label: announcement.title ?? '公告' },
        ],
      }),
    );
    response.citations = announcements.slice(0, 3).map((announcement) => ({
      type: 'announcement',
      id: announcement.id,
      label: announcement.title ?? '未命名公告',
    }));
    return await finalizeResponse();
  }

  if (intent === 'events') {
    const events = (await fetchAssistantEvents(schoolId))
      .filter((event) => {
        const start = toJsDate(event.startsAt);
        return !start || start >= new Date(Date.now() - 60 * 60 * 1000);
      })
      .slice(0, 4);

    response.debug.sourcesUsed = events.length;

    if (events.length === 0) {
      response.content = '近期沒有查到即將開始的活動。你可以先看看最新公告，或等晚一點再來查詢。';
      response.suggestions = ['今日公告', '推薦餐點', '找地點'];
      return await finalizeResponse();
    }

    response.content = [
      '近期值得關注的活動有：',
      '',
      events
        .slice(0, 3)
        .map(
          (event, index) =>
            `${index + 1}. ${event.title ?? '未命名活動'}${event.location ? `（${event.location}）` : ''}${event.startsAt ? `，${formatAssistantDate(event.startsAt, true)}` : ''}`,
        )
        .join('\n'),
    ].join('\n');
    response.suggestions = ['查看詳情', '今日公告', '找地點'];
    response.actions = events.slice(0, 2).map((event) =>
      assistantAction({
        label: `查看「${String(event.title ?? '活動').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: 'Today', nested: '活動詳情', id: event.id },
        evidenceRefs: [{ type: 'event', id: event.id, label: event.title ?? '活動' }],
      }),
    );
    response.citations = events.slice(0, 3).map((event) => ({
      type: 'event',
      id: event.id,
      label: event.title ?? '未命名活動',
    }));
    return await finalizeResponse();
  }

  if (intent === 'menus') {
    const menus = (await fetchAssistantMenus(schoolId)).slice(0, 5);
    response.debug.sourcesUsed = menus.length;

    if (menus.length === 0) {
      response.content = '目前沒有可用的菜單資料。你可以改問我校園地點或近期活動。';
      response.suggestions = ['找地點', '近期活動', '今日公告'];
      return await finalizeResponse();
    }

    response.content = [
      '今天可以先考慮這幾樣：',
      '',
      menus
        .slice(0, 3)
        .map(
          (menu, index) =>
            `${index + 1}. ${menu.name ?? menu.title ?? '未命名餐點'}${menu.price != null ? ` - $${menu.price}` : ''}${menu.cafeteria ? `（${menu.cafeteria}）` : ''}`,
        )
        .join('\n'),
    ].join('\n');
    response.suggestions = ['其他選擇', '找地點', '近期活動'];
    response.actions = menus.slice(0, 2).map((menu) =>
      assistantAction({
        label: `查看「${String(menu.name ?? menu.title ?? '餐點').slice(0, 10)}」`,
        action: 'navigate',
        params: { screen: '校園', nested: 'MenuDetail', id: menu.id },
        evidenceRefs: [{ type: 'menu', id: menu.id, label: menu.name ?? menu.title ?? '餐點' }],
      }),
    );
    response.citations = menus.slice(0, 3).map((menu) => ({
      type: 'menu',
      id: menu.id,
      label: menu.name ?? menu.title ?? '未命名餐點',
    }));
    return await finalizeResponse();
  }

  if (intent === 'pois') {
    const pois = await fetchAssistantPois(schoolId);
    const poi = buildPoiResponse(lastUserMessage, pois);
    response.debug.sourcesUsed = pois.length > 0 ? 1 : 0;

    if (!poi) {
      response.content =
        '我目前找不到符合的校園地點。你可以再說更具體一點，例如圖書館、行政大樓、餐廳或宿舍。';
      response.suggestions = ['圖書館', '行政大樓', '餐廳'];
      return await finalizeResponse();
    }

    response.content = [
      `找到「${poi.name ?? '未命名地點'}」了。`,
      poi.category ? `分類：${poi.category}` : '',
      poi.description ? `說明：${poi.description}` : '',
      poi.openingHours ? `開放時間：${poi.openingHours}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    response.suggestions = ['查看詳情', '開啟導航', '其他地點'];
    response.actions = [
      assistantAction({
        label: '查看詳情',
        action: 'navigate',
        params: { screen: '校園', nested: 'PoiDetail', id: poi.id },
        evidenceRefs: [{ type: 'poi', id: poi.id, label: poi.name ?? '地點' }],
      }),
      assistantAction({
        label: '開始導航',
        action: 'start_navigation',
        params: { screen: '校園', nested: 'PoiDetail', id: poi.id, destinationId: poi.id },
        requiresConfirmation: false,
        evidenceRefs: [{ type: 'poi', id: poi.id, label: poi.name ?? '地點' }],
      }),
    ];
    response.citations = [{ type: 'poi', id: poi.id, label: poi.name ?? '未命名地點' }];
    return await finalizeResponse();
  }

  if (intent === 'credit_audit') {
    response.content =
      '學分試算與選課建議目前建議搭配既有的「學分試算」功能使用。後續可以再把畢業條件與修課紀錄接進 AI，做更精準的選課推薦。';
    response.suggestions = ['前往學分試算', '今日摘要', '近期活動'];
    response.actions = [
      assistantAction({
        label: '前往學分試算',
        action: 'navigate',
        params: { screen: '我的', nested: 'CreditAuditStack' },
        evidenceRefs: [{ type: 'system', id: 'credit-audit', label: '學分試算' }],
      }),
    ];
    return await finalizeResponse();
  }

  if (intent === 'help') {
    response.content = [
      '我目前可以幫你處理這些事情：',
      '1. 查最新公告與活動',
      '2. 推薦餐點與找校園地點',
      uid ? '3. 查看你的待繳作業與學習摘要' : '3. 登入後查看個人作業與學習摘要',
    ].join('\n');
    response.suggestions = ['今日公告', '近期活動', '推薦餐點'];
    return await finalizeResponse();
  }

  const [announcements, events] = await Promise.all([
    fetchAssistantAnnouncements(schoolId),
    fetchAssistantEvents(schoolId),
  ]);
  response.debug.sourcesUsed = announcements.length + events.length;

  response.content = [
    '我目前最適合幫你做的是查詢校園資訊與整理學習重點。',
    announcements[0]?.title ? `最新公告：${announcements[0].title}` : '',
    events[0]?.title ? `近期活動：${events[0].title}` : '',
    uid ? '你也可以直接問我：我有哪些作業快截止？' : '你也可以直接問我：今天有什麼公告？',
  ]
    .filter(Boolean)
    .join('\n');
  response.suggestions = uid
    ? ['我有哪些作業快截止？', '今天有什麼公告？', '推薦午餐']
    : ['今天有什麼公告？', '近期活動', '推薦午餐'];
  return await finalizeResponse();
}

module.exports = { executeCampusAssistantCore };
