/* eslint-disable */
/**
 * Proactive Intelligence Engine — DEPRECATED STUB
 * ═══════════════════════════════════════════════
 * 主動推播功能已整合至 SmartDashboard 的建議卡片 + proactiveAI.ts。
 * ProactiveScreen 已從導航中移除，此檔案保留型別匯出以相容殘留引用。
 */

export type NudgeType =
  | 'assignment_due'
  | 'grade_alert'
  | 'attendance_warning'
  | 'study_suggestion'
  | 'social_prompt'
  | 'weather_alert'
  | 'campus_event';

export type NudgePriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type NudgeAction = {
  label: string;
  actionId?: string;
  route?: string;
  params?: Record<string, unknown>;
};

export type SmartNudge = {
  id: string;
  type: NudgeType;
  priority: NudgePriority;
  title: string;
  body: string;
  icon?: string;
  color?: string;
  timestamp: number;
  actions: NudgeAction[];
  dismissed: boolean;
  metadata: { confidence: number; source: string; [k: string]: unknown };
};

export type ProactiveState = {
  nudges: SmartNudge[];
  lastScan: number;
  scanning: boolean;
};

export type NudgePreferences = {
  enabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  minPriority: NudgePriority;
  disabledTypes: NudgeType[];
};

export async function runProactiveScan(): Promise<SmartNudge[]> { return []; }
export async function dismissNudge(_nudgeId: string): Promise<void> {}
export async function updateNudgePreferences(_partial: Partial<NudgePreferences>): Promise<void> {}
export async function getActiveNudges(): Promise<SmartNudge[]> { return []; }
export async function clearAllNudges(): Promise<void> {}
export async function getNudgeStats(): Promise<{ total: number; dismissed: number; acted: number }> {
  return { total: 0, dismissed: 0, acted: 0 };
}
export async function triggerAttendanceNudge(_courseId: string, _courseName: string): Promise<void> {}
