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

module.exports = {
  name: 'getAnnouncements',
  description:
    '取得學校近期公告列表（標題、來源、發布時間）。使用者問公告、通知、校園消息時呼叫；schoolId 可省略（沿用登入學校）。',
  inputSchema,
  execute,
};
