/**
 * Dynamic Quiet Hours — 依角色 + 課表 + 用餐尖峰動態判斷不打擾時段
 *
 * 為什麼存在：
 *   原本 aiSkillApplicator 的 quiet hours 寫死 22:00-08:00。
 *   但真實情境下使用者上課中、用餐尖峰、運動課時段、自訂的「禁打擾窗口」
 *   都應該被尊重。這個 service 用純函式把這些 cases 統一處理。
 *
 * 設計：
 *   - 純函式，無 storage / 網路副作用
 *   - 接 weeklyBusySlots[168] 表示一週每小時是否忙（true = 忙 = 不打擾）
 *   - 角色不同有不同的 default 用餐 / 工作尖峰
 *   - 同時支援 user 自訂 customWindows（覆寫預設）
 *
 * 應用：
 *   evaluateGuardrails 可選擇性接收 DynamicQuietHoursContext，
 *   若該時段是 quiet → 跟 G5 同樣阻擋（critical 例外）
 *
 * 真實對應：見 docs/USER_JOURNEY_REALITY_2026_05_15.md
 */

export type QuietHoursRole = 'student' | 'teacher' | 'ta' | 'department' | 'vendor';

export type QuietHoursReason =
  | 'static_night'      // 22:00-08:00 固定靜音
  | 'in_class'          // weeklyBusySlots[currentSlot] === true
  | 'meal_peak'         // vendor: 早午餐尖峰；student/teacher: 用餐時段
  | 'custom_window'     // 使用者自訂
  | 'open';             // 可以推播

export interface QuietWindow {
  /** 0-23 小時（含） */
  startHour: number;
  /** 0-23 小時（不含），跨午夜可以 startHour > endHour */
  endHour: number;
  /** 0-6, 0=週日；不指定 = 全週 */
  days?: number[];
  /** 描述（給 UI / audit log） */
  label?: string;
}

export interface DynamicQuietHoursContext {
  role: QuietHoursRole;
  /**
   * 每週每小時 busy 狀態，索引 = day * 24 + hour，0=週日 00:00
   * undefined → 不考慮課表
   */
  weeklyBusySlots?: boolean[];
  /** 當前時間，預設 new Date() */
  now?: Date;
  /** 使用者自訂的禁打擾窗口（覆寫預設） */
  customWindows?: QuietWindow[];
  /** 例外：critical 嚴重度依然會推播；預設 false */
  isCritical?: boolean;
}

export interface QuietHoursVerdict {
  isQuiet: boolean;
  reason: QuietHoursReason;
  /** 給 UI / audit 用的人話解釋 */
  explanation: string;
  /** 距離下次 open 還有多久（毫秒） */
  msUntilOpen?: number;
}

// ─────────────────────────────────────────────────────────
// 角色預設用餐尖峰（24h 制 hour ranges）
// ─────────────────────────────────────────────────────────

const ROLE_MEAL_PEAKS: Record<QuietHoursRole, QuietWindow[]> = {
  vendor: [
    { startHour: 7, endHour: 10, label: '早餐尖峰' },
    { startHour: 11, endHour: 14, label: '午餐尖峰' },
    { startHour: 17, endHour: 19, label: '晚餐尖峰' },
  ],
  student: [
    { startHour: 12, endHour: 13, label: '用餐時段' },
  ],
  teacher: [
    { startHour: 12, endHour: 13, label: '用餐時段' },
  ],
  ta: [],
  department: [],
};

// ─────────────────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────────────────

export function isHourInWindow(hour: number, dayOfWeek: number, w: QuietWindow): boolean {
  if (w.days && !w.days.includes(dayOfWeek)) return false;
  // 跨午夜窗口（如 22 -> 6）
  if (w.startHour > w.endHour) {
    return hour >= w.startHour || hour < w.endHour;
  }
  return hour >= w.startHour && hour < w.endHour;
}

export function isInStaticNight(hour: number): boolean {
  // 22:00-08:00 預設靜音
  return hour >= 22 || hour < 8;
}

/**
 * 將「現在」對應到 weeklyBusySlots 的 index
 */
export function currentWeekSlotIndex(now: Date): number {
  const day = now.getDay(); // 0=Sun
  const hour = now.getHours();
  return day * 24 + hour;
}

// ─────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────

export function isInDynamicQuietHours(ctx: DynamicQuietHoursContext): QuietHoursVerdict {
  const now = ctx.now ?? new Date();
  const hour = now.getHours();
  const day = now.getDay();

  // critical 動作不受 quiet hours 限制（與既有 G5 行為一致）
  if (ctx.isCritical) {
    return {
      isQuiet: false,
      reason: 'open',
      explanation: 'critical 嚴重度動作不受 quiet hours 限制',
    };
  }

  // 1. 自訂窗口優先（覆寫所有預設）
  if (ctx.customWindows && ctx.customWindows.length > 0) {
    const matched = ctx.customWindows.find((w) => isHourInWindow(hour, day, w));
    if (matched) {
      return {
        isQuiet: true,
        reason: 'custom_window',
        explanation: `使用者自訂禁打擾時段：${matched.label ?? `${matched.startHour}-${matched.endHour}`}`,
      };
    }
  }

  // 2. 靜態夜間 (22:00-08:00)
  if (isInStaticNight(hour)) {
    // 距離 08:00 還多久
    const msUntilOpen = (() => {
      const next = new Date(now);
      if (hour >= 22) {
        next.setDate(next.getDate() + 1);
        next.setHours(8, 0, 0, 0);
      } else {
        next.setHours(8, 0, 0, 0);
      }
      return next.getTime() - now.getTime();
    })();
    return {
      isQuiet: true,
      reason: 'static_night',
      explanation: '夜間 22:00-08:00 預設靜音',
      msUntilOpen,
    };
  }

  // 3. 課表 busy（學生 / 老師 / TA 有用）
  if (ctx.weeklyBusySlots) {
    const idx = currentWeekSlotIndex(now);
    if (ctx.weeklyBusySlots[idx]) {
      return {
        isQuiet: true,
        reason: 'in_class',
        explanation: '使用者目前正在上課 / 排程內',
      };
    }
  }

  // 4. 角色預設用餐 / 工作尖峰
  const mealPeaks = ROLE_MEAL_PEAKS[ctx.role] ?? [];
  const matchedMeal = mealPeaks.find((w) => isHourInWindow(hour, day, w));
  if (matchedMeal) {
    return {
      isQuiet: true,
      reason: 'meal_peak',
      explanation: `${ctx.role === 'vendor' ? '營業尖峰' : '用餐時段'}：${matchedMeal.label}`,
    };
  }

  return {
    isQuiet: false,
    reason: 'open',
    explanation: '目前可推播',
  };
}

/**
 * 把 customWindows 用人話陳述（給 UI / settings 顯示）
 */
export function describeWindow(w: QuietWindow): string {
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const dayPart = w.days && w.days.length > 0
    ? `週${w.days.map((d) => dayLabels[d]).join('、')}`
    : '每天';
  const timePart = `${String(w.startHour).padStart(2, '0')}:00-${String(w.endHour).padStart(2, '0')}:00`;
  return `${dayPart} ${timePart}${w.label ? `（${w.label}）` : ''}`;
}
