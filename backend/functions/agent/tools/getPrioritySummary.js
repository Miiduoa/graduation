'use strict';

const { z } = require('zod');
const { formatAssistantDate } = require('../../lib/assistantFormat');

const inputSchema = z.object({}).strict();

function executeSync(ctx, rawInput) {
  inputSchema.parse(rawInput ?? {});
  const sched = ctx.prefetched?.todaySchedule;
  const assignments = ctx.prefetched?.assignments ?? [];
  const announcements = ctx.prefetched?.announcements ?? [];

  const top = assignments[0];
  const ann = announcements[0];

  return {
    classCount: Array.isArray(sched?.slots) ? sched.slots.length : 0,
    nextAssignmentTitle: top?.title ?? null,
    nextAssignmentDue: top?.dueAt ? formatAssistantDate(top.dueAt, true) : null,
    topAnnouncementTitle: ann?.title ?? null,
  };
}

async function execute(ctx, rawInput) {
  return executeSync(ctx, rawInput);
}

module.exports = {
  name: 'getPrioritySummary',
  description:
    '從 prefetch 的今日課表、作業、公告濃縮成今日重點摘要（節數、下一則作業、一則公告）。需 ctx.prefetched 已有資料；問「今天重點」「摘要」時可呼叫。',
  inputSchema,
  execute,
};
