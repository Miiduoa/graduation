'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { computeGradebook } = require('../../../../packages/shared/dist-cjs/lms/gradebookCompute');

/**
 * computeGradebook (read) — 教師 / 學生查看某課程成績簿。
 *
 * 學生角色：只回自己那一列 + 班級平均（其他人匿名）
 * 教師角色：回完整 rows
 *
 * Firestore 結構（與 INTEGRATION_MAP §6.2 對齊）：
 *   schools/{schoolId}/courseSpaces/{courseId}/gradeItems/{gradeItemId}
 *   schools/{schoolId}/courseSpaces/{courseId}/gradebookEntries/{uid}
 *     ↳ { scores: [{ gradeItemId, score, isLate, excused }], displayName }
 */

const inputSchema = z.object({
  courseSpaceId: z.string(),
  published: z.boolean().optional(),
  passingScore: z.number().min(0).max(100).optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (!ctx.schoolId) throw new Error('school_required');

  const db = getFirestore();
  const courseRef = db
    .collection('schools')
    .doc(ctx.schoolId)
    .collection('courseSpaces')
    .doc(input.courseSpaceId);

  const [itemsSnap, entriesSnap] = await Promise.all([
    courseRef.collection('gradeItems').get(),
    courseRef.collection('gradebookEntries').get(),
  ]);

  const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const students = entriesSnap.docs.map((d) => ({
    uid: d.id,
    displayName: d.data().displayName ?? '匿名',
    scores: Array.isArray(d.data().scores) ? d.data().scores : [],
  }));

  const result = computeGradebook(items, students, {
    passingScore: input.passingScore,
    published: input.published ?? false,
  });

  // 角色過濾：學生只看到自己
  const isTeacher = ctx.role === 'teacher' || ctx.role === 'admin';
  if (!isTeacher) {
    const myRow = result.rows.find((r) => r.uid === ctx.uid);
    return {
      success: true,
      summary: myRow
        ? `你目前的加權成績 ${myRow.finalScore ?? '尚未計算'} ${myRow.passed ? '✅ 已通過' : '⚠️ 尚未通過'}。`
        : '尚未在成績簿建立你的記錄。',
      gradebook: {
        ...result,
        rows: myRow ? [myRow] : [],
      },
    };
  }

  return {
    success: true,
    summary: `班級平均 ${result.classAverage ?? 'N/A'}，通過率 ${result.passRate ?? 'N/A'}%（${result.rows.length} 人）。`,
    gradebook: result,
  };
}

module.exports = {
  name: 'computeGradebook',
  description: '依加權設定計算並回傳課程成績簿。學生只看到自己的列，教師看完整列表。',
  inputSchema,
  execute,
};
