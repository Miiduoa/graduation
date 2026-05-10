'use strict';

const { z } = require('zod');
const { fetchAssistantAnnouncements } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  schoolId: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const sid = input.schoolId || ctx.schoolId;
  return fetchAssistantAnnouncements(sid);
}

module.exports = { name: 'getAnnouncements', inputSchema, execute };
