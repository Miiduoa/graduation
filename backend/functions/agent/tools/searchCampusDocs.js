'use strict';

const { z } = require('zod');
const { fetchAssistantKnowledgeChunks } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  query: z.string().trim().min(1),
});

/**
 * RAG 入口，維持校內檢索範圍。公開網路檢索由伺服器依使用者問題處理。
 * @returns {{ campusChunks: Array, webFallback: null }}
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

  return { campusChunks, webFallback: null };
}

module.exports = {
  name: 'searchCampusDocs',
  description:
    '搜尋校園知識庫（公告、規章、FAQ）。遇到校規、請假規定、選課限制等問題優先呼叫此工具。查無資料時回傳空結果。',
  inputSchema,
  execute,
};
