'use strict';

const { z } = require('zod');
const { fetchAssistantPendingAssignments } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  preferredGroupId: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  return fetchAssistantPendingAssignments(ctx.uid, input.preferredGroupId || ctx.groupId);
}

module.exports = {
  name: 'getAssignments',
  description:
    '取得目前使用者的待繳／進行中作業列表（含標題、截止時間、課程群組）。詢問作業、deadline、待辦繳交時呼叫。',
  inputSchema,
  execute,
};
