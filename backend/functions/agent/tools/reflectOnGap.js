'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z
  .object({
    gap: z.string().max(2000).optional(),
    reason: z.string().max(2000).optional(),
    query: z.string().max(2000).optional(),
  })
  .refine(
    (d) =>
      Boolean((d.gap && String(d.gap).trim()) || (d.reason && String(d.reason).trim())),
    { message: 'gap or reason required' },
  );

/**
 * LLM 自我診斷：記錄目前工具／資料無法回答的校園相關缺口，供後台累積分析（不寫入使用者隱私內容，僅摘要）。
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const gapParts = [input.gap, input.reason].map((s) => (s != null ? String(s).trim() : '')).filter(Boolean);
  const gapStored = gapParts.join(' — ').slice(0, 2000);
  const db = getFirestore();
  const schoolKey =
    ctx.schoolId != null && String(ctx.schoolId).trim() ? String(ctx.schoolId).trim() : 'unknown';

  const ref = await db
    .collection('agent_gaps')
    .doc(schoolKey)
    .collection('gaps')
    .add({
      gap: gapStored,
      query: input.query != null ? String(input.query).slice(0, 2000) : null,
      uid: ctx.uid || null,
      intent: ctx.intent != null ? String(ctx.intent) : null,
      createdAt: FieldValue.serverTimestamp(),
    });

  return { ok: true, gapId: ref.id, schoolId: schoolKey };
}

module.exports = {
  name: 'reflectOnGap',
  description:
    '當校園相關問題無法用現有工具與資料回答時，記錄「知識／工具缺口」摘要（不蒐集敏感個資）。應先呼叫再向使用者說明已記錄需求、不編造。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
