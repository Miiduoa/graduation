'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');

const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .optional()
  .default({});

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
  if (!uid) throw new Error('listMyDormRepairs requires ctx.uid');
  if (!schoolId) throw new Error('listMyDormRepairs requires ctx.schoolId');

  const db = getFirestore();
  const snap = await db
    .collection('schools')
    .doc(schoolId)
    .collection('repairRequests')
    .where('userId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(input.limit)
    .get();

  const items = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    items.push({
      repairId: doc.id,
      status: d.status || 'unknown',
      dormitory: d.dormitory || '',
      room: d.room || '',
      category: d.category || '',
      description: typeof d.description === 'string' ? d.description.slice(0, 120) : '',
      createdAt: toIso(d.createdAt),
    });
  });

  return { items, count: items.length };
}

module.exports = {
  name: 'listMyDormRepairs',
  description: '列出目前使用者在此學校的宿舍報修紀錄（依建立時間新到舊）。',
  inputSchema,
  execute,
};
