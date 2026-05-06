/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  FlatList,
  Animated,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../ui/theme";
import { useThemeMode } from "../state/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import {
  getGamificationState,
  dailyCheckIn,
  earnXP,
  type GamificationState,
  type Achievement,
  type AchievementCategory,
  type LeaderboardEntry,
  type WeeklyChallenge,
} from "../services/gamificationEngine";

const SCREEN_WIDTH = Dimensions.get("window").width;
const ACHIEVEMENT_COLUMNS = 3;
const ACHIEVEMENT_SIZE = (SCREEN_WIDTH - theme.space.lg * 2 - theme.space.sm * 2) / ACHIEVEMENT_COLUMNS;

const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  "academic",
  "social",
  "exploration",
  "consistency",
  "mastery",
  "special",
];

const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  academic: "學術",
  social: "社交",
  exploration: "探索",
  consistency: "堅持",
  mastery: "精通",
  special: "特殊",
};

const RARITY_COLORS: Record<string, { border: string; glow: string }> = {
  common: { border: theme.colors.border, glow: "transparent" },
  rare: { border: "#60A5FA", glow: "rgba(96, 165, 250, 0.3)" },
  epic: { border: "#C4B5FD", glow: "rgba(196, 181, 253, 0.3)" },
  legendary: { border: "#FBBF24", glow: "rgba(251, 191, 36, 0.4)" },
};

export function GamificationScreen() {
  const insets = useSafeAreaInsets();
  const themeMode = useThemeMode();
  const [gamState, setGamState] = useState<GamificationState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AchievementCategory>("academic");
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const xpProgressAnim = useRef(new Animated.Value(0)).current;

  // Load gamification state
  useEffect(() => {
    loadGamificationState();
  }, []);

  // Animate XP progress bar
  useEffect(() => {
    if (gamState) {
      Animated.timing(xpProgressAnim, {
        toValue: gamState.xpProgress,
        duration: 600,
        useNativeDriver: false,
      }).start();
    }
  }, [gamState?.xpProgress]);

  const loadGamificationState = async () => {
    try {
      const state = await getGamificationState("你", "資訊系");
      setGamState(state);
    } catch (err) {
      console.warn("[GamificationScreen] Load error:", err);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGamificationState();
    setRefreshing(false);
  }, []);

  const handleDailyCheckIn = async () => {
    try {
      const result = await dailyCheckIn();
      await loadGamificationState();
      // TODO: Show toast with result
    } catch (err) {
      console.warn("[GamificationScreen] Check-in error:", err);
    }
  };

  const handleEarnXP = async () => {
    try {
      const result = await earnXP("daily_login");
      await loadGamificationState();
    } catch (err) {
      console.warn("[GamificationScreen] Earn XP error:", err);
    }
  };

  const filteredAchievements = useMemo(
    () => gamState?.achievements.filter((a) => a.category === selectedCategory) ?? [],
    [gamState?.achievements, selectedCategory]
  );

  if (!gamState) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>載入中...</Text>
      </View>
    );
  }

  const xpProgressWidth = xpProgressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const getRarityColor = (rarity: string) => RARITY_COLORS[rarity] || RARITY_COLORS.common;

  const renderAchievementCard = (achievement: Achievement) => {
    const isLocked = !achievement.unlockedAt;
    const rarity = achievement.rarity;
    const rarityColor = getRarityColor(rarity);

    return (
      <TouchableOpacity
        key={achievement.id}
        onPress={() => {
          setSelectedAchievement(achievement);
          setShowAchievementModal(true);
        }}
        style={[
          styles.achievementCard,
          {
            width: ACHIEVEMENT_SIZE,
            height: ACHIEVEMENT_SIZE,
            backgroundColor: isLocked ? theme.colors.surface : theme.colors.surface,
            borderColor: isLocked ? theme.colors.border : rarityColor.border,
            shadowColor: isLocked ? "transparent" : rarityColor.glow,
          },
        ]}
      >
        <View style={styles.achievementInner}>
          {isLocked ? (
            <>
              <Ionicons name="lock-closed" size={32} color={theme.colors.textSecondary} />
              <Text style={[styles.achievementTitle, { color: theme.colors.muted, fontSize: 10 }]}>
                {achievement.title}
              </Text>
            </>
          ) : (
            <>
              <Ionicons
                name={achievement.icon as any}
                size={40}
                color={theme.colors.achievement}
              />
              <Text style={[styles.achievementTitle, { color: theme.colors.text }]}>
                {achievement.title}
              </Text>
              {achievement.maxProgress && (
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {achievement.progress}/{achievement.maxProgress}
                </Text>
              )}
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderLeaderboardEntry = (entry: LeaderboardEntry) => {
    let medalColor = theme.colors.text;
    let medalIcon: string = "ios-ellipse-outline";

    if (entry.rank === 1) {
      medalIcon = "medal";
      medalColor = "#FBBF24";
    } else if (entry.rank === 2) {
      medalIcon = "medal";
      medalColor = "#A1A1AA";
    } else if (entry.rank === 3) {
      medalIcon = "medal";
      medalColor = "#FCA5A5";
    }

    return (
      <View
        key={entry.userId}
        style={[
          styles.leaderboardRow,
          {
            backgroundColor: entry.isCurrentUser ? theme.colors.accentSoft : "transparent",
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.leaderboardRank}>
          <Ionicons name={medalIcon as any} size={20} color={medalColor} />
          <Text style={[styles.rankNumber, { color: theme.colors.text }]}>{entry.rank}</Text>
        </View>

        <View style={styles.leaderboardInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.leaderboardName, { color: theme.colors.text }]}>
              {entry.displayName}
            </Text>
            {entry.isCurrentUser && (
              <View
                style={[
                  styles.youBadge,
                  { backgroundColor: theme.colors.accent },
                ]}
              >
                <Text style={[styles.youBadgeText, { color: "#FFFFFF" }]}>你</Text>
              </View>
            )}
          </View>
          <Text style={[styles.leaderboardDept, { color: theme.colors.textSecondary }]}>
            {entry.department}
          </Text>
        </View>

        <View style={styles.leaderboardStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.colors.accent }]}>
              Lv.{entry.level}
            </Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>等級</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.colors.streak }]}>
              {entry.streakDays}
            </Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>連勝</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>
              {entry.xp}
            </Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>XP</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderWeeklyChallenge = (challenge: WeeklyChallenge) => {
    const progress = Math.min(challenge.current / challenge.target, 1);

    return (
      <View
        key={challenge.id}
        style={[
          styles.challengeCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.challengeHeader}>
          <View style={styles.challengeIconContainer}>
            <Ionicons name={challenge.icon as any} size={24} color={theme.colors.accent} />
          </View>
          <View style={styles.challengeTexts}>
            <Text style={[styles.challengeTitle, { color: theme.colors.text }]}>
              {challenge.title}
            </Text>
            <Text style={[styles.challengeDesc, { color: theme.colors.textSecondary }]}>
              {challenge.description}
            </Text>
          </View>
          {challenge.completed && (
            <Ionicons name="checkmark-circle" size={28} color={theme.colors.success} />
          )}
        </View>

        <View style={styles.challengeProgress}>
          <View
            style={[
              styles.progressBarBg,
              {
                backgroundColor: theme.colors.surface2,
              },
            ]}
          >
            <View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: theme.colors.growth,
                  width: `${progress * 100}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
            {challenge.current}/{challenge.target}
          </Text>
        </View>

        <View style={styles.challengeReward}>
          <Ionicons name="flash" size={14} color={theme.colors.achievement} />
          <Text style={[styles.rewardText, { color: theme.colors.achievement }]}>
            +{challenge.xpReward} XP
          </Text>
        </View>
      </View>
    );
  };

  const renderRecentXPGain = (item: { action: string; xp: number; timestamp: number }) => {
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

    return (
      <View
        key={item.timestamp}
        style={[
          styles.xpGainItem,
          {
            backgroundColor: theme.colors.surface2,
            borderLeftColor: theme.colors.growth,
          },
        ]}
      >
        <View style={styles.xpGainLeft}>
          <Text style={[styles.xpGainAction, { color: theme.colors.text }]}>
            {item.action}
          </Text>
          <Text style={[styles.xpGainTime, { color: theme.colors.textSecondary }]}>
            {timeStr}
          </Text>
        </View>
        <Text style={[styles.xpGainAmount, { color: theme.colors.growth }]}>
          +{item.xp} XP
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg,
            paddingTop: insets.top + theme.space.md,
            paddingHorizontal: theme.space.lg,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Hero Section ───── */}
        <View style={[styles.heroSection, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.heroTop}>
            <Ionicons
              name={gamState.levelInfo.icon as any}
              size={64}
              color={gamState.levelInfo.color}
              style={styles.levelIcon}
            />
          </View>

          <Text style={[styles.levelNumber, { color: theme.colors.text }]}>
            Lv.{gamState.level}
          </Text>
          <Text style={[styles.levelTitle, { color: theme.colors.accent }]}>
            {gamState.levelInfo.title}
          </Text>

          <View
            style={[
              styles.xpProgressContainer,
              {
                backgroundColor: theme.colors.surface2,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.xpProgressBar,
                {
                  width: xpProgressWidth,
                  backgroundColor: theme.colors.growth,
                },
              ]}
            />
          </View>

          <Text style={[styles.xpProgressText, { color: theme.colors.textSecondary }]}>
            距離下一級還需 {gamState.xpToNextLevel} XP
          </Text>

          <View style={styles.totalXPContainer}>
            <Ionicons name="flash" size={16} color={theme.colors.achievement} />
            <Text style={[styles.totalXPText, { color: theme.colors.text }]}>
              總 XP: {gamState.totalXP.toLocaleString()}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.testButton, { backgroundColor: theme.colors.accentSoft }]}
            onPress={handleEarnXP}
          >
            <Text style={[styles.testButtonText, { color: theme.colors.accent }]}>
              測試獲得 XP
            </Text>
          </TouchableOpacity>
        </View>

        {/* ───── Streak Section ───── */}
        <View style={[styles.section, { marginTop: theme.space.lg }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>連續打卡</Text>

          <View
            style={[
              styles.streakCard,
              {
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            <View style={styles.streakNumbers}>
              <View style={styles.streakItem}>
                <Text
                  style={[
                    styles.streakValue,
                    {
                      color:
                        gamState.streak.current > 0
                          ? theme.colors.streak
                          : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {gamState.streak.current}
                </Text>
                <Text style={[styles.streakLabel, { color: theme.colors.textSecondary }]}>
                  天連勝
                </Text>
                {gamState.streak.current > 0 && (
                  <Text style={styles.fireEmoji}>🔥</Text>
                )}
              </View>

              <View style={styles.streakDivider} />

              <View style={styles.streakItem}>
                <Text style={[styles.streakValue, { color: theme.colors.text }]}>
                  {gamState.streak.longest}
                </Text>
                <Text style={[styles.streakLabel, { color: theme.colors.textSecondary }]}>
                  天最長紀錄
                </Text>
              </View>
            </View>

            <View style={[styles.calendar, { marginTop: theme.space.md }]}>
              <View style={styles.calendarDays}>
                {Array.from({ length: 7 }).map((_, i) => {
                  const dayIndex = 6 - i;
                  const today = new Date();
                  const date = new Date(today.getTime() - dayIndex * 24 * 60 * 60 * 1000);
                  const dateStr = date.toISOString().split("T")[0];
                  const isCheckedIn = gamState.streak.history.includes(dateStr);

                  return (
                    <View key={i} style={styles.calendarDayWrapper}>
                      <View
                        style={[
                          styles.calendarDay,
                          {
                            backgroundColor: isCheckedIn
                              ? theme.colors.streak
                              : theme.colors.surface2,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.calendarDayLabel,
                          {
                            color: isCheckedIn
                              ? theme.colors.streak
                              : theme.colors.textSecondary,
                          },
                        ]}
                      >
                        {["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.checkInButton,
                {
                  backgroundColor: theme.colors.accent,
                },
              ]}
              onPress={handleDailyCheckIn}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
              <Text style={styles.checkInButtonText}>每日簽到</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ───── Weekly Challenges ───── */}
        <View style={[styles.section, { marginTop: theme.space.lg }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>本週挑戰</Text>

          {gamState.weeklyChallenges.map((challenge) =>
            renderWeeklyChallenge(challenge)
          )}
        </View>

        {/* ───── Achievement Tabs & Grid ───── */}
        <View style={[styles.section, { marginTop: theme.space.lg }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>成就徽章</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsContainer}
            scrollEventThrottle={16}
          >
            {ACHIEVEMENT_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                style={[
                  styles.categoryTab,
                  {
                    borderBottomColor:
                      selectedCategory === cat
                        ? theme.colors.accent
                        : "transparent",
                    borderBottomWidth: selectedCategory === cat ? 2 : 0,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.categoryTabText,
                    {
                      color:
                        selectedCategory === cat
                          ? theme.colors.accent
                          : theme.colors.textSecondary,
                    },
                  ]}
                >
                  {CATEGORY_LABELS[cat]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.achievementGrid}>
            {filteredAchievements.map((ach) => renderAchievementCard(ach))}
          </View>

          <View style={[styles.achievementCounter, { marginTop: theme.space.md }]}>
            <Text style={[styles.achievementCounterText, { color: theme.colors.textSecondary }]}>
              {gamState.unlockedCount}/{gamState.totalCount} 已解鎖
            </Text>
            <View
              style={[
                styles.achievementCounterBar,
                {
                  backgroundColor: theme.colors.surface2,
                },
              ]}
            >
              <View
                style={[
                  styles.achievementCounterFill,
                  {
                    backgroundColor: theme.colors.achievement,
                    width: `${(gamState.unlockedCount / gamState.totalCount) * 100}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* ───── Leaderboard ───── */}
        <View style={[styles.section, { marginTop: theme.space.lg }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>排行榜 TOP 10</Text>

          {gamState.leaderboard.slice(0, 10).map((entry) =>
            renderLeaderboardEntry(entry)
          )}
        </View>

        {/* ───── Recent XP Gains ───── */}
        <View style={[styles.section, { marginTop: theme.space.lg }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>最近獲得</Text>

          {gamState.recentXPGains.map((gain) =>
            renderRecentXPGain(gain)
          )}
        </View>
      </ScrollView>

      {/* ───── Achievement Modal ───── */}
      {selectedAchievement && (
        <Modal
          visible={showAchievementModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAchievementModal(false)}
        >
          <View style={[styles.modalOverlay, { backgroundColor: theme.colors.overlay }]}>
            <View
              style={[
                styles.modalContent,
                {
                  backgroundColor: theme.colors.surface,
                },
              ]}
            >
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setShowAchievementModal(false)}
              >
                <Ionicons name="close" size={28} color={theme.colors.text} />
              </TouchableOpacity>

              <Ionicons
                name={selectedAchievement.icon as any}
                size={64}
                color={
                  selectedAchievement.unlockedAt
                    ? theme.colors.achievement
                    : theme.colors.textSecondary
                }
                style={{ marginBottom: theme.space.md }}
              />

              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                {selectedAchievement.title}
              </Text>
              <Text style={[styles.modalDesc, { color: theme.colors.textSecondary }]}>
                {selectedAchievement.description}
              </Text>

              <View style={[styles.modalBadges, { marginTop: theme.space.md }]}>
                <View style={[styles.modalBadge, { backgroundColor: theme.colors.successSoft }]}>
                  <Text style={[styles.modalBadgeText, { color: theme.colors.success }]}>
                    +{selectedAchievement.xpReward} XP
                  </Text>
                </View>
                <View
                  style={[
                    styles.modalBadge,
                    {
                      backgroundColor:
                        selectedAchievement.rarity === "legendary"
                          ? theme.colors.achievementSoft
                          : theme.colors.accentSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modalBadgeText,
                      {
                        color:
                          selectedAchievement.rarity === "legendary"
                            ? theme.colors.achievement
                            : theme.colors.accent,
                      },
                    ]}
                  >
                    {selectedAchievement.rarity.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={[styles.modalCondition, { marginTop: theme.space.lg }]}>
                <Text style={[styles.modalConditionLabel, { color: theme.colors.textSecondary }]}>
                  解鎖條件
                </Text>
                <Text style={[styles.modalConditionText, { color: theme.colors.text }]}>
                  {selectedAchievement.condition}
                </Text>
              </View>

              {selectedAchievement.maxProgress && (
                <View style={[styles.modalProgress, { marginTop: theme.space.md }]}>
                  <View
                    style={[
                      styles.progressBarBg,
                      {
                        backgroundColor: theme.colors.surface2,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          backgroundColor: theme.colors.growth,
                          width: `${((selectedAchievement.progress ?? 0) / selectedAchievement.maxProgress) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.progressText,
                      { color: theme.colors.textSecondary, marginTop: theme.space.sm },
                    ]}
                  >
                    進度: {selectedAchievement.progress ?? 0}/{selectedAchievement.maxProgress}
                  </Text>
                </View>
              )}

              {selectedAchievement.unlockedAt && (
                <Text style={[styles.modalUnlockedDate, { marginTop: theme.space.lg }]}>
                  解鎖於{" "}
                  {new Date(selectedAchievement.unlockedAt).toLocaleDateString("zh-TW")}
                </Text>
              )}

              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: theme.colors.accent,
                  },
                ]}
                onPress={() => setShowAchievementModal(false)}
              >
                <Text style={styles.modalButtonText}>關閉</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 32,
    textAlign: "center",
  },

  // Hero Section
  heroSection: {
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heroTop: {
    marginBottom: theme.space.md,
  },
  levelIcon: {
    marginBottom: theme.space.sm,
  },
  levelNumber: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: theme.space.xs,
  },
  levelTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: theme.space.lg,
  },
  xpProgressContainer: {
    width: "100%",
    height: 12,
    borderRadius: theme.radius.full,
    overflow: "hidden",
    marginBottom: theme.space.md,
  },
  xpProgressBar: {
    height: "100%",
  },
  xpProgressText: {
    fontSize: 12,
    marginBottom: theme.space.lg,
  },
  totalXPContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.space.md,
  },
  totalXPText: {
    marginLeft: theme.space.xs,
    fontWeight: "600",
    fontSize: 14,
  },
  testButton: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
  },
  testButtonText: {
    fontWeight: "600",
    fontSize: 12,
  },

  // Section
  section: {},
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: theme.space.md,
  },

  // Streak
  streakCard: {
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  streakNumbers: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  streakItem: {
    alignItems: "center",
    flex: 1,
  },
  streakValue: {
    fontSize: 36,
    fontWeight: "800",
  },
  streakLabel: {
    fontSize: 12,
    marginTop: theme.space.xs,
  },
  fireEmoji: {
    fontSize: 20,
    marginTop: theme.space.xs,
  },
  streakDivider: {
    width: 1,
    height: 60,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.space.lg,
  },
  calendar: {},
  calendarDays: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  calendarDayWrapper: {
    alignItems: "center",
  },
  calendarDay: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.md,
    marginBottom: theme.space.xs,
  },
  calendarDayLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  checkInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    marginTop: theme.space.lg,
  },
  checkInButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    marginLeft: theme.space.sm,
  },

  // Challenges
  challengeCard: {
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.space.md,
  },
  challengeHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  challengeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    justifyContent: "center",
    alignItems: "center",
    marginRight: theme.space.md,
  },
  challengeTexts: {
    flex: 1,
  },
  challengeTitle: {
    fontWeight: "600",
    fontSize: 14,
  },
  challengeDesc: {
    fontSize: 12,
    marginTop: theme.space.xs,
  },
  challengeProgress: {
    marginTop: theme.space.md,
    flexDirection: "row",
    alignItems: "center",
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    borderRadius: theme.radius.full,
    overflow: "hidden",
    marginRight: theme.space.sm,
  },
  progressBarFill: {
    height: "100%",
  },
  progressText: {
    fontSize: 11,
    minWidth: 50,
    textAlign: "right",
  },
  challengeReward: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.space.md,
  },
  rewardText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: theme.space.xs,
  },

  // Achievements
  tabsContainer: {
    paddingBottom: theme.space.md,
  },
  categoryTab: {
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.sm,
    marginRight: theme.space.sm,
  },
  categoryTabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  achievementGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  achievementCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.sm,
    marginRight: theme.space.sm,
    marginBottom: theme.space.md,
    justifyContent: "center",
    alignItems: "center",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  achievementInner: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
  },
  achievementTitle: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: theme.space.xs,
    textAlign: "center",
  },
  achievementCounter: {
    alignItems: "center",
  },
  achievementCounterText: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: theme.space.sm,
  },
  achievementCounterBar: {
    width: "100%",
    height: 8,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  achievementCounterFill: {
    height: "100%",
  },

  // Leaderboard
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    marginBottom: theme.space.sm,
    borderRadius: theme.radius.md,
    borderBottomWidth: 1,
  },
  leaderboardRank: {
    alignItems: "center",
    marginRight: theme.space.lg,
  },
  rankNumber: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: theme.space.xs,
  },
  leaderboardInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  leaderboardName: {
    fontWeight: "600",
    fontSize: 14,
    marginRight: theme.space.sm,
  },
  youBadge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.sm,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  leaderboardDept: {
    fontSize: 11,
    marginTop: theme.space.xs,
  },
  leaderboardStats: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: theme.space.md,
  },
  statItem: {
    alignItems: "center",
    marginLeft: theme.space.lg,
  },
  statValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 10,
    marginTop: theme.space.xs,
  },

  // XP Gains
  xpGainItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderLeftWidth: 4,
    marginBottom: theme.space.sm,
  },
  xpGainLeft: {
    flex: 1,
  },
  xpGainAction: {
    fontWeight: "600",
    fontSize: 13,
  },
  xpGainTime: {
    fontSize: 11,
    marginTop: theme.space.xs,
  },
  xpGainAmount: {
    fontWeight: "700",
    fontSize: 14,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    borderRadius: theme.radius.lg,
    padding: theme.space.lg,
    width: "85%",
    maxWidth: 320,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalClose: {
    position: "absolute",
    top: theme.space.md,
    right: theme.space.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: theme.space.sm,
    textAlign: "center",
  },
  modalDesc: {
    fontSize: 13,
    textAlign: "center",
  },
  modalBadges: {
    flexDirection: "row",
  },
  modalBadge: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    marginHorizontal: theme.space.sm,
  },
  modalBadgeText: {
    fontWeight: "700",
    fontSize: 11,
  },
  modalCondition: {
    width: "100%",
  },
  modalConditionLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: theme.space.xs,
  },
  modalConditionText: {
    fontSize: 13,
  },
  modalProgress: {
    width: "100%",
  },
  modalUnlockedDate: {
    fontSize: 12,
    color: theme.colors.success,
    fontWeight: "600",
  },
  modalButton: {
    width: "100%",
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: theme.space.lg,
  },
  modalButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
