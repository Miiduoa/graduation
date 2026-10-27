'use strict';

const { z } = require('zod');
const { createHash, randomUUID } = require('node:crypto');
const { getFirestore } = require('firebase-admin/firestore');
const { createSubmitLeaveHandler } = require('../../leaveRequests');
const { assertServiceScope } = require('./serviceWriteGuard');

const inputSchema = z.object({
  courseId: z.string().min(1).max(100),
  date: z.string().min(1).max(10),
  type: z.string().min(1).max(30),
});
const kindByLabel = {
  病假: 'sick', 事假: 'personal', 家庭照顧假: 'family', 公假: 'official',
  生理假: 'menstrual', 心理健康假: 'mental', 喪假: 'bereavement', 其他: 'other',
};

// Agent 與一般請假表單共用本人課表、校籍及原子寫入，不能另建無法核閱的舊格式。
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const requestKey = typeof ctx.agentActionKey === 'string' ? ctx.agentActionKey : randomUUID();
  const requestId = 'agent-leave-' + createHash('sha256')
    .update(JSON.stringify([ctx.uid, ctx.schoolId, requestKey])).digest('hex').slice(0, 32);
  const result = await createSubmitLeaveHandler({ db: getFirestore() })({
    auth: { uid: ctx.uid },
    data: {
      schoolId: ctx.schoolId, requestId, startDate: input.date, endDate: input.date,
      kind: kindByLabel[input.type] || input.type, period: 'all', detail: '',
      courseIds: [input.courseId],
    },
  });
  return { requestId: result.id, status: 'pending', alreadySubmitted: result.alreadySubmitted };
}

module.exports = {
  name: 'submitLeaveRequest',
  description: '使用者確認後，依本人在該校已儲存的課表建立 Campus One 待審請假申請。',
  inputSchema, execute, requiresConfirmation: true,
};
