/* eslint-disable */
/**
 * campusEventBus.ts — 統一事件匯流排
 *
 * 設計理念：
 * APP 內每個角色的「動作」都會產生一個事件，其他引擎可以監聽這些事件
 * 並自動做出反應。這讓功能之間不再是孤立的，而是形成有機連結。
 *
 * 範例流程：
 *   教師啟動點名 → emit('session:started')
 *     → 行事曆引擎監聽 → 自動新增「正在點名」事件
 *     → 推播引擎監聽 → 推送通知給修課學生
 *
 *   學生簽到 → emit('attendance:checked_in')
 *     → XP 引擎監聽 → +20 XP
 *     → 出席分析引擎監聽 → 重算出席率
 *     → 校園脈動引擎監聽 → 更新教室人數
 *
 *   教師評分 → emit('grade:updated')
 *     → 學業預測引擎 → 重算 GPA 趨勢
 *     → 推播引擎 → 如果 GPA 下降則推送警告
 *     → 選課推薦引擎 → 調整推薦權重
 */

// ============================================================================
// EVENT TYPES
// ============================================================================

export type CampusEvent =
  // ─── 點名相關 ───
  | {
      type: 'session:started';
      payload: {
        sessionId: string;
        courseId: string;
        courseName: string;
        teacherId: string;
        mode: string;
      };
    }
  | {
      type: 'session:ended';
      payload: {
        sessionId: string;
        courseId: string;
        presentCount: number;
        totalStudents: number;
        rate: number;
      };
    }
  | {
      type: 'attendance:checked_in';
      payload: {
        sessionId: string;
        courseId: string;
        studentId: string;
        studentName: string;
        status: 'present' | 'late';
      };
    }
  | {
      type: 'attendance:marked_absent';
      payload: { sessionId: string; studentId: string; courseId: string };
    }
  | {
      type: 'attendance:rate_warning';
      payload: { studentId: string; courseId: string; courseName: string; rate: number };
    }
  // ─── 假單相關 ───
  | {
      type: 'leave:submitted';
      payload: { requestId: string; studentId: string; courseId: string; courseName: string };
    }
  | {
      type: 'leave:reviewed';
      payload: { requestId: string; studentId: string; approved: boolean; courseId: string };
    }
  // ─── 成績相關 ───
  | {
      type: 'grade:updated';
      payload: {
        studentId: string;
        courseId: string;
        courseName: string;
        score: number;
        itemName: string;
      };
    }
  | {
      type: 'gpa:changed';
      payload: {
        studentId: string;
        oldGPA: number;
        newGPA: number;
        trend: 'up' | 'down' | 'stable';
      };
    }
  // ─── 作業相關 ───
  | {
      type: 'assignment:published';
      payload: {
        courseId: string;
        courseName: string;
        title: string;
        deadline: number;
        teacherId: string;
      };
    }
  | {
      type: 'assignment:submitted';
      payload: { studentId: string; courseId: string; activityId: string; title: string };
    }
  | {
      type: 'assignment:graded';
      payload: { studentId: string; courseId: string; title: string; score: number };
    }
  // ─── 課程相關 ───
  | {
      type: 'course:enrolled';
      payload: { studentId: string; courseId: string; courseName: string };
    }
  | { type: 'course:created'; payload: { courseId: string; courseName: string; teacherId: string } }
  | {
      type: 'course:approved';
      payload: { courseId: string; courseName: string; approvedBy: string };
    }
  // ─── 社交相關 ───
  | { type: 'group:joined'; payload: { userId: string; groupId: string; groupName: string } }
  | { type: 'buddy:matched'; payload: { studentA: string; studentB: string; courseId: string } }
  | { type: 'post:created'; payload: { userId: string; groupId: string; postId: string } }
  // ─── 校園生活 ───
  | { type: 'cafeteria:order_placed'; payload: { userId: string; vendorId: string; total: number } }
  | {
      type: 'lostfound:posted';
      payload: { userId: string; itemId: string; type: 'lost' | 'found' };
    }
  | { type: 'crowd:reported'; payload: { userId: string; poiId: string; level: number } }
  // ─── 系統 / XP ───
  | {
      type: 'xp:earned';
      payload: {
        userId: string;
        action: string;
        amount: number;
        newTotal: number;
        newLevel: number;
      };
    }
  | {
      type: 'achievement:unlocked';
      payload: { userId: string; achievementId: string; title: string };
    }
  | { type: 'streak:updated'; payload: { userId: string; days: number; isAtRisk: boolean } }
  | { type: 'nudge:triggered'; payload: { userId: string; nudgeType: string; message: string } }
  // ─── 登入後資料路由（舊版關聯圖 + 新版 context 就緒）──
  | {
      type: 'post_login_data_routed';
      payload: {
        role: string;
        courseCount: number;
        classmateCount: number;
        studentCount: number;
        teacherCount: number;
      };
    }
  | {
      type: 'role_updated';
      payload: { previousRole: string; newRole: string; reason: string };
    }
  | {
      type: 'post_login_context_ready';
      payload: {
        schoolId: string;
        role: string;
        roleSource: string;
        courseCount: number;
        pendingAssignmentCount: number;
        teachingCourseCount: number;
        studentRosterApprox: number;
        builtAt: string;
      };
    }
  // ─── 通用 ───
  | { type: 'user:daily_login'; payload: { userId: string; role: string; timestamp: number } };

export type CampusEventType = CampusEvent['type'];

// Extract payload type for a given event type
export type PayloadOf<T extends CampusEventType> = Extract<CampusEvent, { type: T }>['payload'];

// ============================================================================
// EVENT BUS IMPLEMENTATION
// ============================================================================

type Listener<T extends CampusEventType = CampusEventType> = (
  payload: PayloadOf<T>,
) => void | Promise<void>;

class CampusEventBusImpl {
  private listeners = new Map<string, Set<Listener<any>>>();
  private history: CampusEvent[] = [];
  private maxHistory = 100;

  /**
   * 訂閱事件
   * @returns unsubscribe function
   */
  on<T extends CampusEventType>(type: T, listener: Listener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  /**
   * 一次性監聽（觸發一次後自動取消）
   */
  once<T extends CampusEventType>(type: T, listener: Listener<T>): () => void {
    const unsub = this.on(type, (payload) => {
      unsub();
      listener(payload);
    });
    return unsub;
  }

  /**
   * 發射事件 — 所有監聽者非同步執行
   */
  emit<T extends CampusEventType>(type: T, payload: PayloadOf<T>): void {
    const event = { type, payload } as CampusEvent;

    // Record history
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Notify listeners
    const set = this.listeners.get(type);
    if (set) {
      set.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.warn(`[EventBus] Error in listener for "${type}":`, e);
        }
      });
    }

    // Also notify wildcard listeners
    const wildcardSet = this.listeners.get('*');
    if (wildcardSet) {
      wildcardSet.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.warn(`[EventBus] Error in wildcard listener:`, e);
        }
      });
    }
  }

  /**
   * 監聽所有事件（debug / analytics 用）
   */
  onAll(listener: (event: CampusEvent) => void): () => void {
    if (!this.listeners.has('*')) {
      this.listeners.set('*', new Set());
    }
    const wrappedListener = (payload: any) => {
      // For wildcard, we pass the full event from history
      const lastEvent = this.history[this.history.length - 1];
      if (lastEvent) listener(lastEvent);
    };
    this.listeners.get('*')!.add(wrappedListener);
    return () => {
      this.listeners.get('*')?.delete(wrappedListener);
    };
  }

  /**
   * 取得最近 N 筆事件歷史
   */
  getHistory(n = 20): CampusEvent[] {
    return this.history.slice(-n);
  }

  /**
   * 取得特定類型的歷史事件
   */
  getHistoryByType<T extends CampusEventType>(type: T, n = 10): PayloadOf<T>[] {
    return this.history
      .filter((e) => e.type === type)
      .slice(-n)
      .map((e) => e.payload as PayloadOf<T>);
  }

  /**
   * 清空所有監聽器（用於測試或 reset）
   */
  clear(): void {
    this.listeners.clear();
    this.history = [];
  }
}

// Singleton
export const campusEventBus = new CampusEventBusImpl();

// ============================================================================
// CONVENIENCE EMITTERS — 讓各引擎用起來更簡潔
// ============================================================================

export const emitAttendanceCheckedIn = (p: PayloadOf<'attendance:checked_in'>) =>
  campusEventBus.emit('attendance:checked_in', p);

export const emitSessionStarted = (p: PayloadOf<'session:started'>) =>
  campusEventBus.emit('session:started', p);

export const emitSessionEnded = (p: PayloadOf<'session:ended'>) =>
  campusEventBus.emit('session:ended', p);

export const emitGradeUpdated = (p: PayloadOf<'grade:updated'>) =>
  campusEventBus.emit('grade:updated', p);

export const emitLeaveReviewed = (p: PayloadOf<'leave:reviewed'>) =>
  campusEventBus.emit('leave:reviewed', p);

export const emitAssignmentPublished = (p: PayloadOf<'assignment:published'>) =>
  campusEventBus.emit('assignment:published', p);

export const emitAssignmentSubmitted = (p: PayloadOf<'assignment:submitted'>) =>
  campusEventBus.emit('assignment:submitted', p);

export const emitXPEarned = (p: PayloadOf<'xp:earned'>) => campusEventBus.emit('xp:earned', p);

export const emitNudgeTriggered = (p: PayloadOf<'nudge:triggered'>) =>
  campusEventBus.emit('nudge:triggered', p);

export const emitDailyLogin = (p: PayloadOf<'user:daily_login'>) =>
  campusEventBus.emit('user:daily_login', p);

export const emitCrowdReported = (p: PayloadOf<'crowd:reported'>) =>
  campusEventBus.emit('crowd:reported', p);
