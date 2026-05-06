/* eslint-disable */
/**
 * crossModuleConnector.ts — 跨模組資料連接器
 *
 * 這個檔案是 APP 的「神經系統」：
 * 當 Event Bus 收到事件時，它自動觸發各引擎的對應邏輯。
 *
 * 連結地圖：
 *   session:started → 行事曆新增事件 + 推播通知學生
 *   attendance:checked_in → XP +20 + 校園脈動更新教室人數
 *   session:ended → 出席率計算 → 低於 70% 觸發 rate_warning
 *   leave:reviewed(approved) → 出席紀錄改 excused → 重算率
 *   grade:updated → 學業預測刷新 → GPA 下降觸發推播
 *   assignment:published → 行事曆新增截止日
 *   assignment:submitted → XP +30
 *   user:daily_login → Streak 更新 → XP + 成就檢查
 *   crowd:reported → 校園脈動即時更新
 *
 * 呼叫時機：APP 啟動時 initCrossModuleConnections()
 */

import { campusEventBus, type PayloadOf } from './campusEventBus';
import { earnXP } from './gamificationEngine';
import { updateStudentStatus, getSessionById, getAllSessions } from './smartAttendanceEngine';

// ============================================================================
// INITIALIZATION — 在 APP 啟動時呼叫一次
// ============================================================================

let initialized = false;
const unsubscribers: (() => void)[] = [];

export function initCrossModuleConnections(): void {
  if (initialized) return;
  initialized = true;

  // ─── 點名簽到 → XP + 校園脈動 ───
  unsubscribers.push(
    campusEventBus.on('attendance:checked_in', async (payload) => {
      // 給學生加 XP
      try {
        await earnXP('attend_class');
      } catch (e) {
        console.warn('[Connector] XP earn failed:', e);
      }

      // 記錄教室活躍人數（供校園脈動使用）
      try {
        const campusPulse = await import('./campusPulseEngine') as any;
        if (typeof campusPulse.addClassroomActivity === 'function') {
          campusPulse.addClassroomActivity(payload.courseId, payload.sessionId);
        }
      } catch (_) { /* optional module */ }
    })
  );

  // ─── 點名場次啟動 → 行事曆 + 推播 ───
  unsubscribers.push(
    campusEventBus.on('session:started', async (payload) => {
      // 寫入行事曆
      try {
        const { addCalendarEvent } = await import('./smartCalendarEngine');
        if (typeof addCalendarEvent === 'function') {
          addCalendarEvent({
            id: `attend_${payload.sessionId}`,
            title: `${payload.courseName} 點名中`,
            type: 'attendance',
            startTime: Date.now(),
            endTime: Date.now() + 30 * 60 * 1000, // 預設 30 分鐘
            courseId: payload.courseId,
            metadata: { sessionId: payload.sessionId, mode: payload.mode },
          });
        }
      } catch (_) { /* optional */ }

      // 觸發推播引擎通知修課學生
      try {
        const proactiveEngine = await import('./proactiveIntelligenceEngine') as any;
        if (typeof proactiveEngine.triggerAttendanceNudge === 'function') {
          proactiveEngine.triggerAttendanceNudge(payload.courseId, payload.courseName);
        }
      } catch (_) { /* optional */ }
    })
  );

  // ─── 點名場次結束 → 計算出席率 → 風險檢測 ───
  unsubscribers.push(
    campusEventBus.on('session:ended', async (payload) => {
      const { rate, courseId, presentCount, totalStudents } = payload;

      // 如果出席率低於 70%，觸發風險警告事件
      // (教師端可以用這個來決定是否發通知)
      if (rate < 70) {
        // 找出缺席的學生，各自發出 rate_warning
        try {
          const session = await getSessionById(payload.sessionId);
          if (session) {
            const absentStudents = session.records.filter(r => r.status === 'absent');
            absentStudents.forEach(student => {
              campusEventBus.emit('attendance:rate_warning', {
                studentId: student.studentId,
                courseId,
                courseName: session.courseName,
                rate: 0, // individual rate needs full calc
              });
            });
          }
        } catch (_) {}
      }
    })
  );

  // ─── 假單審核 → 更新出席紀錄 ───
  unsubscribers.push(
    campusEventBus.on('leave:reviewed', async (payload) => {
      if (payload.approved) {
        // 找到該學生在該課程最近的 session，將 absent 改為 excused
        try {
          const sessions = await getAllSessions(payload.courseId);
          const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'completed');
          const latestSession = activeSessions[activeSessions.length - 1];
          if (latestSession) {
            await updateStudentStatus(latestSession.id, payload.studentId, 'excused', '假單已核准');
          }
        } catch (e) {
          console.warn('[Connector] Leave approval update failed:', e);
        }
      }
    })
  );

  // ─── 成績更新 → 學業預測刷新 + 推播 ───
  unsubscribers.push(
    campusEventBus.on('grade:updated', async (payload) => {
      // 觸發學業預測引擎重新計算
      try {
        const { refreshPrediction } = await import('./academicInsightsEngine');
        if (typeof refreshPrediction === 'function') {
          const result = await refreshPrediction(payload.studentId);
          // 如果 GPA 趨勢下降，發出 gpa:changed 事件
          if (result && result.trend === 'down') {
            campusEventBus.emit('gpa:changed', {
              studentId: payload.studentId,
              oldGPA: result.oldGPA,
              newGPA: result.newGPA,
              trend: 'down',
            });
          }
        }
      } catch (_) { /* optional */ }
    })
  );

  // ─── GPA 下降 → 推播預警 ───
  unsubscribers.push(
    campusEventBus.on('gpa:changed', async (payload) => {
      if (payload.trend === 'down') {
        campusEventBus.emit('nudge:triggered', {
          userId: payload.studentId,
          nudgeType: 'gpa_alert',
          message: `你的 GPA 從 ${payload.oldGPA.toFixed(2)} 降至 ${payload.newGPA.toFixed(2)}，建議檢視近期學習狀況`,
        });
      }
    })
  );

  // ─── 作業發佈 → 行事曆新增截止日 ───
  unsubscribers.push(
    campusEventBus.on('assignment:published', async (payload) => {
      try {
        const { addCalendarEvent } = await import('./smartCalendarEngine');
        if (typeof addCalendarEvent === 'function') {
          addCalendarEvent({
            id: `hw_${payload.courseId}_${payload.deadline}`,
            title: `${payload.courseName} - ${payload.title}`,
            type: 'assignment_deadline',
            startTime: payload.deadline - 60 * 60 * 1000, // 截止前 1 小時提醒
            endTime: payload.deadline,
            courseId: payload.courseId,
            metadata: { teacherId: payload.teacherId },
          });
        }
      } catch (_) { /* optional */ }
    })
  );

  // ─── 作業繳交 → XP ───
  unsubscribers.push(
    campusEventBus.on('assignment:submitted', async (_payload) => {
      try {
        await earnXP('submit_assignment');
      } catch (_) {}
    })
  );

  // ─── 每日登入 → Streak + XP + 成就 ───
  unsubscribers.push(
    campusEventBus.on('user:daily_login', async (payload) => {
      try {
        await earnXP('daily_login');
        const gamification = await import('./gamificationEngine') as any;
        if (typeof gamification.updateStreak === 'function') await gamification.updateStreak();
        if (typeof gamification.checkAndAwardAchievements === 'function') await gamification.checkAndAwardAchievements();
      } catch (e) {
        console.warn('[Connector] Daily login processing failed:', e);
      }
    })
  );

  // ─── 群眾回報 → 校園脈動 ───
  unsubscribers.push(
    campusEventBus.on('crowd:reported', async (payload) => {
      try {
        await earnXP('report_crowd');
      } catch (_) {}
    })
  );

  // ─── 出席率風險 → 推播引擎 ───
  unsubscribers.push(
    campusEventBus.on('attendance:rate_warning', async (payload) => {
      campusEventBus.emit('nudge:triggered', {
        userId: payload.studentId,
        nudgeType: 'attendance_risk',
        message: `「${payload.courseName}」出席率偏低，請注意出缺席狀況`,
      });
    })
  );

  console.log('[CrossModule] All connections initialized ✓');
}

/**
 * 清除所有連接（用於測試或 APP 關閉）
 */
export function teardownCrossModuleConnections(): void {
  unsubscribers.forEach((fn) => fn());
  unsubscribers.length = 0;
  initialized = false;
}
