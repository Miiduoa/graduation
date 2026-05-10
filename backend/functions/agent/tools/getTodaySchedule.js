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

module.exports = {
  name: 'getTodaySchedule',
  description:
    '取得今天的課程時間表，含課程名稱、地點、時段。使用者詢問今天有沒有課、幾點上課、今天課表時呼叫。',
  inputSchema,
  execute,
};
