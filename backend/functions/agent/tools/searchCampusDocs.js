'use strict';

const { z } = require('zod');
const { fetchAssistantKnowledgeChunks } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  query: z.string().trim().min(1),
});

/**
 * RAG 入口；校內無命中時 lazy-require answerWithServerWebSearch 作公開網路補充。
 * @returns {{ campusChunks: Array, webFallback: null | { content: string, sources: Array, confidence?: string } }}
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  // Search has a smaller budget than the conversation; retain the user's full message.
  const query = input.query.slice(0, 500);
  const campusChunks = await fetchAssistantKnowledgeChunks({
    uid: ctx.uid,
    schoolId: ctx.schoolId,
    groupId: ctx.groupId,
    queryText: query,
  });

  if (campusChunks.length > 0) {
    return { campusChunks, webFallback: null };
  }

  const { answerWithServerWebSearch } = require('../../assistantAgent');
  const webAnswer = await answerWithServerWebSearch(query).catch(() => null);
  if (!webAnswer || !webAnswer.content) {
    return { campusChunks: [], webFallback: null };
  }

  return {
    campusChunks: [],
    webFallback: {
      content: webAnswer.content,
      sources: webAnswer.sources || [],
      confidence: webAnswer.confidence,
    },
  };
}

module.exports = {
  name: 'searchCampusDocs',
  description:
    '搜尋校園知識庫（公告、規章、FAQ）。若校內無結果，會自動查詢公開網路資料。遇到校規、請假規定、選課限制等問題優先呼叫此工具。',
  inputSchema,
  execute,
};
