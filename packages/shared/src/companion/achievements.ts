/**
 * Campus Companion — Achievements / Unlockables
 *
 * 把 APP 每一個功能對應到精靈／花園／星圖的具體解鎖物。
 * 設計原則：
 *  - 一次性事件（例如「第一次借書」）→ 不可重複觸發
 *  - 累積型事件（例如「借滿 5 本」）→ tracker 達標一次
 *  - 解鎖物不影響戰力，純收藏 / 視覺
 *  - 純函式：吃 progress 狀態 → 輸出 unlocked[]
 */

// ─────────────────────────────────────────────────────────
// 解鎖物類型
// ─────────────────────────────────────────────────────────

export type UnlockKind = 'accessory' | 'plant_species' | 'star_constellation' | 'badge' | 'title';

export interface Unlockable {
  /** 內部 key，例如 'lib_5_books' */
  id: string;
  kind: UnlockKind;
  label: string;
  description: string;
  emoji: string;
  /** 該解鎖物所屬的 APP 領域（用於介面分類） */
  domain:
    | 'study'
    | 'library'
    | 'cafeteria'
    | 'campus_explore'
    | 'transport'
    | 'social'
    | 'health'
    | 'dorm'
    | 'event'
    | 'system'
    | 'lifecycle';
}

export interface AchievementProgress {
  /** 累積值（一次性事件取 1 / 0） */
  count: number;
  /** 用於避免重複觸發的旗標 */
  unlocked: boolean;
}

export type AchievementProgressMap = Record<string, AchievementProgress>;

// ─────────────────────────────────────────────────────────
// 成就定義（每個 APP 功能至少有一個）
// ─────────────────────────────────────────────────────────

export interface AchievementDef {
  id: string;
  label: string;
  description: string;
  /** 用什麼信號累積 */
  signal: keyof AchievementProgressMap | string;
  /** 達標門檻；一次性=1 */
  threshold: number;
  unlock: Unlockable;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── LMS / Study ──
  {
    id: 'first_assignment',
    label: '首次繳交作業',
    description: '在校園助理裡繳交第一份作業。',
    signal: 'assignmentsSubmitted',
    threshold: 1,
    unlock: {
      id: 'first_assignment',
      kind: 'badge',
      label: '初試啼聲',
      description: '繳交了第一份作業。',
      emoji: '📝',
      domain: 'study',
    },
  },
  {
    id: 'attendance_perfect_week',
    label: '一週全勤',
    description: '一週內出席紀錄完整。',
    signal: 'attendancePerfectWeeks',
    threshold: 1,
    unlock: {
      id: 'perfect_attendance_halo',
      kind: 'accessory',
      label: '全勤光環',
      description: '頭上會發光的精靈裝飾。',
      emoji: '✨',
      domain: 'study',
    },
  },
  {
    id: 'quiz_perfect_score',
    label: '滿分測驗',
    description: '在一份測驗拿到 100%。',
    signal: 'quizPerfectScores',
    threshold: 1,
    unlock: {
      id: 'perfect_score_crown',
      kind: 'accessory',
      label: '滿分皇冠',
      description: '金色小皇冠。',
      emoji: '👑',
      domain: 'study',
    },
  },
  {
    id: 'first_harvest',
    label: '首次採收',
    description: '完成第一棵植物的學期採收。',
    signal: 'plantsHarvested',
    threshold: 1,
    unlock: {
      id: 'harvest_basket',
      kind: 'accessory',
      label: '採收提籃',
      description: '可裝知識點的小提籃。',
      emoji: '🧺',
      domain: 'study',
    },
  },
  // ── Library ──
  {
    id: 'lib_5_books',
    label: '借滿 5 本書',
    description: '圖書館累積借書 5 本。',
    signal: 'libraryBorrowCount',
    threshold: 5,
    unlock: {
      id: 'bookworm',
      kind: 'accessory',
      label: '書蟲',
      description: '一隻會跟著精靈的小書蟲。',
      emoji: '🐛',
      domain: 'library',
    },
  },
  {
    id: 'lib_20_seats',
    label: '預約座位 20 次',
    description: '在自習室預約座位 20 次。',
    signal: 'librarySeatReservations',
    threshold: 20,
    unlock: {
      id: 'study_corner',
      kind: 'plant_species',
      label: '專屬讀書角',
      description: '花園裡的限定座位場景。',
      emoji: '🪑',
      domain: 'library',
    },
  },
  // ── Cafeteria ──
  {
    id: 'food_10_vendors',
    label: '吃過 10 間店家',
    description: '在 10 間不同店家點過餐。',
    signal: 'distinctVendorsLifetime',
    threshold: 10,
    unlock: {
      id: 'gourmet',
      kind: 'title',
      label: '校園美食家',
      description: '精靈名牌會加上小餐叉。',
      emoji: '🍴',
      domain: 'cafeteria',
    },
  },
  {
    id: 'food_balanced_30_days',
    label: '均衡飲食 30 天',
    description: '連 30 天紀錄到主食+蛋白+蔬菜。',
    signal: 'balancedMealDays',
    threshold: 30,
    unlock: {
      id: 'green_apron',
      kind: 'accessory',
      label: '綠色圍裙',
      description: '精靈會穿圍裙協助你選餐。',
      emoji: '🥗',
      domain: 'cafeteria',
    },
  },
  {
    id: 'group_order_3',
    label: '揪團 3 次',
    description: '發起或加入揪團 3 次。',
    signal: 'groupOrderJoinedLifetime',
    threshold: 3,
    unlock: {
      id: 'group_dining_lantern',
      kind: 'accessory',
      label: '揪團小燈',
      description: '夜晚會發光的小燈，找朋友吃飯時亮起。',
      emoji: '🏮',
      domain: 'cafeteria',
    },
  },
  // ── Campus Explore ──
  {
    id: 'map_visit_20',
    label: '走訪 20 個地點',
    description: '在校園地圖造訪 20 個不同 POI。',
    signal: 'distinctPoiVisited',
    threshold: 20,
    unlock: {
      id: 'explorer_constellation',
      kind: 'star_constellation',
      label: '探索者星座',
      description: '星圖點亮探索者座。',
      emoji: '🌌',
      domain: 'campus_explore',
    },
  },
  {
    id: 'ar_navigation_5',
    label: 'AR 導航 5 次',
    description: '完成 AR 導航 5 次。',
    signal: 'arNavigationCompletedLifetime',
    threshold: 5,
    unlock: {
      id: 'ar_visor',
      kind: 'accessory',
      label: 'AR 護目鏡',
      description: '一副小型 AR 眼鏡。',
      emoji: '🥽',
      domain: 'campus_explore',
    },
  },
  {
    id: 'steps_week_35000',
    label: '一週步數破 3.5 萬',
    description: '在校園步數一週累積 35,000 步。',
    signal: 'highStepWeeks',
    threshold: 1,
    unlock: {
      id: 'hiking_boots',
      kind: 'accessory',
      label: '健行靴',
      description: '精靈會穿著去爬大肚山。',
      emoji: '🥾',
      domain: 'campus_explore',
    },
  },
  // ── Transport ──
  {
    id: 'bus_10',
    label: '搭校車 10 次',
    description: '校車打卡 10 次。',
    signal: 'busCheckinsLifetime',
    threshold: 10,
    unlock: {
      id: 'commuter_scarf',
      kind: 'accessory',
      label: '通勤圍巾',
      description: '通勤族專屬。',
      emoji: '🧣',
      domain: 'transport',
    },
  },
  // ── Social ──
  {
    id: 'peer_review_first',
    label: '首次同儕互評',
    description: '完成第一次同儕互評。',
    signal: 'peerReviewsGivenLifetime',
    threshold: 1,
    unlock: {
      id: 'peer_review_ribbon',
      kind: 'badge',
      label: '同儕勳章',
      description: '互相幫助的證明。',
      emoji: '🎗️',
      domain: 'social',
    },
  },
  {
    id: 'encouragement_sent_10',
    label: '送出 10 朵鼓勵雲',
    description: '寄出 10 句鼓勵給同學。',
    signal: 'encouragementsSentLifetime',
    threshold: 10,
    unlock: {
      id: 'cloud_keeper',
      kind: 'title',
      label: '鼓勵守護者',
      description: '名牌加上小雲朵。',
      emoji: '☁️',
      domain: 'social',
    },
  },
  {
    id: 'discussion_useful_5',
    label: '5 個有用回答',
    description: '在課程討論串獲得 5 次 useful 標記。',
    signal: 'discussionUsefulMarks',
    threshold: 5,
    unlock: {
      id: 'helpful_lamp',
      kind: 'accessory',
      label: '助人之燈',
      description: '討論串夜晚發光。',
      emoji: '🔆',
      domain: 'social',
    },
  },
  // ── Health ──
  {
    id: 'health_checkin_first',
    label: '健康自我照顧',
    description: '第一次預約健康中心或諮商中心。',
    signal: 'healthCenterVisitsLifetime',
    threshold: 1,
    unlock: {
      id: 'self_care_badge',
      kind: 'badge',
      label: '自我照顧',
      description: '懂得照顧自己很棒。',
      emoji: '💚',
      domain: 'health',
    },
  },
  // ── Dorm ──
  {
    id: 'dorm_repair_first',
    label: '首次宿舍報修',
    description: '在 APP 提交第一個宿舍報修。',
    signal: 'dormRepairCreatedLifetime',
    threshold: 1,
    unlock: {
      id: 'toolbox',
      kind: 'accessory',
      label: '小工具箱',
      description: '精靈會幫你叫工人。',
      emoji: '🧰',
      domain: 'dorm',
    },
  },
  // ── Events ──
  {
    id: 'event_attend_5',
    label: '參加 5 場活動',
    description: '校園活動報名 + 簽到累積 5 次。',
    signal: 'eventAttendanceLifetime',
    threshold: 5,
    unlock: {
      id: 'event_camera',
      kind: 'accessory',
      label: '活動相機',
      description: '可記錄參與過的活動。',
      emoji: '📷',
      domain: 'event',
    },
  },
  // ── Lifecycle (跨學年) ──
  {
    id: 'year_one_complete',
    label: '完成大一',
    description: '在校園助理度過大一全學年。',
    signal: 'studyYearReached',
    threshold: 2,
    unlock: {
      id: 'freshman_diploma',
      kind: 'badge',
      label: '大一紀念狀',
      description: '一張小小的證書。',
      emoji: '🎓',
      domain: 'lifecycle',
    },
  },
  {
    id: 'legacy_tree_planted',
    label: '種下傳承樹',
    description: '大四畢業前為學弟妹種樹。',
    signal: 'legacyTreesPlanted',
    threshold: 1,
    unlock: {
      id: 'legacy_seed_pouch',
      kind: 'accessory',
      label: '傳承種子袋',
      description: '裡面裝著新生會收到的種子。',
      emoji: '🎒',
      domain: 'lifecycle',
    },
  },
];

// ─────────────────────────────────────────────────────────
// 計算引擎
// ─────────────────────────────────────────────────────────

export interface EvaluateAchievementsInput {
  /** 目前 lifetime / weekly 累積計數（key 對應 AchievementDef.signal） */
  progress: Record<string, number>;
  /** 已解鎖過的 id 集合（避免重複觸發） */
  alreadyUnlocked: Set<string>;
}

export interface EvaluateAchievementsResult {
  /** 本次新解鎖的成就 */
  newlyUnlocked: Unlockable[];
  /** 仍未解鎖且最接近達標的下一個（≤3 個，給使用者看「快要解開」） */
  closestPending: Array<{
    id: string;
    label: string;
    progress: number;
    threshold: number;
    percent: number;
    domain: Unlockable['domain'];
  }>;
}

export function evaluateAchievements(input: EvaluateAchievementsInput): EvaluateAchievementsResult {
  const newlyUnlocked: Unlockable[] = [];
  const pending: EvaluateAchievementsResult['closestPending'] = [];

  for (const def of ACHIEVEMENTS) {
    if (input.alreadyUnlocked.has(def.id)) continue;
    const current = Number(input.progress[def.signal] ?? 0);
    if (current >= def.threshold) {
      newlyUnlocked.push(def.unlock);
      continue;
    }
    pending.push({
      id: def.id,
      label: def.label,
      progress: current,
      threshold: def.threshold,
      percent: Math.round((current / def.threshold) * 100),
      domain: def.unlock.domain,
    });
  }

  // 取最接近達標前 3 名（percent 高的）
  pending.sort((a, b) => b.percent - a.percent);
  return {
    newlyUnlocked,
    closestPending: pending.slice(0, 3),
  };
}

/**
 * 列出某個 domain 的全部成就（給「我的收藏」UI）
 */
export function listAchievementsByDomain(domain: Unlockable['domain']): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.unlock.domain === domain);
}
