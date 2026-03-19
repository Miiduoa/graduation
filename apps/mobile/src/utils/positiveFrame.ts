/**
 * positiveFrame.ts — 正向框架語言系統
 *
 * 心理學依據：
 * - Framing Effect (Kahneman & Tversky)：同樣訊息以正面框架呈現，
 *   用戶焦慮感顯著降低，行動意願反而提升。
 * - Growth Mindset (Dweck)：強調「還能做的事」而非「已失去的機會」。
 * - Anxiety Reduction：避免紅色警告和「逾期/失敗」等負向詞彙，
 *   改用中性或激勵性語言。
 */

export type DeadlineInfo = {
  dueAt: Date;
  taskType?: "assignment" | "quiz" | "registration" | "general";
  estimatedMinutes?: number;
};

/**
 * 將截止時間轉為「正向框架」的人性化描述
 * 取代傳統的「距截止 X 小時」「已逾期」等負向表達
 */
export function positiveDeadlineLabel(due: Date, estimatedMinutes?: number): {
  label: string;
  subLabel?: string;
  urgency: "done" | "comfortable" | "soon" | "today" | "overdue";
  color: "growth" | "calm" | "gentleWarn" | "achievement" | "muted";
} {
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    // 已過截止日期 → 改用「還有機會」而非「逾期」
    const overdueHours = Math.abs(diffHours);
    if (overdueHours < 24) {
      return {
        label: "還有機會聯絡教師",
        subLabel: "截止剛過，及早溝通",
        urgency: "overdue",
        color: "calm",
      };
    }
    return {
      label: "需要處理",
      subLabel: "聯絡教師了解補救方式",
      urgency: "overdue",
      color: "muted",
    };
  }

  if (diffHours < 2) {
    // 2 小時內 → 強調「現在就完成」
    const estText = estimatedMinutes ? `預計 ${estimatedMinutes} 分鐘` : "";
    return {
      label: "今天完成就好",
      subLabel: estText || `還有 ${Math.round(diffHours * 60)} 分鐘`,
      urgency: "today",
      color: "gentleWarn",
    };
  }

  if (diffHours < 6) {
    return {
      label: "今天內完成",
      subLabel: `還有 ${Math.round(diffHours)} 小時`,
      urgency: "today",
      color: "gentleWarn",
    };
  }

  if (diffDays < 1) {
    return {
      label: "今天可以完成",
      subLabel: "今日截止",
      urgency: "soon",
      color: "calm",
    };
  }

  if (diffDays < 3) {
    return {
      label: `還有 ${Math.ceil(diffDays)} 天`,
      subLabel: "計畫一下，輕鬆完成",
      urgency: "soon",
      color: "calm",
    };
  }

  if (diffDays < 7) {
    return {
      label: `本週截止`,
      subLabel: `${Math.ceil(diffDays)} 天後`,
      urgency: "comfortable",
      color: "calm",
    };
  }

  return {
    label: `${Math.ceil(diffDays)} 天後截止`,
    subLabel: "時間充裕，從容準備",
    urgency: "comfortable",
    color: "muted",
  };
}

/**
 * 出席率的正向框架：強調「再出席幾次就能達標」而非「目前不達標」
 */
export function positiveAttendanceLabel(current: number, required: number, total: number): {
  label: string;
  subLabel: string;
  isOnTrack: boolean;
} {
  const pct = total > 0 ? (current / total) * 100 : 100;
  const isOnTrack = pct >= required;

  if (isOnTrack) {
    return {
      label: `出席率達標 ✓`,
      subLabel: `${Math.round(pct)}% · 繼續保持`,
      isOnTrack: true,
    };
  }

  // 計算還需出席幾次
  const needPct = required / 100;
  const remainingClasses = total - current;
  const currentNeededClasses = Math.ceil(total * needPct) - current;

  if (currentNeededClasses <= 0) {
    return {
      label: "即將達標！",
      subLabel: `只差一點點`,
      isOnTrack: false,
    };
  }

  return {
    label: `再出席 ${currentNeededClasses} 次就達標`,
    subLabel: `目前 ${Math.round(pct)}%，目標 ${required}%`,
    isOnTrack: false,
  };
}

/**
 * 成績的正向框架：強調進步空間而非失分
 */
export function positiveGradeLabel(score: number, maxScore: number, passingScore?: number): {
  label: string;
  subLabel: string;
  sentiment: "excellent" | "good" | "growing" | "needs-attention";
} {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;

  if (pct >= 90) {
    return { label: "表現優秀！", subLabel: `${score}/${maxScore}`, sentiment: "excellent" };
  }
  if (pct >= 70) {
    return { label: "表現不錯", subLabel: `還有 ${Math.round(maxScore - score)} 分進步空間`, sentiment: "good" };
  }
  if (pct >= (passingScore ?? 60)) {
    return { label: "持續進步中", subLabel: `專注可以更好`, sentiment: "growing" };
  }

  const pointsToPass = passingScore ? Math.ceil((passingScore / 100) * maxScore) - score : 0;
  return {
    label: "需要關注",
    subLabel: pointsToPass > 0 ? `再努力 ${pointsToPass} 分就及格` : "聯絡老師了解補救方式",
    sentiment: "needs-attention",
  };
}

/**
 * 任務優先度排序（Fogg BJ Model）：
 * 高動機 × 高能力 = 最先顯示（截止近 + 預計時間短）
 */
export function sortByFoggModel<T extends {
  dueAt?: Date | null;
  estimatedMinutes?: number;
  priority?: number;
}>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const now = Date.now();
    const aDue = a.dueAt ? a.dueAt.getTime() : Infinity;
    const bDue = b.dueAt ? b.dueAt.getTime() : Infinity;
    const aEst = a.estimatedMinutes ?? 30;
    const bEst = b.estimatedMinutes ?? 30;

    // 緊迫度分數（越近越高）
    const aUrgency = aDue < Infinity ? Math.max(0, 1 - (aDue - now) / (7 * 24 * 60 * 60 * 1000)) : 0;
    const bUrgency = bDue < Infinity ? Math.max(0, 1 - (bDue - now) / (7 * 24 * 60 * 60 * 1000)) : 0;

    // 能力分數（預計時間越短越高 = 容易完成）
    const aAbility = Math.max(0, 1 - aEst / 120);
    const bAbility = Math.max(0, 1 - bEst / 120);

    // Fogg Model: Motivation × Ability（簡化為 urgency × ability）
    const aScore = aUrgency * 0.6 + aAbility * 0.4 + (a.priority ?? 0) * 0.1;
    const bScore = bUrgency * 0.6 + bAbility * 0.4 + (b.priority ?? 0) * 0.1;

    return bScore - aScore;
  });
}
