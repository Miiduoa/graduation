'use strict';

const { z } = require('zod');
const { fetchAssistantTodaySchedule } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  timeZone: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  return fetchAssistantTodaySchedule(ctx.uid, {
    timeZone: input.timeZone || ctx.timeZone || 'Asia/Taipei',
  });
}

module.exports = { name: 'getTodaySchedule', inputSchema, execute };
