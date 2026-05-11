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
    return { found: false, repairId: input.repairId, forbidden: true };
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
  description: '依 repairId 讀取單一宿舍報修狀態（僅限本人建立的報修）。',
  inputSchema,
  execute,
};
