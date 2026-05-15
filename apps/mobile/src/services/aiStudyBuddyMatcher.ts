/**
 * AI Study Buddy Matcher — 基於多維度的學伴配對引擎
 *
 * 設計動機：
 *   靜宜 / TronClass 沒有「學伴推薦」這層；學生通常自己找朋友組讀書會，
 *   但「同班同學」不等於「合適學伴」。真正合適的學伴是：
 *     - 修同一門課（有共同 ground）
 *     - 弱項互補（你強我弱、我強你弱 = 互相幫助）
 *     - 空堂時段重疊（找得到時間一起念）
 *     - 學習風格互補（視覺 + 整合者、文字 + 講解者）
 *
 * 純函式 — 給定學生群 profile，回傳 ranked matches + 為什麼匹配的解釋。
 * 無網路 / 無 storage 副作用，方便 unit test。
 *
 * Demo 用：
 *   - 真實情境會餵 Firestore 來的學生資料；demo 用 mock。
 *   - 為什麼匹配的「解釋」要透明，讓使用者選擇前能判斷。
 */

export type LearningStyle =
  | 'visual'      // 圖像 / 影片
  | 'reading'     // 文字 / 講義
  | 'auditory'    // 講解 / 討論
  | 'kinesthetic' // 做題 / 實作
  | 'mixed';

export interface StudentBuddyProfile {
  uid: string;
  displayName: string;
  avatarEmoji?: string;
  /** 修課清單（courseId） */
  enrolledCourseIds: number[];
  /** 每門課自評強度 0-100；缺項視為 50 */
  courseStrength: Record<number, number>;
  /** 每週空堂時段（24h 制小時集合，0-167） */
  freeTimeSlots: number[];
  /** 主要學習風格 */
  primaryStyle: LearningStyle;
  /** 偏好讀書時段（'morning'|'afternoon'|'evening'|'night'） */
  preferredStudyWindow?: 'morning' | 'afternoon' | 'evening' | 'night';
  /** 自我介紹 */
  bio?: string;
}

export interface BuddyMatchResult {
  buddyUid: string;
  buddyName: string;
  overallScore: number; // 0-100
  /** 配對的共同課程 id */
  sharedCourseIds: number[];
  /** 弱項互補（你弱對方強） */
  complementCourses: Array<{ courseId: number; myStrength: number; theirStrength: number; gap: number }>;
  /** 空堂重疊小時數 */
  scheduleOverlapHours: number;
  /** 配對解釋（給使用者讀） */
  reasons: string[];
  /** 配對警示（為什麼可能不合適） */
  cautions: string[];
}

// ─────────────────────────────────────────────────────────
// Sub-scoring functions (pure, easy to unit test)
// ─────────────────────────────────────────────────────────

export function courseOverlapScore(me: StudentBuddyProfile, them: StudentBuddyProfile): {
  score: number;
  sharedCourseIds: number[];
} {
  const mine = new Set(me.enrolledCourseIds);
  const shared = them.enrolledCourseIds.filter((id) => mine.has(id));
  if (mine.size === 0 || them.enrolledCourseIds.length === 0) {
    return { score: 0, sharedCourseIds: [] };
  }
  // Jaccard similarity 0-1 → 縮放 0-100
  const union = new Set([...me.enrolledCourseIds, ...them.enrolledCourseIds]).size;
  const jaccard = shared.length / union;
  return { score: Math.round(jaccard * 100), sharedCourseIds: shared };
}

export function complementarityScore(me: StudentBuddyProfile, them: StudentBuddyProfile): {
  score: number;
  complementCourses: BuddyMatchResult['complementCourses'];
} {
  const mine = new Set(me.enrolledCourseIds);
  const shared = them.enrolledCourseIds.filter((id) => mine.has(id));
  if (shared.length === 0) return { score: 0, complementCourses: [] };

  const complementCourses: BuddyMatchResult['complementCourses'] = [];
  let total = 0;
  for (const cid of shared) {
    const myStrength = me.courseStrength[cid] ?? 50;
    const theirStrength = them.courseStrength[cid] ?? 50;
    const gap = Math.abs(myStrength - theirStrength);
    // 最佳互補：gap 約 25-40（一強一弱但不至於差距大到沒法溝通）
    // gap < 10 → 兩人都類似，互相幫助有限
    // gap > 60 → 差距太大，弱者可能會被強者帶著走但學不深
    let courseScore = 0;
    if (gap >= 20 && gap <= 45) courseScore = 100 - Math.abs(gap - 32) * 2;
    else if (gap < 20) courseScore = 40 + gap * 2; // 兩人接近
    else courseScore = Math.max(0, 80 - (gap - 45) * 2); // 差距過大

    complementCourses.push({
      courseId: cid,
      myStrength,
      theirStrength,
      gap,
    });
    total += courseScore;
  }
  return {
    score: Math.round(total / shared.length),
    complementCourses: complementCourses.sort((a, b) => b.gap - a.gap),
  };
}

export function scheduleOverlapScore(me: StudentBuddyProfile, them: StudentBuddyProfile): {
  score: number;
  overlapHours: number;
} {
  const mine = new Set(me.freeTimeSlots);
  const overlap = them.freeTimeSlots.filter((h) => mine.has(h));
  const overlapHours = overlap.length;
  // 6h 以上是充足的；2h 以下偏少
  if (overlapHours === 0) return { score: 0, overlapHours: 0 };
  if (overlapHours >= 6) return { score: 100, overlapHours };
  return { score: Math.round((overlapHours / 6) * 100), overlapHours };
}

export function learningStyleScore(me: StudentBuddyProfile, them: StudentBuddyProfile): number {
  if (me.primaryStyle === 'mixed' || them.primaryStyle === 'mixed') return 75;
  // 互補組合 (一個視覺 + 一個文字 = 互相補強筆記、講解、影片)
  const complementaryPairs: Array<[LearningStyle, LearningStyle]> = [
    ['visual', 'reading'],
    ['visual', 'auditory'],
    ['reading', 'auditory'],
    ['kinesthetic', 'visual'],
    ['kinesthetic', 'reading'],
  ];
  if (me.primaryStyle === them.primaryStyle) return 65; // 同質：合得來但少了互補
  for (const [a, b] of complementaryPairs) {
    if (
      (me.primaryStyle === a && them.primaryStyle === b)
      || (me.primaryStyle === b && them.primaryStyle === a)
    ) {
      return 90;
    }
  }
  return 50;
}

// ─────────────────────────────────────────────────────────
// 主入口：找出 me 的 top N 學伴
// ─────────────────────────────────────────────────────────

export interface MatchOptions {
  topN?: number;
  /** 過濾掉沒共同修課的人 */
  requireSharedCourse?: boolean;
  /** 過濾掉沒空堂重疊的人 */
  requireScheduleOverlap?: boolean;
}

export function matchStudyBuddies(
  me: StudentBuddyProfile,
  candidates: StudentBuddyProfile[],
  options: MatchOptions = {},
): BuddyMatchResult[] {
  const { topN = 5, requireSharedCourse = true, requireScheduleOverlap = false } = options;

  const results: BuddyMatchResult[] = [];
  for (const them of candidates) {
    if (them.uid === me.uid) continue;

    const overlap = courseOverlapScore(me, them);
    if (requireSharedCourse && overlap.sharedCourseIds.length === 0) continue;

    const comp = complementarityScore(me, them);
    const sched = scheduleOverlapScore(me, them);
    if (requireScheduleOverlap && sched.overlapHours === 0) continue;

    const styleScore = learningStyleScore(me, them);

    // 加權：共同課 30% / 互補 35% / 時段 20% / 風格 15%
    const overallScore = Math.round(
      overlap.score * 0.30
      + comp.score * 0.35
      + sched.score * 0.20
      + styleScore * 0.15,
    );

    const reasons: string[] = [];
    const cautions: string[] = [];

    if (overlap.sharedCourseIds.length >= 3) {
      reasons.push(`你們同時修 ${overlap.sharedCourseIds.length} 門課，溝通成本低`);
    } else if (overlap.sharedCourseIds.length > 0) {
      reasons.push(`你們在 ${overlap.sharedCourseIds.length} 門課上重疊`);
    }
    const topComp = comp.complementCourses[0];
    if (topComp && topComp.gap >= 20) {
      const whoIsStronger = topComp.theirStrength > topComp.myStrength ? them.displayName : '你';
      reasons.push(`${whoIsStronger}在某課程強 ${topComp.gap} 分，可互相帶`);
    }
    if (sched.overlapHours >= 4) {
      reasons.push(`每週空堂重疊 ${sched.overlapHours} 小時，能穩定約讀書`);
    } else if (sched.overlapHours === 0) {
      cautions.push('沒有空堂重疊 — 必須協調時間');
    }
    if (styleScore >= 85) {
      reasons.push('學習風格互補（一人圖像、一人文字）效率最高');
    } else if (styleScore <= 55) {
      cautions.push('學習風格相近，可能少了「教彼此」的機會');
    }
    if (comp.score >= 80) {
      reasons.push('整體強弱項分布是漂亮的「一上一下」');
    }

    results.push({
      buddyUid: them.uid,
      buddyName: them.displayName,
      overallScore,
      sharedCourseIds: overlap.sharedCourseIds,
      complementCourses: comp.complementCourses,
      scheduleOverlapHours: sched.overlapHours,
      reasons,
      cautions,
    });
  }

  return results.sort((a, b) => b.overallScore - a.overallScore).slice(0, topN);
}

// ─────────────────────────────────────────────────────────
// Demo data — 用於 AIStudyBuddyScreen
// ─────────────────────────────────────────────────────────

export const DEMO_BUDDY_CANDIDATES: StudentBuddyProfile[] = [
  {
    uid: 'demo_buddy_lin',
    displayName: '林承翰',
    avatarEmoji: '🧑‍🎓',
    enrolledCourseIds: [71378, 71282, 71240, 71393],
    courseStrength: { 71378: 85, 71282: 60, 71240: 45, 71393: 70 },
    freeTimeSlots: [13, 14, 15, 37, 38, 60, 61, 62],
    primaryStyle: 'reading',
    preferredStudyWindow: 'afternoon',
    bio: '喜歡先把概念寫成筆記再做題',
  },
  {
    uid: 'demo_buddy_chen',
    displayName: '陳思妤',
    avatarEmoji: '👩‍🎓',
    enrolledCourseIds: [71378, 71240, 71393, 77418],
    courseStrength: { 71378: 50, 71240: 80, 71393: 55, 77418: 90 },
    freeTimeSlots: [10, 11, 12, 37, 38, 39, 85, 86],
    primaryStyle: 'visual',
    preferredStudyWindow: 'morning',
    bio: '只要有圖我就秒懂，但寫題比較慢',
  },
  {
    uid: 'demo_buddy_huang',
    displayName: '黃柏翔',
    avatarEmoji: '🧑',
    enrolledCourseIds: [71378, 71282],
    courseStrength: { 71378: 40, 71282: 75 },
    freeTimeSlots: [109, 110, 111, 132, 133],
    primaryStyle: 'auditory',
    preferredStudyWindow: 'evening',
    bio: '聊著聊著就理解了',
  },
  {
    uid: 'demo_buddy_wu',
    displayName: '吳子涵',
    avatarEmoji: '👨‍🎓',
    enrolledCourseIds: [71378, 71282, 71240, 71393, 77418],
    courseStrength: { 71378: 70, 71282: 70, 71240: 70, 71393: 70, 77418: 70 },
    freeTimeSlots: [13, 14, 15, 37, 38, 60, 61],
    primaryStyle: 'kinesthetic',
    preferredStudyWindow: 'afternoon',
    bio: '直接寫題、邊寫邊問',
  },
  {
    uid: 'demo_buddy_lee',
    displayName: '李宜婷',
    avatarEmoji: '👩',
    enrolledCourseIds: [77418],
    courseStrength: { 77418: 85 },
    freeTimeSlots: [85, 86, 87],
    primaryStyle: 'mixed',
    bio: '只剩微學分，找個聊',
  },
];

export const DEMO_ME_PROFILE: StudentBuddyProfile = {
  uid: 'demo_student_kuchih',
  displayName: '顧晉瑋',
  avatarEmoji: '🎓',
  enrolledCourseIds: [71378, 71282, 71240, 71393, 77418],
  courseStrength: { 71378: 55, 71282: 80, 71240: 40, 71393: 65, 77418: 75 },
  freeTimeSlots: [13, 14, 15, 37, 38, 60, 61, 62],
  primaryStyle: 'visual',
  preferredStudyWindow: 'afternoon',
};
