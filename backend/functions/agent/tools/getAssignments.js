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

module.exports = { name: 'getAssignments', inputSchema, execute };
