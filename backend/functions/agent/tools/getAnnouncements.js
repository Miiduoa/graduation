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
    '取得學校近期公開公告（標題、來源、摘要、原文連結）。來源抓取失敗要標「暫時抓不到」，不要把過期稿當成新公告；沒有可顯示的稿時引導到該處室原始網址。不要把 E校園或 TronClass 個人通知混進來。',
  inputSchema,
  execute,
};
