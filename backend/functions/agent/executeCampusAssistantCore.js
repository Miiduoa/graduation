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
const searchCampusDocs = require('./tools/searchCampusDocs');

const db = getFirestore();
const { assertActiveSchoolMember } = createAuthzHelpers(db);

function resolvePermissionScope(intent, hasAuth) {
  return resolveAgentPermissionScope(intent, hasAuth);
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
}) {
  const uid = request.auth?.uid ?? null;
  const rawMessages = Array.isArray(request.data?.messages) ? request.data.messages : [];
  const context =
    request.data?.context && typeof request.data.context === 'object' ? request.data.context : {};
  const timeZone = context.timezone || 'Asia/Taipei';
  const lastUserMessage = getLastUserMessage(rawMessages);
  const intent = detectCampusAssistantIntent(lastUserMessage);

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

  const modelEligibleIntents = new Set([
    'general',
    'help',
    'announcements',
    'events',
    'menus',
    'pois',
    'credit_audit',
  ]);
  if (modelEligibleIntents.has(intent) && lastUserMessage) {
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
    const knowledgeChunks = await searchCampusDocs.execute(
      { uid, schoolId, groupId: context.groupId, timeZone },
      { query: lastUserMessage },
    );
    await recordStep(
      'searchCampusDocs',
      { queryLen: lastUserMessage.length },
      { chunkCount: knowledgeChunks.length },
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
      knowledgeChunks,
      webAnswer: null,
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
      response.debug.route = 'agent_model_rag';
      response.debug.sourcesUsed =
        knowledgeChunks.length +
        announcements.length +
        events.length +
        menus.length +
        pois.length;
      return await finalizeResponse();
    }
  }

  if (intent === 'leave_request') {
    if (!uid) {
      response.content = '請假草稿需要知道你的身分與課程情境。請先登入後再讓我幫你整理。';
      response.suggestions = ['今日公告', '查課表', '功能說明'];
      return await finalizeResponse();
    }

    response.content = [
      '我可以先幫你整理請假草稿，但不會直接送出。',
      '',
      '草稿內容：',
      '您好，我因身體不適／個人事由，想申請相關課程請假。請協助確認是否需要補交證明文件，謝謝。',
      '',
      '送出前請確認日期、課程、假別與證明文件。',
    ].join('\n');
    response.suggestions = ['補上日期', '改成病假', '查請假規則'];
    response.actions = [
      assistantAction({
        label: '建立請假草稿',
        action: 'draft_message',
        params: { screen: 'Today', nested: 'AIChat', draftType: 'leave_request' },
        requiresConfirmation: true,
        sensitivity: 'high',
        evidenceRefs: [{ type: 'system', id: 'leave-request-draft', label: '請假草稿' }],
      }),
    ];
    response.citations = [
      { type: 'system', id: 'campus-agent-confirmation', label: '敏感動作需使用者確認' },
    ];
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
