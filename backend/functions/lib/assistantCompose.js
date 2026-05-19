'use strict';

const {
  buildAgentSystemPrompt,
  callAssistantModelWithTools,
} = require('../assistantAgent');

const CAMPUS_ASSISTANT_MESSAGE_WINDOW = 20;
const { tools } = require('../agent/tools/registry');
const agentCases = require('../agent/cases.json');
const { normalizeAssistantText } = require('./assistantFormat');
const {
  loadConversationMessages,
  saveConversationMessages,
} = require('./assistantConversationStore');

function compactAssistantItems(items, fields, limit = 5) {
  return (items || []).slice(0, limit).map((item) => {
    const row = { id: item.id };
    fields.forEach((field) => {
      if (item[field] != null) row[field] = item[field];
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
  pendingAssignments = [],
  weeklyReport = null,
  todaySchedule = null,
  dailyBrief = null,
}) {
  const base = {
    schoolId,
    displayName,
    actorRole,
    intent,
    announcements: compactAssistantItems(announcements, ['title', 'source', 'publishedAt'], 5),
    events: compactAssistantItems(events, ['title', 'location', 'startsAt'], 5),
    menus: compactAssistantItems(menus, ['name', 'title', 'price', 'cafeteria'], 6),
    pois: compactAssistantItems(pois, ['name', 'category', 'description', 'openingHours'], 8),
    pendingAssignments: compactAssistantItems(
      pendingAssignments,
      ['title', 'groupId', 'groupName', 'dueAt'],
      6,
    ),
    weeklyReport: weeklyReport?.summary ? { summary: weeklyReport.summary } : null,
  };

  if (todaySchedule && Array.isArray(todaySchedule.slots)) {
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
  rawMessages,
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
}) {
  const toolsForLlm = tools.filter((t) => !t.requiresConfirmation);
  const toolPromptSection = toolsForLlm.map((t) => `- ${t.name}：${t.description || t.name}`).join('\n');

  const writeDeferred = tools.filter((t) => t.requiresConfirmation === true);
  const writeToolNames = writeDeferred.map((t) => `${t.name}（${t.description || ''}）`).join('\n');
  const fewShots = Array.isArray(agentCases.writeToolFewShots) ? agentCases.writeToolFewShots : [];
  const writeFewShotBlock =
    fewShots.length > 0
      ? [
          '',
          '以下為「須使用者確認後才執行」的寫入工具名稱（不可透過 function calling 直接呼叫；由介面 queue_action 確認後由 executeAgentWrite 執行）：',
          writeToolNames,
          '',
          '寫入意圖與欄位範例（few-shot，僅供理解使用者句子 → 正確 tool 與 input 形狀）：',
          ...fewShots.map((row) => JSON.stringify(row, null, 0)),
        ].join('\n')
      : '';

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

  const norm = (s) => String(s || '').trim();
  const userSlice = normalizeAssistantText(lastUserMessage).slice(0, 1600);

  let history = [];

  if (uid && sessionId) {
    const prior = await loadConversationMessages(uid, sessionId);
    if (prior.length > 0) {
      history = prior.map((m) => {
        const row = {
          role: m.role,
          content: m.content != null ? String(m.content).slice(0, 1600) : '',
        };
        if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          row.tool_calls = m.tool_calls;
        }
        if (m.tool_call_id != null) {
          row.tool_call_id = String(m.tool_call_id);
        }
        return row;
      });
      const last = history[history.length - 1];
      if (!last || last.role !== 'user' || norm(last.content) !== norm(userSlice)) {
        history.push({ role: 'user', content: userSlice });
      }
    }
  }

  if (history.length === 0) {
    history = rawMessages
      .slice(-CAMPUS_ASSISTANT_MESSAGE_WINDOW)
      .filter((message) => message?.role === 'user' || message?.role === 'assistant')
      .map((message) => ({
        role: message.role,
        content: normalizeAssistantText(message.content).slice(0, 1600),
      }));
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: userSlice });
    }
  }

  const modelResult = await callAssistantModelWithTools({
    messages: [{ role: 'system', content: systemPrompt }, ...history],
    toolCtx: toolCtx && typeof toolCtx === 'object' ? toolCtx : {},
  });

  if (uid && sessionId && modelResult.transcriptMessages?.length) {
    await saveConversationMessages(uid, sessionId, modelResult.transcriptMessages);
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
