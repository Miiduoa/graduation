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
    '取得學校近期公開公告（標題、來源、摘要、原文連結）。來源抓取失敗若有舊稿就繼續用舊稿，並說明學校網站暫時連不上；沒有舊稿時引導到該處室原始網址。不可只說「暫時抓不到」。不要把 E校園或 TronClass 個人通知混進來。',
  inputSchema,
  execute,
};
