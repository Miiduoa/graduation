import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Animated, Easing, RefreshControl, Share, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildUserSchoolCollectionPath } from "@campus/shared/src";
import { Screen, Card, Pill, Button, AnimatedCard, ProgressRing, Divider } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useFavorites } from "../state/favorites";
import { useSchool } from "../state/school";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { getDb } from "../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  setDoc,
  serverTimestamp,
  onSnapshot,
  where,
} from "firebase/firestore";
import { collectionFromSegments, docFromSegments } from "../data/firestorePath";
import { getFirstStorageValue, getScopedStorageKey } from "../services/scopedStorage";

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "explorer" | "social" | "academic" | "engagement" | "special";
  points: number;
  requirement: number;
  progress: number;
  unlocked: boolean;
  unlockedAt?: Date;
  rarity: "common" | "rare" | "epic" | "legendary";
};

type LeaderboardEntry = {
  rank: number;
  userId: string;
  userName: string;
  points: number;
  level: number;
  isCurrentUser: boolean;
};

const ACHIEVEMENT_DEFINITIONS: Omit<Achievement, "progress" | "unlocked" | "unlockedAt">[] = [
  { id: "first_login", title: "新生報到", description: "首次登入 APP", icon: "rocket", category: "engagement", points: 10, requirement: 1, rarity: "common" },
  { id: "profile_complete", title: "自我介紹", description: "完成個人資料填寫", icon: "person-circle", category: "engagement", points: 20, requirement: 1, rarity: "common" },
  { id: "first_favorite", title: "收藏家入門", description: "收藏第一個項目", icon: "heart", category: "engagement", points: 10, requirement: 1, rarity: "common" },
  { id: "collector_10", title: "收藏達人", description: "累積收藏 10 個項目", icon: "heart-circle", category: "engagement", points: 50, requirement: 10, rarity: "rare" },
  { id: "collector_50", title: "收藏大師", description: "累積收藏 50 個項目", icon: "trophy", category: "engagement", points: 150, requirement: 50, rarity: "epic" },
  { id: "explore_5", title: "校園探索者", description: "瀏覽 5 個不同地點", icon: "compass", category: "explorer", points: 30, requirement: 5, rarity: "common" },
  { id: "explore_20", title: "校園達人", description: "瀏覽 20 個不同地點", icon: "map", category: "explorer", points: 100, requirement: 20, rarity: "rare" },
  { id: "navigate_first", title: "方向感", description: "首次使用導航功能", icon: "navigate", category: "explorer", points: 15, requirement: 1, rarity: "common" },
  { id: "event_first", title: "活動參與者", description: "報名第一個活動", icon: "calendar", category: "social", points: 25, requirement: 1, rarity: "common" },
  { id: "event_5", title: "社交達人", description: "報名 5 個活動", icon: "people", category: "social", points: 75, requirement: 5, rarity: "rare" },
  { id: "group_join", title: "群組新手", description: "加入第一個群組", icon: "chatbubbles", category: "social", points: 20, requirement: 1, rarity: "common" },
  { id: "post_first", title: "發言人", description: "在群組發表第一篇貼文", icon: "create", category: "social", points: 30, requirement: 1, rarity: "common" },
  { id: "post_10", title: "話題王", description: "累積發表 10 篇貼文", icon: "megaphone", category: "social", points: 100, requirement: 10, rarity: "rare" },
  { id: "credit_check", title: "學分規劃師", description: "首次使用學分試算", icon: "school", category: "academic", points: 20, requirement: 1, rarity: "common" },
  { id: "course_10", title: "修課達人", description: "登錄 10 門課程", icon: "book", category: "academic", points: 80, requirement: 10, rarity: "rare" },
  { id: "ai_chat", title: "AI 先鋒", description: "首次使用 AI 助理", icon: "sparkles", category: "special", points: 25, requirement: 1, rarity: "common" },
  { id: "ai_master", title: "AI 達人", description: "與 AI 助理對話 50 次", icon: "hardware-chip", category: "special", points: 150, requirement: 50, rarity: "epic" },
  { id: "early_bird", title: "早起的鳥兒", description: "在早上 6-7 點使用 APP", icon: "sunny", category: "special", points: 40, requirement: 1, rarity: "rare" },
  { id: "night_owl", title: "夜貓子", description: "在凌晨 1-3 點使用 APP", icon: "moon", category: "special", points: 40, requirement: 1, rarity: "rare" },
  { id: "streak_7", title: "持之以恆", description: "連續 7 天登入", icon: "flame", category: "engagement", points: 100, requirement: 7, rarity: "rare" },
  { id: "streak_30", title: "鐵粉認證", description: "連續 30 天登入", icon: "medal", category: "engagement", points: 300, requirement: 30, rarity: "legendary" },
];

const LEGACY_STREAK_KEY = "campus.streak.v1";

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string; // ISO date string YYYY-MM-DD
  totalDays: number;
};

function getStreakStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey("streak", { uid: userId, schoolId });
}

async function updateStreak(storageKey: string): Promise<StreakData> {
  try {
    const raw = await getFirstStorageValue([storageKey, LEGACY_STREAK_KEY]);
    const existing: StreakData = raw ? JSON.parse(raw) : {
      currentStreak: 0, longestStreak: 0,
      lastLoginDate: "", totalDays: 0,
    };

    const today = new Date().toISOString().split("T")[0];
    if (existing.lastLoginDate === today) return existing;

    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const isConsecutive = existing.lastLoginDate === yesterday;

    const newStreak = isConsecutive ? existing.currentStreak + 1 : 1;
    const updated: StreakData = {
      currentStreak: newStreak,
      longestStreak: Math.max(existing.longestStreak, newStreak),
      lastLoginDate: today,
      totalDays: existing.totalDays + 1,
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    return updated;
  } catch {
    return { currentStreak: 1, longestStreak: 1, lastLoginDate: "", totalDays: 1 };
  }
}

const CATEGORY_INFO = {
  explorer: { label: "探索", color: "#3B82F6", icon: "compass" },
  social: { label: "社交", color: "#10B981", icon: "people" },
  academic: { label: "學業", color: "#F59E0B", icon: "school" },
  engagement: { label: "互動", color: "#8B5CF6", icon: "heart" },
  special: { label: "特殊", color: "#EF4444", icon: "star" },
};

/**
 * StreakCard — Habit Loop 視覺化
 * Streak 系統依據行為心理學：提供一致性的正向強化，利用 Loss Aversion（不想中斷 streak）維持習慣
 */
function StreakCard({ streak, onShare }: { streak: StreakData; onShare: () => void }) {
  const flameAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 7 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(flameAnim, { toValue: 1.12, duration: 800, useNativeDriver: true }),
        Animated.timing(flameAnim, { toValue: 0.95, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const streakColor = streak.currentStreak >= 30
    ? theme.colors.achievement
    : streak.currentStreak >= 7
      ? theme.colors.streak
      : theme.colors.accent;

  const streakMilestones = [1, 3, 7, 14, 30, 60, 100];
  const nextMilestone = streakMilestones.find((m) => m > streak.currentStreak) ?? 100;
  const prevMilestone = streakMilestones.filter((m) => m <= streak.currentStreak).pop() ?? 0;
  const milestoneProgress = (streak.currentStreak - prevMilestone) / (nextMilestone - prevMilestone);

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }], marginBottom: 12 }}>
      <View style={{
        padding: 20, borderRadius: 24,
        backgroundColor: `${streakColor}10`,
        borderWidth: 1.5, borderColor: `${streakColor}25`,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          {/* 火焰動畫 */}
          <Animated.View style={{
            width: 72, height: 72, borderRadius: 22,
            backgroundColor: `${streakColor}20`,
            alignItems: "center", justifyContent: "center",
            transform: [{ scale: flameAnim }],
          }}>
            <Text style={{ fontSize: 36 }}>
              {streak.currentStreak >= 30 ? "🔥" : streak.currentStreak >= 7 ? "⚡" : "✨"}
            </Text>
          </Animated.View>

          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 }}>
              連續使用天數
            </Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
              <Text style={{ color: streakColor, fontWeight: "900", fontSize: 40, letterSpacing: -1 }}>
                {streak.currentStreak}
              </Text>
              <Text style={{ color: streakColor, fontWeight: "700", fontSize: 16 }}>天</Text>
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              最長紀錄 {streak.longestStreak} 天 · 共 {streak.totalDays} 天
            </Text>
          </View>

          <Pressable
            onPress={onShare}
            style={({ pressed }) => ({
              padding: 10, borderRadius: 12,
              backgroundColor: `${streakColor}18`,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="share-outline" size={20} color={streakColor} />
          </Pressable>
        </View>

        {/* 到下一個里程碑的進度 */}
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600" }}>
              距離 {nextMilestone} 天里程碑
            </Text>
            <Text style={{ color: streakColor, fontSize: 11, fontWeight: "700" }}>
              還差 {nextMilestone - streak.currentStreak} 天
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: "hidden" }}>
            <View style={{
              height: "100%",
              width: `${milestoneProgress * 100}%`,
              backgroundColor: streakColor,
              borderRadius: 3,
            }} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const RARITY_INFO = {
  common: { label: "普通", color: "#94A3B8", bgColor: "rgba(148,163,184,0.15)" },
  rare: { label: "稀有", color: "#3B82F6", bgColor: "rgba(59,130,246,0.15)" },
  epic: { label: "史詩", color: "#8B5CF6", bgColor: "rgba(139,92,246,0.15)" },
  legendary: { label: "傳說", color: "#F59E0B", bgColor: "rgba(245,158,11,0.15)" },
};

function calculateLevel(points: number): { level: number; currentXP: number; nextLevelXP: number } {
  let level = 1;
  let xpNeeded = 100;
  let totalXP = 0;

  while (points >= totalXP + xpNeeded) {
    totalXP += xpNeeded;
    level++;
    xpNeeded = Math.floor(xpNeeded * 1.5);
  }

  return {
    level,
    currentXP: points - totalXP,
    nextLevelXP: xpNeeded,
  };
}

function AchievementCard(props: { achievement: Achievement; onPress?: () => void; onShare?: () => void }) {
  const { achievement } = props;
  const rarityInfo = RARITY_INFO[achievement.rarity];
  const categoryInfo = CATEGORY_INFO[achievement.category];

  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const unlockAnim = useRef(new Animated.Value(achievement.unlocked ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // 解鎖動畫（當狀態從未解鎖→解鎖時觸發）
  useEffect(() => {
    if (achievement.unlocked) {
      Animated.sequence([
        Animated.spring(unlockAnim, { toValue: 1.2, useNativeDriver: true, friction: 5 }),
        Animated.spring(unlockAnim, { toValue: 1, useNativeDriver: true, friction: 7 }),
      ]).start();
    }
  }, [achievement.unlocked]);

  const progress = Math.min(1, achievement.progress / achievement.requirement);

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={props.onPress}
        style={{
          padding: 18,
          borderRadius: theme.radius.lg,
          backgroundColor: achievement.unlocked ? rarityInfo.bgColor : theme.colors.surface2,
          borderWidth: achievement.unlocked ? 1.5 : 1,
          borderColor: achievement.unlocked ? rarityInfo.color : theme.colors.border,
          opacity: achievement.unlocked ? 1 : 0.65,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Animated.View style={{ transform: [{ scale: unlockAnim }] }}>
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: achievement.unlocked ? `${categoryInfo.color}25` : theme.colors.surface2,
              alignItems: "center", justifyContent: "center",
              borderWidth: 2,
              borderColor: achievement.unlocked ? categoryInfo.color : theme.colors.border,
            }}>
              <Ionicons
                name={achievement.icon as any}
                size={28}
                color={achievement.unlocked ? categoryInfo.color : theme.colors.muted}
              />
            </View>
          </Animated.View>

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>
                {achievement.title}
              </Text>
              {achievement.unlocked && (
                <Ionicons name="checkmark-circle" size={18} color={theme.colors.growth} />
              )}
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>
              {achievement.description}
            </Text>

            {!achievement.unlocked && (
              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  {/* 正向框架：「已達成 X/Y」而非「未完成 Y-X」 */}
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    已達成 {achievement.progress}/{achievement.requirement}
                  </Text>
                  <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "600" }}>
                    再努力 {achievement.requirement - achievement.progress} 步！
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: "hidden" }}>
                  <View style={{
                    height: "100%",
                    width: `${progress * 100}%`,
                    backgroundColor: categoryInfo.color,
                    borderRadius: 3,
                  }} />
                </View>
              </View>
            )}
          </View>

          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: rarityInfo.bgColor }}>
              <Text style={{ color: rarityInfo.color, fontSize: 10, fontWeight: "700" }}>{rarityInfo.label}</Text>
            </View>
            <Text style={{ color: theme.colors.achievement, fontWeight: "800", fontSize: 13 }}>
              +{achievement.points}
            </Text>
            {achievement.unlocked && props.onShare && (
              <Pressable onPress={props.onShare} hitSlop={8}>
                <Ionicons name="share-social-outline" size={16} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// 這些成就直接從本地狀態計算（不需要 Firestore 追蹤）
const LOCAL_COMPUTED_IDS = new Set([
  "first_login", "profile_complete", "first_favorite",
  "collector_10", "collector_50", "early_bird", "night_owl",
]);

async function syncAchievementToFirestore(
  db: any,
  uid: string,
  schoolId: string,
  achievementId: string,
  progress: number,
  requirement: number
) {
  try {
    const ref = docFromSegments(db, buildUserSchoolCollectionPath(uid, schoolId, "achievements", achievementId));
    const snap = await getDoc(ref);
    const unlocked = progress >= requirement;
    const existingData = snap.exists() ? snap.data() : null;

    if (!existingData || existingData.progress !== progress) {
      await setDoc(ref, {
        progress,
        unlocked,
        schoolId,
        updatedAt: serverTimestamp(),
        ...(unlocked && !existingData?.unlockedAt ? { unlockedAt: serverTimestamp() } : {}),
      }, { merge: true });
    }
  } catch (e) {
    // silent - non-critical sync
  }
}

export function AchievementsScreen(props: any) {
  const auth = useAuth();
  const fav = useFavorites();
  const { school } = useSchool();
  const ds = useDataSource();
  const db = getDb();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [firestoreProgress, setFirestoreProgress] = useState<Record<string, { progress: number; unlocked: boolean; unlockedAt?: Date }>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [streakData, setStreakData] = useState<StreakData>({ currentStreak: 0, longestStreak: 0, lastLoginDate: "", totalDays: 0 });
  const [showStreakShare, setShowStreakShare] = useState(false);
  const streakStorageKey = useMemo(
    () => getStreakStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id]
  );

  useEffect(() => {
    updateStreak(streakStorageKey).then(setStreakData);
  }, [streakStorageKey]);

  const { items: pois } = useAsyncList(() => ds.listPois(school.id), [ds, school.id, refreshKey]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // 手動重新抓一次排行榜快照
      if (school?.id) {
        const ref = collection(db, "schools", school.id, "leaderboard");
        const snap = await getDocs(query(ref, orderBy("points", "desc"), limit(10)));
        if (!snap.empty) {
          const entries = snap.docs.map((d, i) => ({
            rank: i + 1,
            userId: d.id,
            userName: d.data().displayName ?? "同學",
            points: d.data().points ?? 0,
            level: calculateLevel(d.data().points ?? 0).level,
            isCurrentUser: d.id === auth.user?.uid,
          }));
          setLeaderboard(entries);
        }
      }
      // 重新觸發 POI 列表載入
      setRefreshKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }, [school?.id, auth.user?.uid, db]);

  const totalFavorites = useMemo(() => {
    return fav.favorites.announcement.length +
      fav.favorites.event.length +
      fav.favorites.poi.length +
      fav.favorites.menu.length;
  }, [fav.favorites]);

  // 訂閱 Firestore 成就資料
  useEffect(() => {
    if (!auth.user) return;
    const canonicalRef = collectionFromSegments(db, buildUserSchoolCollectionPath(auth.user.uid, school.id, "achievements"));
    const unsubscribe = onSnapshot(canonicalRef, async (snap) => {
      const data: Record<string, { progress: number; unlocked: boolean; unlockedAt?: Date }> = {};
      snap.docs.forEach((d) => {
        const raw = d.data();
        data[d.id] = {
          progress: raw.progress ?? 0,
          unlocked: raw.unlocked ?? false,
          unlockedAt: raw.unlockedAt?.toDate?.() ?? undefined,
        };
      });

      if (snap.empty) {
        const legacySnap = await getDocs(collection(db, "users", auth.user.uid, "achievements")).catch(() => null);
        legacySnap?.docs.forEach((d) => {
          const raw = d.data();
          data[d.id] = {
            progress: raw.progress ?? 0,
            unlocked: raw.unlocked ?? false,
            unlockedAt: raw.unlockedAt?.toDate?.() ?? undefined,
          };
        });
      }

      setFirestoreProgress(data);
    });
    return () => unsubscribe();
  }, [auth.user?.uid, school.id]);

  // 訂閱排行榜
  useEffect(() => {
    if (!school?.id) return;
    const ref = collection(db, "schools", school.id, "leaderboard");
    const q = query(ref, orderBy("points", "desc"), limit(10));
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const entries = snap.docs.map((d, i) => ({
          rank: i + 1,
          userId: d.id,
          userName: d.data().displayName ?? "同學",
          points: d.data().points ?? 0,
          level: calculateLevel(d.data().points ?? 0).level,
          isCurrentUser: d.id === auth.user?.uid,
        }));
        setLeaderboard(entries);
      }
    });
    return () => unsubscribe();
  }, [school?.id, auth.user?.uid]);

  const achievements = useMemo<Achievement[]>(() => {
    const hour = new Date().getHours();

    return ACHIEVEMENT_DEFINITIONS.map((def) => {
      let progress = 0;
      let unlocked = false;
      let unlockedAt: Date | undefined;

      if (LOCAL_COMPUTED_IDS.has(def.id)) {
        // 本地計算
        switch (def.id) {
          case "first_login":
            progress = auth.user ? 1 : 0;
            break;
          case "profile_complete":
            progress = auth.profile?.displayName ? 1 : 0;
            break;
          case "first_favorite":
          case "collector_10":
          case "collector_50":
            progress = totalFavorites;
            break;
          case "early_bird":
            progress = hour >= 6 && hour < 7 ? 1 : 0;
            break;
          case "night_owl":
            progress = hour >= 1 && hour < 3 ? 1 : 0;
            break;
        }
        unlocked = progress >= def.requirement;

        // 同步本地計算結果到 Firestore
        if (auth.user) {
          syncAchievementToFirestore(db, auth.user.uid, school.id, def.id, progress, def.requirement);
        }
      } else {
        // 從 Firestore 讀取（若無資料則為 0）
        const fsData = firestoreProgress[def.id];
        progress = fsData?.progress ?? 0;
        unlocked = fsData?.unlocked ?? (progress >= def.requirement);
        unlockedAt = fsData?.unlockedAt;
      }

      return {
        ...def,
        progress,
        unlocked,
        unlockedAt: unlocked ? (unlockedAt ?? (unlocked ? new Date() : undefined)) : undefined,
      };
    });
  }, [auth.user, auth.profile, totalFavorites, pois.length, firestoreProgress, db, school.id]);

  const totalPoints = useMemo(() => {
    return achievements.filter((a) => a.unlocked).reduce((sum, a) => sum + a.points, 0);
  }, [achievements]);

  const levelInfo = useMemo(() => calculateLevel(totalPoints), [totalPoints]);

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = achievements.length;

  const filteredAchievements = useMemo(() => {
    if (!selectedCategory) return achievements;
    return achievements.filter((a) => a.category === selectedCategory);
  }, [achievements, selectedCategory]);

  // 若無 Firestore 排行榜，顯示 fallback（含真實用戶分數）
  const displayLeaderboard = useMemo<LeaderboardEntry[]>(() => {
    if (leaderboard.length > 0) return leaderboard;
    // fallback with real current user
    const fallback: LeaderboardEntry[] = [
      { rank: 1, userId: "u1", userName: "學霸小明", points: 1250, level: 8, isCurrentUser: false },
      { rank: 2, userId: "u2", userName: "活動王", points: 980, level: 7, isCurrentUser: false },
      { rank: 3, userId: "u3", userName: "探索家", points: 850, level: 6, isCurrentUser: false },
    ];
    if (auth.user) {
      fallback.push({
        rank: 4,
        userId: auth.user.uid,
        userName: auth.profile?.displayName ?? "我",
        points: totalPoints,
        level: levelInfo.level,
        isCurrentUser: true,
      });
    }
    fallback.push({ rank: 5, userId: "u5", userName: "新同學", points: 320, level: 3, isCurrentUser: false });
    return fallback.sort((a, b) => b.points - a.points).map((e, i) => ({ ...e, rank: i + 1 }));
  }, [leaderboard, auth.user, auth.profile, totalPoints, levelInfo.level]);

  const handleShareStreak = useCallback(async () => {
    try {
      await Share.share({
        message: `我已連續使用校園助手 ${streakData.currentStreak} 天！🔥\n最高紀錄 ${streakData.longestStreak} 天，一起來挑戰吧！`,
        title: "我的學習 Streak",
      });
    } catch {
      // ignore
    }
  }, [streakData]);

  const handleShareAchievement = useCallback(async (achievement: Achievement) => {
    try {
      await Share.share({
        message: `我在校園助手解鎖了「${achievement.title}」成就！🏆\n${achievement.description}\n+${achievement.points} 積分`,
        title: "成就解鎖",
      });
    } catch {
      // ignore
    }
  }, []);

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.accent} />}
      >
        {/* ─── Streak 連續使用卡片 ─── */}
        <StreakCard streak={streakData} onShare={handleShareStreak} />

        <AnimatedCard title="" subtitle="">
          <View style={{ alignItems: "center", padding: 8 }}>
            <View style={{ position: "relative", width: 100, height: 100 }}>
              <ProgressRing
                progress={levelInfo.currentXP / levelInfo.nextLevelXP}
                size={100}
                strokeWidth={8}
                color={theme.colors.accent}
                showLabel={false}
              />
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 30, lineHeight: 34 }}>
                  {levelInfo.level}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 14 }}>等級</Text>
              </View>
            </View>

            <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 20, marginTop: 16 }}>
              {auth.profile?.displayName ?? "校園探索者"}
            </Text>

            <View style={{ flexDirection: "row", gap: 20, marginTop: 16 }}>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{totalPoints}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>總積分</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{unlockedCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>已解鎖</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: theme.colors.muted, fontWeight: "900", fontSize: 24 }}>{totalCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>總成就</Text>
              </View>
            </View>

            <View style={{ marginTop: 16, width: "100%" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  距離下一級：{levelInfo.nextLevelXP - levelInfo.currentXP} XP
                </Text>
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>
                  Lv.{levelInfo.level + 1}
                </Text>
              </View>
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.border,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${(levelInfo.currentXP / levelInfo.nextLevelXP) * 100}%`,
                    backgroundColor: theme.colors.accent,
                    borderRadius: 4,
                  }}
                />
              </View>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="排行榜" subtitle="校園積分榜（即時更新）" delay={100}>
          <View style={{ gap: 8 }}>
            {displayLeaderboard.map((entry) => (
              <View
                key={entry.userId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: entry.isCurrentUser ? theme.colors.accentSoft : theme.colors.surface2,
                  borderWidth: entry.isCurrentUser ? 1 : 0,
                  borderColor: theme.colors.accent,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor:
                      entry.rank === 1 ? "#F59E0B" : entry.rank === 2 ? "#94A3B8" : entry.rank === 3 ? "#CD7F32" : theme.colors.surface2,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                  }}
                >
                  {entry.rank <= 3 ? (
                    <Ionicons name="trophy" size={16} color="#fff" />
                  ) : (
                    <Text style={{ color: theme.colors.muted, fontWeight: "700" }}>{entry.rank}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                    {entry.userName}
                    {entry.isCurrentUser && " (你)"}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>Lv.{entry.level}</Text>
                </View>
                <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>{entry.points} 分</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        <AnimatedCard title="成就分類" subtitle="" delay={200}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setSelectedCategory(null)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: !selectedCategory ? theme.colors.accentSoft : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: !selectedCategory ? theme.colors.accent : theme.colors.border,
                }}
              >
                <Text style={{ color: !selectedCategory ? theme.colors.accent : theme.colors.muted, fontWeight: "700" }}>
                  全部
                </Text>
              </Pressable>
              {Object.entries(CATEGORY_INFO).map(([key, info]) => {
                const count = achievements.filter((a) => a.category === key && a.unlocked).length;
                const total = achievements.filter((a) => a.category === key).length;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setSelectedCategory(key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: selectedCategory === key ? `${info.color}20` : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: selectedCategory === key ? info.color : theme.colors.border,
                    }}
                  >
                    <Ionicons name={info.icon as any} size={16} color={selectedCategory === key ? info.color : theme.colors.muted} />
                    <Text style={{ color: selectedCategory === key ? info.color : theme.colors.muted, fontWeight: "700" }}>
                      {info.label} ({count}/{total})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </AnimatedCard>

        <View style={{ gap: 12 }}>
          {filteredAchievements.map((achievement) => (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              onShare={achievement.unlocked ? () => handleShareAchievement(achievement) : undefined}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
