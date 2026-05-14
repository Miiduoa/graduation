/**
 * Learning Risk Service — wires riskRadar 引擎到 mobile 端
 *
 * 提供：
 *  - fetchStudentRiskRadar(uid) — 從 courseSpaceSource 拉每門課的 risk 輸入 → 計算 → 回傳
 *  - notifyIfCritical(snapshot) — 若整體 critical，呼叫 proactiveAI 用 wellbeing 文案發本地通知
 */

import {
  computeStudentRiskRadar,
  type CourseRiskInput,
  type StudentRiskRadarResult,
} from '@campus/shared';
import {
  listCourseSpaces,
  listInboxTasks,
} from '../data/courseSpaceSource';
import { getDataSource } from '../data/source';
import { recordCompanionEvent } from './companionSignalRecorder';

export async function fetchStudentRiskRadar(
  userId: string,
  schoolId?: string,
): Promise<StudentRiskRadarResult> {
  const spaces = await listCourseSpaces(userId, schoolId);
  if (spaces.length === 0) {
    return { overallLevel: 'low', perCourse: [], topConcerns: [] };
  }

  const ds = getDataSource();
  const courseInputs: CourseRiskInput[] = [];
  const now = Date.now();
  const sevenDayMs = 7 * 86_400_000;

  for (const cs of spaces) {
    const courseId = cs.id;
    // 從現有 source 抓資料；若 method 缺，給保守值
    const grades = (await ds.listGrades?.(userId).catch(() => [])) ?? [];
    const matchingGrade = grades.find((g) => g.courseId === cs.courseId);
    const inboxTasks = await listInboxTasks(userId, schoolId).catch(() => []);
    const overdueForThisCourse = inboxTasks.filter(
      (t) => t.groupId === courseId && t.priority >= 3,
    );
    courseInputs.push({
      courseId,
      courseName: cs.name,
      attendanceRate: 0.8, // TODO: 用 listAttendanceSessions 細算
      missedAssignments: overdueForThisCourse.length,
      totalAssignments: cs.assignmentCount || overdueForThisCourse.length + 1,
      lowQuizScores: 0, // TODO: 接 quizAttempts < 60
      daysSinceLastActivity: cs.latestDueAt
        ? Math.max(0, Math.floor((now - cs.latestDueAt.getTime()) / 86_400_000))
        : 1,
      currentScore: matchingGrade?.score ?? null,
    });
    void sevenDayMs;
  }
  return computeStudentRiskRadar(courseInputs);
}

/**
 * 若整體 critical → 發本地通知 + 寫 companion 事件，讓精靈下次 careHint 變嚴肅。
 * 文案套 wellbeing 模板：同理 → CTA → 簡短建議
 */
export async function notifyIfCritical(
  snapshot: StudentRiskRadarResult,
  notify: (input: { title: string; body: string }) => void,
  uid?: string,
): Promise<void> {
  if (snapshot.overallLevel !== 'critical') return;
  const top = snapshot.perCourse[0];
  notify({
    title: '精靈想跟你聊一下',
    body: top
      ? `${top.courseName} 最近狀況有點吃緊，要不要先跟導師或諮商中心聊聊？`
      : '最近功課負荷有點重，今天先休息一下也沒關係。',
  });
  await recordCompanionEvent('inbox_action_taken', {
    uid,
    payload: { source: 'risk_radar_critical' },
  });
}
