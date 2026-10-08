'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { fetchAssistantAnnouncements } = require('../../lib/assistantFetchers');

const inputSchema = z.object({
  schoolId: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.schoolId || (input.schoolId && input.schoolId !== ctx.schoolId)) {
    throw new HttpsError('permission-denied', 'Announcement school must match the current context');
  }
  return fetchAssistantAnnouncements(ctx.schoolId);
}

module.exports = {
  name: 'getAnnouncements',
  description:
    '取得學校近期公告列表（標題、來源、發布時間）。使用者問公告、通知、校園消息時呼叫；schoolId 可省略（沿用登入學校）。',
  inputSchema,
  execute,
};
