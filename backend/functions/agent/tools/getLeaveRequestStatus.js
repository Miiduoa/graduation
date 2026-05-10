'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { toJsDate } = require('../../lib/assistantFormat');

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

function serializeCreatedAt(v) {
  const d = toJsDate(v);
  return d ? d.toISOString() : null;
}

/**
 * 讀取目前使用者的請假申請（最新幾筆），供助理回覆審核狀態查詢。
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  if (!uid) {
    throw new Error('getLeaveRequestStatus requires ctx.uid');
  }

  const limit = input.limit ?? 10;
  const db = getFirestore();
  const snap = await db
    .collection('leaveRequests')
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const items = snap.docs.map((doc) => {
    const d = doc.data() || {};
    const row = {
      requestId: doc.id,
      date: d.date != null ? String(d.date) : '',
      type: d.type != null ? String(d.type) : '',
      status: d.status != null ? String(d.status) : '',
      courseId: d.courseId != null ? String(d.courseId) : '',
      createdAt: serializeCreatedAt(d.createdAt),
    };
    if (d.groupId != null && String(d.groupId).trim()) {
      row.groupId = String(d.groupId);
    }
    return row;
  });

  return { items, count: items.length };
}

module.exports = {
  name: 'getLeaveRequestStatus',
  description:
    '查詢目前登入使用者的請假申請狀態（日期、假別、審核狀態 pending/approved/rejected 等）。使用者問「老師有審核嗎」「請假通過了嗎」「假單狀態」時呼叫。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
