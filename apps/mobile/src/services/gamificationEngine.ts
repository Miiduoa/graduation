/**
 * 🎮 學習遊戲化引擎 — Gamification Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 將校園學習體驗遊戲化，透過行為心理學驅動學習動機。
 *
 * 核心系統：
 *   1. XP 經驗值系統 — 每個學習行為都有 XP 獎勵
 *   2. 等級系統 — 20 級成長路徑 (新生→學霸→傳說)
 *   3. 成就徽章 — 60+ 成就解鎖
 *   4. 連續打卡 Streak — 損失厭惡驅動每日使用
 *   5. 每週挑戰 — 定期目標維持新鮮感
 *   6. 排行榜 — 社交比較驅動（自願參加）
 *
 * 心理學基礎：
 *   - Variable Reward Schedule (不確定獎勵)
 *   - Loss Aversion (損失厭惡 → Streak)
 *   - Goal Gradient Effect (越接近目標越有動力)
 *   - Social Proof (排行榜)
 *   - Competence Need (成就系統)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Types ───────────────────────────────────────────────

export type XPAction =
  | "daily_login"
  | "attend_class"
  | "submit_assignment"
  | "complete_quiz"
  | "study_session"
  | "help_peer"
  | "write_review"
  | "report_crowd"
  | "join_study_group"
  | "achieve_grade_a"
  | "achieve_grade_b"
  | "use_ai_chat"
  | "explore_campus"
  | "read_announcement"
  | "check_grades"
  | "plan_schedule"
  | "first_login"
  | "streak_7"
  | "streak_30"
  | "perfect_week";

export type Level = {
  level: number;
  title: string;
  titleEn: string;
  minXP: number;
  icon: string;
  color: string;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  xpReward: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  condition: string;          // human-readable condition
  unlockedAt?: number;        // epoch ms, undefined = locked
  progress?: number;          // 0-1 for progress-based achievements
  maxProgress?: number;
};

export type AchievementCategory =
  | "academic"
  | "social"
  | "exploration"
  | "consistency"
  | "mastery"
  | "special";

export type Streak = {
  current: number;
  longest: number;
  lastCheckIn: string;        // YYYY-MM-DD
  history: string[];          // last 30 days of check-in dates
};

export type WeeklyChallenge = {
  id: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  target: number;
  current: number;
  type: "count" | "duration" | "score";
  expiresAt: number;
  completed: boolean;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  department: string;
  xp: number;
  level: number;
  streakDays: number;
  isCurrentUser: boolean;
};

export type GamificationState = {
  totalXP: number;
  level: number;
  levelInfo: Level;
  xpToNextLevel: number;
  xpProgress: number;         // 0-1 progress to next level
  streak: Streak;
  achievements: Achievement[];
  unlockedCount: number;
  totalCount: number;
  weeklyChallenges: WeeklyChallenge[];
  recentXPGains: { action: string; xp: number; timestamp: number }[];
  leaderboard: LeaderboardEntry[];
};

// ─── Constants ──────────────────────────────────────────

const STORAGE_KEY = "@gamification:state";
const XP_LOG_KEY = "@gamification:xp_log";

/** XP 獎勵表 */
const XP_TABLE: Record<XPAction, number> = {
  daily_login: 10,
  attend_class: 15,
  submit_assignment: 30,
  complete_quiz: 25,
  study_session: 20,
  help_peer: 25,
  write_review: 20,
  report_crowd: 5,
  join_study_group: 15,
  achieve_grade_a: 50,
  achieve_grade_b: 30,
  use_ai_chat: 5,
  explore_campus: 10,
  read_announcement: 5,
  check_grades: 5,
  plan_schedule: 10,
  first_login: 100,
  streak_7: 70,
  streak_30: 300,
  perfect_week: 100,
};

/** 等級系統 — 20 級 */
const LEVELS: Level[] = [
  { level: 1,  title: "校園新鮮人", titleEn: "Freshman", minXP: 0, icon: "leaf-outline", color: "#6EE7B7" },
  { level: 2,  title: "求知者", titleEn: "Seeker", minXP: 100, icon: "search-outline", color: "#6EE7B7" },
  { level: 3,  title: "學習新手", titleEn: "Novice", minXP: 300, icon: "book-outline", color: "#93C5FD" },
  { level: 4,  title: "課堂常客", titleEn: "Regular", minXP: 600, icon: "school-outline", color: "#93C5FD" },
  { level: 5,  title: "筆記達人", titleEn: "Note Taker", minXP: 1000, icon: "pencil-outline", color: "#93C5FD" },
  { level: 6,  title: "知識探索者", titleEn: "Explorer", minXP: 1500, icon: "compass-outline", color: "#C4B5FD" },
  { level: 7,  title: "學習戰士", titleEn: "Warrior", minXP: 2200, icon: "shield-outline", color: "#C4B5FD" },
  { level: 8,  title: "圖書館守護者", titleEn: "Guardian", minXP: 3000, icon: "library-outline", color: "#C4B5FD" },
  { level: 9,  title: "學術精英", titleEn: "Elite", minXP: 4000, icon: "star-outline", color: "#FDE68A" },
  { level: 10, title: "半學霸", titleEn: "Scholar", minXP: 5200, icon: "trophy-outline", color: "#FDE68A" },
  { level: 11, title: "學霸", titleEn: "Master", minXP: 6500, icon: "ribbon-outline", color: "#FDE68A" },
  { level: 12, title: "學神候選", titleEn: "Prodigy", minXP: 8000, icon: "diamond-outline", color: "#FDBA74" },
  { level: 13, title: "校園之星", titleEn: "Campus Star", minXP: 10000, icon: "sunny-outline", color: "#FDBA74" },
  { level: 14, title: "知識領袖", titleEn: "Leader", minXP: 12500, icon: "flag-outline", color: "#FDBA74" },
  { level: 15, title: "學術大師", titleEn: "Grandmaster", minXP: 15500, icon: "medal-outline", color: "#FCA5A5" },
  { level: 16, title: "傳奇學者", titleEn: "Legend", minXP: 19000, icon: "flame-outline", color: "#FCA5A5" },
  { level: 17, title: "啟蒙者", titleEn: "Enlightened", minXP: 23000, icon: "bulb-outline", color: "#FCA5A5" },
  { level: 18, title: "智慧之光", titleEn: "Luminary", minXP: 28000, icon: "flash-outline", color: "#E879F9" },
  { level: 19, title: "校園傳說", titleEn: "Mythic", minXP: 34000, icon: "planet-outline", color: "#E879F9" },
  { level: 20, title: "萬物學霸", titleEn: "Transcendent", minXP: 42000, icon: "infinite-outline", color: "#E879F9" },
];

/** 成就定義 */
const ALL_ACHIEVEMENTS: Omit<Achievement, "unlockedAt" | "progress">[] = [
  // Academic
  { id: "first_login", title: "初來乍到", description: "首次登入 Campus One", icon: "hand-right-outline", category: "academic", xpReward: 100, rarity: "common", condition: "登入 App" },
  { id: "grade_checker", title: "成績觀察家", description: "查看過成績 3 次", icon: "analytics-outline", category: "academic", xpReward: 30, rarity: "common", condition: "查看成績 3 次", maxProgress: 3 },
  { id: "straight_a", title: "全 A 戰士", description: "任一學期所有科目 85 分以上", icon: "star", category: "academic", xpReward: 200, rarity: "epic", condition: "單學期全 A" },
  { id: "gpa_climber", title: "逆襲之路", description: "GPA 連續 3 學期上升", icon: "trending-up", category: "academic", xpReward: 150, rarity: "rare", condition: "GPA 連續上升" },
  { id: "perfect_attendance", title: "全勤王", description: "連續 30 天全出席", icon: "checkmark-done", category: "academic", xpReward: 200, rarity: "epic", condition: "30 天全出席" },
  { id: "assignment_machine", title: "作業狂人", description: "連續交出 10 份作業", icon: "document-text", category: "academic", xpReward: 100, rarity: "rare", condition: "連續完成 10 份", maxProgress: 10 },
  { id: "early_bird", title: "提前交卷", description: "在截止前 3 天交作業", icon: "alarm-outline", category: "academic", xpReward: 50, rarity: "common", condition: "提前 3 天交" },
  { id: "quiz_master", title: "測驗達人", description: "完成 20 次測驗", icon: "help-circle", category: "academic", xpReward: 100, rarity: "rare", condition: "完成 20 次", maxProgress: 20 },

  // Social
  { id: "first_review", title: "評論先鋒", description: "寫下第一篇課程評價", icon: "chatbubble-ellipses", category: "social", xpReward: 30, rarity: "common", condition: "發表課評" },
  { id: "study_buddy", title: "學伴達人", description: "加入 3 個讀書會", icon: "people", category: "social", xpReward: 100, rarity: "rare", condition: "加入 3 個讀書會", maxProgress: 3 },
  { id: "helper", title: "樂於助人", description: "幫助 5 位同學", icon: "heart", category: "social", xpReward: 100, rarity: "rare", condition: "幫助 5 人", maxProgress: 5 },
  { id: "reviewer_pro", title: "課評專家", description: "發表 10 篇課程評價", icon: "create", category: "social", xpReward: 150, rarity: "epic", condition: "發表 10 篇課評", maxProgress: 10 },
  { id: "crowd_reporter", title: "校園偵察兵", description: "回報 20 次校園人潮", icon: "radio-outline", category: "social", xpReward: 100, rarity: "rare", condition: "回報 20 次", maxProgress: 20 },

  // Exploration
  { id: "campus_walker", title: "校園散步者", description: "瀏覽 10 個校園地點", icon: "walk-outline", category: "exploration", xpReward: 50, rarity: "common", condition: "瀏覽 10 地點", maxProgress: 10 },
  { id: "ai_curious", title: "AI 好奇寶寶", description: "和 AI 助理對話 50 次", icon: "chatbubbles", category: "exploration", xpReward: 100, rarity: "rare", condition: "AI 對話 50 次", maxProgress: 50 },
  { id: "night_owl", title: "夜貓子", description: "晚上 10 點後使用 App", icon: "moon", category: "exploration", xpReward: 20, rarity: "common", condition: "深夜使用" },
  { id: "map_explorer", title: "地圖探險家", description: "使用校園地圖導航 5 次", icon: "map", category: "exploration", xpReward: 50, rarity: "common", condition: "導航 5 次", maxProgress: 5 },

  // Consistency
  { id: "streak_3", title: "三日不倦", description: "連續登入 3 天", icon: "flame-outline", category: "consistency", xpReward: 30, rarity: "common", condition: "3 天連續", maxProgress: 3 },
  { id: "streak_7", title: "一週戰士", description: "連續登入 7 天", icon: "flame", category: "consistency", xpReward: 70, rarity: "rare", condition: "7 天連續", maxProgress: 7 },
  { id: "streak_30", title: "月之守護者", description: "連續登入 30 天", icon: "bonfire", category: "consistency", xpReward: 300, rarity: "epic", condition: "30 天連續", maxProgress: 30 },
  { id: "streak_100", title: "百日傳說", description: "連續登入 100 天", icon: "trophy", category: "consistency", xpReward: 1000, rarity: "legendary", condition: "100 天連續", maxProgress: 100 },
  { id: "perfect_week", title: "完美一週", description: "一週內每天都完成學習目標", icon: "checkmark-circle", category: "consistency", xpReward: 100, rarity: "rare", condition: "7 天全達標" },

  // Mastery
  { id: "level_5", title: "初窺門徑", description: "達到等級 5", icon: "arrow-up", category: "mastery", xpReward: 50, rarity: "common", condition: "等級 5" },
  { id: "level_10", title: "登堂入室", description: "達到等級 10", icon: "arrow-up-circle", category: "mastery", xpReward: 150, rarity: "rare", condition: "等級 10" },
  { id: "level_15", title: "爐火純青", description: "達到等級 15", icon: "medal", category: "mastery", xpReward: 300, rarity: "epic", condition: "等級 15" },
  { id: "level_20", title: "登峰造極", description: "達到等級 20", icon: "planet", category: "mastery", xpReward: 1000, rarity: "legendary", condition: "等級 20" },
  { id: "xp_1000", title: "千里之行", description: "累積 1000 XP", icon: "footsteps-outline", category: "mastery", xpReward: 50, rarity: "common", condition: "1000 XP" },
  { id: "xp_10000", title: "萬里征途", description: "累積 10000 XP", icon: "rocket", category: "mastery", xpReward: 200, rarity: "epic", condition: "10000 XP" },

  // Special
  { id: "semester_start", title: "新學期新希望", description: "在開學第一週登入", icon: "sparkles", category: "special", xpReward: 50, rarity: "common", condition: "開學週登入" },
  { id: "finals_survivor", title: "期末生存者", description: "期末週每天都登入", icon: "skull-outline", category: "special", xpReward: 100, rarity: "rare", condition: "期末週全勤" },
  { id: "graduation_ready", title: "畢業在望", description: "畢業學分達 90%", icon: "school", category: "special", xpReward: 300, rarity: "epic", condition: "學分 90%" },
];

// ─── Storage ────────────────────────────────────────────

type StoredState = {
  totalXP: number;
  streak: Streak;
  unlockedAchievements: Record<string, number>; // id → unlockedAt
  achievementProgress: Record<string, number>;   // id → progress count
  challengeState: Record<string, number>;        // challengeId → current progress
  xpLog: { action: string; xp: number; timestamp: number }[];
};

async function loadState(): Promise<StoredState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return JSON.parse(raw);
  } catch {
    return defaultState();
  }
}

async function saveState(state: StoredState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[Gamification] saveState error:", err);
  }
}

function defaultState(): StoredState {
  return {
    totalXP: 0,
    streak: { current: 0, longest: 0, lastCheckIn: "", history: [] },
    unlockedAchievements: {},
    achievementProgress: {},
    challengeState: {},
    xpLog: [],
  };
}

// ─── Core Functions ─────────────────────────────────────

function getLevelForXP(xp: number): Level {
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (xp >= level.minXP) current = level;
    else break;
  }
  return current;
}

function getXPToNextLevel(xp: number): { needed: number; progress: number } {
  const currentLevel = getLevelForXP(xp);
  const nextLevel = LEVELS.find((l) => l.level === currentLevel.level + 1);
  if (!nextLevel) return { needed: 0, progress: 1 }; // max level

  const levelXPRange = nextLevel.minXP - currentLevel.minXP;
  const xpIntoLevel = xp - currentLevel.minXP;
  return {
    needed: nextLevel.minXP - xp,
    progress: levelXPRange > 0 ? xpIntoLevel / levelXPRange : 1,
  };
}

/**
 * 獲得 XP
 */
export async function earnXP(action: XPAction): Promise<{
  xpGained: number;
  totalXP: number;
  levelUp: boolean;
  newLevel?: Level;
  newAchievements: Achievement[];
}> {
  const state = await loadState();
  const xpGained = XP_TABLE[action] ?? 0;
  const oldLevel = getLevelForXP(state.totalXP);

  state.totalXP += xpGained;

  // Log
  state.xpLog.push({ action, xp: xpGained, timestamp: Date.now() });
  if (state.xpLog.length > 100) state.xpLog = state.xpLog.slice(-100);

  const newLevel = getLevelForXP(state.totalXP);
  const levelUp = newLevel.level > oldLevel.level;

  // Check achievements
  const newAchievements = checkAchievements(state, action);

  // Add achievement XP
  for (const ach of newAchievements) {
    state.totalXP += ach.xpReward;
    state.unlockedAchievements[ach.id] = Date.now();
  }

  await saveState(state);

  return {
    xpGained,
    totalXP: state.totalXP,
    levelUp,
    newLevel: levelUp ? newLevel : undefined,
    newAchievements,
  };
}

/**
 * 每日簽到
 */
export async function dailyCheckIn(): Promise<{
  xpGained: number;
  streakDays: number;
  isNewStreak: boolean;
  bonusXP: number;
}> {
  const state = await loadState();
  const today = new Date().toISOString().split("T")[0];

  if (state.streak.lastCheckIn === today) {
    return { xpGained: 0, streakDays: state.streak.current, isNewStreak: false, bonusXP: 0 };
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const isConsecutive = state.streak.lastCheckIn === yesterday;

  if (isConsecutive) {
    state.streak.current++;
  } else {
    state.streak.current = 1;
  }

  state.streak.lastCheckIn = today;
  state.streak.longest = Math.max(state.streak.longest, state.streak.current);
  state.streak.history.push(today);
  if (state.streak.history.length > 30) state.streak.history = state.streak.history.slice(-30);

  // Base XP
  let xpGained = XP_TABLE.daily_login;

  // Streak bonus
  let bonusXP = 0;
  if (state.streak.current === 7) bonusXP = XP_TABLE.streak_7;
  else if (state.streak.current === 30) bonusXP = XP_TABLE.streak_30;
  else if (state.streak.current > 1) bonusXP = Math.min(state.streak.current * 2, 20);

  xpGained += bonusXP;
  state.totalXP += xpGained;

  state.xpLog.push({ action: "daily_login", xp: xpGained, timestamp: Date.now() });

  await saveState(state);

  return {
    xpGained,
    streakDays: state.streak.current,
    isNewStreak: !isConsecutive,
    bonusXP,
  };
}

function checkAchievements(state: StoredState, action: XPAction): Achievement[] {
  const newlyUnlocked: Achievement[] = [];

  // XP milestones
  if (state.totalXP >= 1000 && !state.unlockedAchievements["xp_1000"]) {
    const ach = ALL_ACHIEVEMENTS.find((a) => a.id === "xp_1000")!;
    newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
  }
  if (state.totalXP >= 10000 && !state.unlockedAchievements["xp_10000"]) {
    const ach = ALL_ACHIEVEMENTS.find((a) => a.id === "xp_10000")!;
    newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
  }

  // Level milestones
  const level = getLevelForXP(state.totalXP).level;
  for (const milestone of [5, 10, 15, 20]) {
    const id = `level_${milestone}`;
    if (level >= milestone && !state.unlockedAchievements[id]) {
      const ach = ALL_ACHIEVEMENTS.find((a) => a.id === id)!;
      newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
    }
  }

  // Streak milestones
  for (const days of [3, 7, 30, 100]) {
    const id = `streak_${days}`;
    if (state.streak.current >= days && !state.unlockedAchievements[id]) {
      const ach = ALL_ACHIEVEMENTS.find((a) => a.id === id);
      if (ach) newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
    }
  }

  // First login
  if (action === "first_login" && !state.unlockedAchievements["first_login"]) {
    const ach = ALL_ACHIEVEMENTS.find((a) => a.id === "first_login")!;
    newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
  }

  // Night owl
  if (new Date().getHours() >= 22 && !state.unlockedAchievements["night_owl"]) {
    const ach = ALL_ACHIEVEMENTS.find((a) => a.id === "night_owl")!;
    newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
  }

  // Progress-based achievements
  const progressActions: Record<string, string> = {
    check_grades: "grade_checker",
    write_review: "first_review",
    report_crowd: "crowd_reporter",
    use_ai_chat: "ai_curious",
  };

  const achId = progressActions[action];
  if (achId) {
    const current = (state.achievementProgress[achId] ?? 0) + 1;
    state.achievementProgress[achId] = current;
    const ach = ALL_ACHIEVEMENTS.find((a) => a.id === achId);
    if (ach && ach.maxProgress && current >= ach.maxProgress && !state.unlockedAchievements[achId]) {
      newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
    }
  }

  return newlyUnlocked;
}

// ─── Weekly Challenges ──────────────────────────────────

function generateWeeklyChallenges(): WeeklyChallenge[] {
  const now = Date.now();
  const endOfWeek = now + 7 * 24 * 60 * 60 * 1000;

  return [
    {
      id: `wc_study_${Math.floor(now / 604800000)}`,
      title: "學習馬拉松",
      description: "本週完成 5 次學習活動",
      icon: "book-outline",
      xpReward: 80,
      target: 5,
      current: 0,
      type: "count",
      expiresAt: endOfWeek,
      completed: false,
    },
    {
      id: `wc_social_${Math.floor(now / 604800000)}`,
      title: "社交蝴蝶",
      description: "幫助 2 位同學或參加讀書會",
      icon: "people-outline",
      xpReward: 60,
      target: 2,
      current: 0,
      type: "count",
      expiresAt: endOfWeek,
      completed: false,
    },
    {
      id: `wc_explore_${Math.floor(now / 604800000)}`,
      title: "校園探險家",
      description: "回報 3 次校園人潮狀況",
      icon: "compass-outline",
      xpReward: 40,
      target: 3,
      current: 0,
      type: "count",
      expiresAt: endOfWeek,
      completed: false,
    },
  ];
}

// ─── Mock Leaderboard ───────────────────────────────────

function generateLeaderboard(myXP: number, myName: string, myDept: string): LeaderboardEntry[] {
  const mockEntries: Omit<LeaderboardEntry, "rank">[] = [
    { userId: "lb1", displayName: "學霸小明", department: "資管系", xp: 15200, level: 14, streakDays: 45, isCurrentUser: false },
    { userId: "lb2", displayName: "卷王小華", department: "資工系", xp: 12800, level: 12, streakDays: 30, isCurrentUser: false },
    { userId: "lb3", displayName: "學習達人", department: "應數系", xp: 10500, level: 11, streakDays: 22, isCurrentUser: false },
    { userId: "lb4", displayName: "拼命三郎", department: "會計系", xp: 8900, level: 10, streakDays: 18, isCurrentUser: false },
    { userId: "lb5", displayName: "校園之星", department: "企管系", xp: 7200, level: 9, streakDays: 15, isCurrentUser: false },
    { userId: "lb6", displayName: "認真同學", department: "外文系", xp: 5500, level: 7, streakDays: 10, isCurrentUser: false },
    { userId: "lb7", displayName: "穩定輸出", department: "統資系", xp: 4100, level: 6, streakDays: 8, isCurrentUser: false },
    { userId: "lb8", displayName: "努力中", department: "法律系", xp: 2800, level: 5, streakDays: 5, isCurrentUser: false },
    { userId: "lb9", displayName: "新手上路", department: "社工系", xp: 1500, level: 3, streakDays: 3, isCurrentUser: false },
  ];

  // Insert current user
  const myLevel = getLevelForXP(myXP);
  const allEntries = [
    ...mockEntries,
    {
      userId: "me",
      displayName: myName,
      department: myDept,
      xp: myXP,
      level: myLevel.level,
      streakDays: 0,
      isCurrentUser: true,
    },
  ];

  return allEntries
    .sort((a, b) => b.xp - a.xp)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// ─── Main Entry Point ───────────────────────────────────

/**
 * 取得完整遊戲化狀態
 */
export async function getGamificationState(
  displayName: string = "同學",
  department: string = "",
): Promise<GamificationState> {
  const state = await loadState();
  const levelInfo = getLevelForXP(state.totalXP);
  const { needed, progress } = getXPToNextLevel(state.totalXP);

  // Build achievements with unlock status
  const achievements: Achievement[] = ALL_ACHIEVEMENTS.map((ach) => ({
    ...ach,
    unlockedAt: state.unlockedAchievements[ach.id],
    progress: state.achievementProgress[ach.id],
  }));

  const unlockedCount = Object.keys(state.unlockedAchievements).length;

  return {
    totalXP: state.totalXP,
    level: levelInfo.level,
    levelInfo,
    xpToNextLevel: needed,
    xpProgress: progress,
    streak: state.streak,
    achievements,
    unlockedCount,
    totalCount: ALL_ACHIEVEMENTS.length,
    weeklyChallenges: generateWeeklyChallenges(),
    recentXPGains: state.xpLog.slice(-10).reverse(),
    leaderboard: generateLeaderboard(state.totalXP, displayName, department),
  };
}

/**
 * 重置遊戲化狀態（測試用）
 */
export async function resetGamification(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  console.log("[Gamification] State reset");
}
