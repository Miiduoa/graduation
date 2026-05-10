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

module.exports = { name: 'getPrioritySummary', inputSchema, execute };
