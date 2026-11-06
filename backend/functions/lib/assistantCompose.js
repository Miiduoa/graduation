'use strict';

const {
  buildAgentSystemPrompt,
  callAssistantModelWithTools,
} = require('../assistantAgent');

const CAMPUS_ASSISTANT_MESSAGE_CHARS = 4000;
const { tools } = require('../agent/tools/registry');
const agentCases = require('../agent/cases.json');
const { normalizeAssistantText, formatAssistantDate, extractScheduleSnippet } = require('./assistantFormat');
const {
  loadConversationMessages,
  saveConversationMessages,
} = require('./assistantConversationStore');

// 給模型看的時間先換成台灣時間的字，免得模型照 UTC 念給使用者
const ASSISTANT_DATE_FIELDS = new Set(['publishedAt', 'startsAt', 'endsAt', 'dueAt']);

function compactAssistantItems(items, fields, limit = 5) {
  return (items || []).slice(0, limit).map((item) => {
    const row = { id: item.id };
    fields.forEach((field) => {
      if (item[field] == null) return;
      if (ASSISTANT_DATE_FIELDS.has(field)) {
        const text = formatAssistantDate(item[field]);
        if (text) row[field] = text;
        return;
      }
      row[field] = item[field];
    });
    return row;
  });
}

function buildAuthorizedAssistantContext({
  schoolId,
  displayName,
  actorRole,
  intent,
  announcements = [],
  events = [],
  menus = [],
  pois = [],
  pendingAssignments = null,
  weeklyReport = null,
  todaySchedule = null,
  dailyBrief = null,
}) {
  const base = {
    schoolId,
    displayName,
    actorRole,
    intent,
    announcements: compactAssistantItems(announcements, ['title', 'source', 'publishedAt'], 5).map((row, index) => {
      // 內文裡講時段的那一句也給模型，問「什麼時候維修」才答得出時段
      const timeNote = extractScheduleSnippet(String(announcements[index]?.body || announcements[index]?.content || ''));
      return timeNote ? { ...row, timeNote } : row;
    }),
    events: compactAssistantItems(events, ['title', 'location', 'startsAt'], 5),
    menus: compactAssistantItems(menus, ['name', 'title', 'price', 'cafeteria'], 6),
    pois: compactAssistantItems(pois, ['name', 'category', 'description', 'openingHours'], 8),
    pendingAssignments: Array.isArray(pendingAssignments)
      ? compactAssistantItems(pendingAssignments, ['title', 'groupId', 'groupName', 'dueAt'], 6)
      : null,
    pendingAssignmentsStatus: Array.isArray(pendingAssignments) ? 'available' : 'unavailable',
    ...(!Array.isArray(pendingAssignments) && {
      pendingAssignmentsNote: '尚未取得本人待繳作業資料，不能據此判定沒有作業。',
    }),
    weeklyReport: weeklyReport?.summary ? { summary: weeklyReport.summary } : null,
  };

  if (todaySchedule?.status === 'unavailable') {
    base.todayScheduleStatus = 'unavailable';
    base.todayScheduleNote = todaySchedule.message;
  } else if (todaySchedule && Array.isArray(todaySchedule.slots)) {
    base.todaySchedule = todaySchedule.slots.slice(0, 12).map((s) => ({
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
    }));
    if (todaySchedule.emptyReason && (!todaySchedule.slots || todaySchedule.slots.length === 0)) {
      base.todayScheduleNote = `（無課表資料：${todaySchedule.emptyReason}）`;
    }
  }

  if (dailyBrief?.summary) {
    base.dailyBrief = { summary: String(dailyBrief.summary).slice(0, 500) };
  }

  return base;
}

function extractAssistantSuggestions(content) {
  const match = String(content || '').match(/(?:建議選項|建議)[：:]\s*([^\n]+)/);
  if (!match) return [];
  return match[1]
    .replace(/[、,，;；]/g, '、')
    .split('、')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 12)
    .slice(0, 3);
}

function webSourcesToCitations(sources) {
  return (sources || []).slice(0, 4).map((source) => ({
    type: 'web',
    id: source.url || source.title,
    label: source.title || source.source || '公開來源',
    source: source.url,
  }));
}

async function buildModelBackedAssistantResponse({
  lastUserMessage,
  schoolId,
  actorRole,
  permissionScope,
  structuredContext,
  knowledgeChunks,
  webAnswer,
  toolCtx,
  uid = null,
  sessionId = null,
  writePermissions = null,
}) {
  const {
    isAssistantWriteToolAllowed,
  } = require('./assistantWritePermissions');

  // 需確認寫入工具不給模型直接呼叫；草稿下單工具另依「餐廳下單」開關過濾。
  const toolsForLlm = tools.filter((t) => {
    if (t.requiresConfirmation) return false;
    if (t.name === 'proposeOrder' && !isAssistantWriteToolAllowed(writePermissions, 'createOrder')) {
      return false;
    }
    return true;
  });
  const toolPromptSection = toolsForLlm.map((t) => `- ${t.name}：${t.description || t.name}`).join('\n');

  // 規劃階段：未允許的寫入工具不出現在 few-shot／可用清單（執行前 executeAgentWrite 仍會再擋一次）。
  const writeDeferred = tools.filter(
    (t) =>
      t.requiresConfirmation === true && isAssistantWriteToolAllowed(writePermissions, t.name),
  );
  const writeToolNames = writeDeferred.map((t) => `${t.name}（${t.description || ''}）`).join('\n');
  const fewShots = (Array.isArray(agentCases.writeToolFewShots) ? agentCases.writeToolFewShots : []).filter(
    (row) => {
      const name = row?.toolName || row?.tool || row?.name;
      return typeof name === 'string' && isAssistantWriteToolAllowed(writePermissions, name);
    },
  );
  const writeFewShotBlock =
    writeDeferred.length > 0
      ? [
          '',
          '以下為「須使用者確認後才執行」的寫入工具名稱（不可透過 function calling 直接呼叫；由介面 queue_action 確認後由 executeAgentWrite 執行）：',
          writeToolNames,
          '',
          '寫入意圖與欄位範例（few-shot，僅供理解使用者句子 → 正確 tool 與 input 形狀）：',
          ...fewShots.map((row) => JSON.stringify(row, null, 0)),
        ].join('\n')
      : [
          '',
          '目前使用者未開放任何寫入類助理動作；若使用者要求請假、借書、訂餐、報修等寫入，請告知可到設定 → 助理權限開啟對應開關。',
        ].join('\n');

  const systemPrompt = buildAgentSystemPrompt({
    schoolId,
    actorRole,
    permissionScope,
    structuredContext,
    knowledgeChunks,
    webAnswer,
    toolPromptSection,
    writeFewShotBlock,
  });

  const userSlice = normalizeAssistantText(lastUserMessage).slice(0, CAMPUS_ASSISTANT_MESSAGE_CHARS);
  const prior = await loadConversationMessages(uid, sessionId, schoolId);
  const history = prior.map((message) => ({
    ...message,
    content: String(message.content ?? '').slice(0, CAMPUS_ASSISTANT_MESSAGE_CHARS),
  }));
  const last = history.at(-1);
  if (last?.role !== 'user' || last.content.trim() !== userSlice) {
    history.push({ role: 'user', content: userSlice });
  }

  const modelResult = await callAssistantModelWithTools({
    messages: [{ role: 'system', content: systemPrompt }, ...history],
    toolCtx: toolCtx && typeof toolCtx === 'object' ? toolCtx : {},
  });

  if (uid && sessionId && modelResult.transcriptMessages?.length) {
    await saveConversationMessages(uid, sessionId, schoolId, modelResult.transcriptMessages);
  }

  if (!modelResult?.content) {
    return { modelResult, response: null };
  }

  const cleanContent = String(modelResult.content)
    .replace(/\n*(?:建議選項|建議)[：:][^\n]*/g, '')
    .trim();

  console.log(
    '[assistantCompose] modelResult.cards size:',
    Array.isArray(modelResult.cards) ? modelResult.cards.length : 'NOT_ARRAY',
    '— kinds:',
    Array.isArray(modelResult.cards) ? modelResult.cards.map((c) => c?.kind).join(',') : '',
  );
  return {
    modelResult,
    response: {
      content: cleanContent,
      suggestions: extractAssistantSuggestions(modelResult.content),
      actions: [],
      assistantToolsUsed: Array.isArray(modelResult.toolsInvoked) ? modelResult.toolsInvoked : [],
      cards: Array.isArray(modelResult.cards) ? modelResult.cards : [],
      citations: [
        ...knowledgeChunks.slice(0, 3).map((chunk) => ({
          type: chunk.scope === 'group' ? 'course' : 'system',
          id: chunk.sourceId || chunk.id,
          label: chunk.title || chunk.sourceType || 'AI 知識',
          source: chunk.source,
        })),
        ...webSourcesToCitations(webAnswer?.sources || []),
      ],
    },
  };
}

module.exports = {
  compactAssistantItems,
  buildAuthorizedAssistantContext,
  extractAssistantSuggestions,
  webSourcesToCitations,
  buildModelBackedAssistantResponse,
};
