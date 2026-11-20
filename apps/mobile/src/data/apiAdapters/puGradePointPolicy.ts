/**
 * 靜宜大學成績等第績點換算（本機參考用）。
 *
 * 一級來源頁：https://dorac.pu.edu.tw/p/412-1059-2390.php?Lang=zh-tw
 * 現行學則 PDF：https://dorac.pu.edu.tw/var/file/59/1059/img/441/0101.pdf
 * 文件：PU-101B0-B-0101-2026020901，版本 51，修訂 2026-02-09
 * 對照：第 5–6 頁／第 25 條（百分制預設；學士及格 60、碩士及格 70；
 * P／通過計學分、I／未通過不計；符號通過／未通過不納入學業平均；
 * 學業平均含全部修習科目、重修不剔除；官方績點對照表如下）。
 *
 * 此模組僅供 adapter 邊界將百分制分數轉成參考績點，不宣稱正式累計 GPA。
 */

export const PU_GRADE_POINT_POLICY = {
  institution: 'Providence University',
  documentId: 'PU-101B0-B-0101-2026020901',
  version: 51,
  revisedOn: '2026-02-09',
  regulationsIndexUrl: 'https://dorac.pu.edu.tw/p/412-1059-2390.php?Lang=zh-tw',
  regulationsPdfUrl: 'https://dorac.pu.edu.tw/var/file/59/1059/img/441/0101.pdf',
  /** 官方對照表為 4.3 制 */
  gradePointScale: 4.3 as const,
  undergraduatePassScore: 60,
  graduatePassScore: 70,
} as const;

export type PuGradePointScale = typeof PU_GRADE_POINT_POLICY.gradePointScale;

/** 分數須為有限且落在 0..100，否則不可換算。 */
export function isConvertiblePuPercentScore(score: number): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

/**
 * 官方百分制 → 4.3 制績點。
 * 無效分數回傳 null（不捏造 0）。
 */
export function convertPuPercentScoreToGradePoint(score: number): number | null {
  if (!isConvertiblePuPercentScore(score)) return null;
  if (score >= 90) return 4.3;
  if (score >= 85) return 4.0;
  if (score >= 80) return 3.7;
  if (score >= 77) return 3.3;
  if (score >= 73) return 3.0;
  if (score >= 70) return 2.7;
  if (score >= 67) return 2.3;
  if (score >= 63) return 2.0;
  if (score >= 60) return 1.7;
  if (score >= 57) return 1.3;
  if (score >= 53) return 1.0;
  if (score >= 50) return 0.7;
  return 0;
}
