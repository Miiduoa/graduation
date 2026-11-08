'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');

const inputSchema = z.object({
  repairId: z.string().min(1),
});

function toIso(v) {
  if (!v) return null;
  try {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
  } catch {
    /* ignore */
  }
  return null;
}

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('getDormRepairStatus requires ctx.uid');
  if (!schoolId) throw new Error('getDormRepairStatus requires ctx.schoolId');

  const db = getFirestore();
  const ref = db.collection('schools').doc(schoolId).collection('repairRequests').doc(input.repairId);
  const doc = await ref.get();
  if (!doc.exists) {
    return { found: false, repairId: input.repairId };
  }
  const d = doc.data() || {};
  if (String(d.userId || '') !== String(uid)) {
    return { found: false, repairId: input.repairId };
  }

  return {
    found: true,
    repairId: doc.id,
    status: d.status || 'unknown',
    dormitory: d.dormitory || '',
    room: d.room || '',
    category: d.category || '',
    description: typeof d.description === 'string' ? d.description.slice(0, 400) : '',
    urgency: d.urgency || null,
    createdAt: toIso(d.createdAt),
  };
}

module.exports = {
  name: 'getDormRepairStatus',
  description: '依內部識別 repairId 讀取本人宿舍報修備忘。repairId 不是校方單號，請勿向使用者說成單號或工單。',
  inputSchema,
  execute,
};
