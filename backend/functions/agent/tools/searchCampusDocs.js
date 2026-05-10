'use strict';

const { z } = require('zod');
const { fetchAssistantKnowledgeChunks } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  query: z.string().min(1).max(500),
});

/** RAG 唯一入口：校園／課程知識檢索 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  return fetchAssistantKnowledgeChunks({
    uid: ctx.uid,
    schoolId: ctx.schoolId,
    groupId: ctx.groupId,
    queryText: input.query,
  });
}

module.exports = {
  name: 'searchCampusDocs',
  description:
    '校園／課程知識 RAG 檢索。使用者問規定、辦法、校園知識且結構化上下文不足時，用簡短 query 檢索相關片段。',
  inputSchema,
  execute,
};
