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

module.exports = { name: 'searchCampusDocs', inputSchema, execute };
