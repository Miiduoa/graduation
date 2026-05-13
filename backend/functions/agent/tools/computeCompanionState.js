'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const {
  computeSpriteState,
} = require('../../../../packages/shared/dist-cjs/companion/spriteEngine');
const {
  computeGarden,
} = require('../../../../packages/shared/dist-cjs/companion/gardenEngine');

/**
 * computeCompanionState — Campus Companion 狀態總成
 *
 * 從 Firestore 拉最近 7 天的活動信號 + 學期課程信號 → 算出精靈狀態與花園狀態 → 一次回傳。
 *
 * 角色：只允許讀自己（學生 / 任何角色都只看自己）。教師若要看班級「氣象」走 computeGardenWeather（未來）。
 */

const inputSchema = z.object({
  days: z.number().int().min(1).max(30).default(7),
  campusWeather: z.enum(['sunny', 'cloudy', 'rainy', 'snowy', 'starry']).optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');

  const db = getFirestore();

  // 1) 7 天活動信號
  const sinceMs = Date.now() - input.days * 86_400_000;
  const signalsSnap = await db
    .collection('users')
    .doc(ctx.uid)
    .collection('companionSignals')
    .where('dateMs', '>=', sinceMs)
    .orderBy('dateMs', 'asc')
    .get()
    .catch(() => null);

  const signals = signalsSnap
    ? signalsSnap.docs.map((d) => {
        const data = d.data();
        return {
          date: data.date,
          studyMinutes: data.studyMinutes ?? 0,
          assignmentsSubmitted: data.assignmentsSubmitted ?? 0,
          materialsRead: data.materialsRead ?? 0,
          quizAttempts: data.quizAttempts ?? 0,
          attendanceCheckins: data.attendanceCheckins ?? 0,
          campusStepsEstimate: data.campusStepsEstimate ?? 0,
          campusVisitsCount: data.campusVisitsCount ?? 0,
          mealsOrdered: data.mealsOrdered ?? 0,
          distinctVendors: data.distinctVendors ?? 0,
          socialInteractions: data.socialInteractions ?? 0,
          groupOrderJoined: data.groupOrderJoined ?? 0,
          hibernated: data.hibernated ?? false,
        };
      })
    : [];

  // 2) profile
  const userSnap = await db.collection('users').doc(ctx.uid).get().catch(() => null);
  const userData = userSnap?.data() ?? {};
  const profile = {
    createdAt: userData.createdAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
    studyYear: userData.studyYear ?? 1,
    currentMonth: new Date().getMonth() + 1,
    schoolId: ctx.schoolId,
  };

  const previousVitality = userData.companionState?.vitality ?? 70;

  // 3) 精靈狀態
  const spriteState = computeSpriteState({
    signals,
    profile,
    previousVitality,
    campusWeather: input.campusWeather,
  });

  // 4) 花園狀態（從 enrollments + 各 course signals 聚合）
  // 簡化版：先從快取 doc 讀
  const gardenCacheSnap = await db
    .collection('users')
    .doc(ctx.uid)
    .collection('gardenCache')
    .doc('current')
    .get()
    .catch(() => null);
  const courseSignals = gardenCacheSnap?.exists ? gardenCacheSnap.data().courses ?? [] : [];
  const garden = computeGarden(courseSignals);

  return {
    success: true,
    summary: `${spriteState.appearance.seasonalAccessory} 季的精靈正在 ${spriteState.appearance.weatherMood} 天裡 ${spriteState.mood}；花園共 ${garden.plants.length} 株植物。`,
    sprite: spriteState,
    garden,
  };
}

module.exports = {
  name: 'computeCompanionState',
  description: '取得使用者目前的校園精靈與學習花園狀態（含季節、氣象、care hint）。',
  inputSchema,
  execute,
};
