/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  LayoutAnimation,
  UIManager,
  Platform,
  Animated,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import {
  getStudyBuddyMatches,
  getStudyGroups,
  buildMyStudyProfile,
  submitCourseReview,
  getCourseReviewSummary,
  createStudyGroup,
  type BuddyMatch,
  type StudyGroup,
  type StudyProfile,
  type TimeSlot,
  type CourseReviewSummary,
} from '../services/studyBuddyEngine';
import { earnXP } from '../services/gamificationEngine';

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

type TabType = 'buddy' | 'group' | 'review';

const scoreColor = (score: number): string => {
  if (score >= 85) return theme.colors.success;
  if (score >= 70) return theme.colors.accent;
  return theme.colors.warning;
};

const DAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

function formatTimeSlot(slot: TimeSlot): string {
  return `${DAY_LABELS[slot.dayOfWeek] ?? `週${slot.dayOfWeek}`} ${String(slot.startHour).padStart(2, '0')}:00-${String(slot.endHour).padStart(2, '0')}:00`;
}

function formatStudyStyle(style: StudyProfile['studyStyle']): string {
  const parts = [
    style.preferGroup ? '小組' : '個人',
    style.preferQuiet ? '安靜' : '互動',
    style.preferOnline ? '線上' : '實體',
  ];
  if (style.preferTeaching) parts.push('可教學');
  if (style.preferLearning) parts.push('想補強');
  return parts.join(' / ');
}

// ============================================================================
// BUDDY MATCH CARD
// ============================================================================
interface BuddyMatchCardProps {
  match: BuddyMatch;
}

const BuddyMatchCard: React.FC<BuddyMatchCardProps> = ({ match }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const matchColor = scoreColor(match.matchScore);

  return (
    <Animated.View
      style={[
        styles.matchCard,
        {
          transform: [{ scale: scaleAnim }],
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <View style={styles.matchCardHeader}>
          <View style={styles.scoreCircle}>
            <View
              style={[styles.scoreInner, { backgroundColor: matchColor, borderColor: matchColor }]}
            >
              <Text style={[styles.scoreText, { color: '#fff' }]}>{match.matchScore}</Text>
            </View>
          </View>

          <View style={styles.matchCardInfo}>
            <Text style={[styles.matchName, { color: theme.colors.text }]}>
              {match.displayName}
            </Text>
            <Text style={[styles.matchDept, { color: theme.colors.textSecondary }]}>
              {match.department}
            </Text>
          </View>
        </View>

        {/* Shared Courses */}
        {match.sharedCourses && match.sharedCourses.length > 0 && (
          <View style={styles.tagsContainer}>
            {match.sharedCourses.slice(0, 3).map((course, idx) => (
              <View key={idx} style={[styles.tag, { backgroundColor: `${theme.colors.accent}20` }]}>
                <Text style={[styles.tagText, { color: theme.colors.accent }]}>{course}</Text>
              </View>
            ))}
            {match.sharedCourses.length > 3 && (
              <Text style={[styles.moreText, { color: theme.colors.textSecondary }]}>
                +{match.sharedCourses.length - 3}
              </Text>
            )}
          </View>
        )}

        {/* Complementary Subjects */}
        {match.complementaryPairs && match.complementaryPairs.length > 0 && (
          <View style={styles.complementarySection}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              互補科目
            </Text>
            <View style={styles.complementaryRow}>
              {match.complementaryPairs.slice(0, 2).map((pair, idx) => (
                <View key={idx} style={styles.complementaryPair}>
                  <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                  <Text style={[styles.complementaryText, { color: theme.colors.text }]}>
                    {pair.subject}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Match Reasons */}
        {match.reasons && match.reasons.length > 0 && (
          <View style={styles.reasonsSection}>
            {match.reasons.slice(0, 2).map((reason, idx) => (
              <View key={idx} style={styles.reasonItem}>
                <Ionicons name="star-outline" size={12} color={theme.colors.accent} />
                <Text style={[styles.reasonText, { color: theme.colors.text }]}>{reason}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Common Time Slots */}
        {match.commonTimeSlots && match.commonTimeSlots.length > 0 && (
          <View style={styles.timeSlotSection}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              共同空閒時段
            </Text>
            <View style={styles.timeSlotRow}>
              {match.commonTimeSlots.slice(0, 2).map((slot, idx) => (
                <View
                  key={idx}
                  style={[styles.timeSlot, { backgroundColor: `${theme.colors.social}15` }]}
                >
                  <Text style={[styles.timeSlotText, { color: theme.colors.social }]}>
                    {slot.day} {slot.time}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.colors.accent }]}>
          <Text style={styles.actionButtonText}>開始聊天</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ============================================================================
// STUDY GROUP CARD
// ============================================================================
interface StudyGroupCardProps {
  group: StudyGroup;
}

const StudyGroupCard: React.FC<StudyGroupCardProps> = ({ group }) => {
  const memberCount = group.members.length;
  const memberPercentage = (memberCount / group.maxMembers) * 100;
  const styleBadgeColor = (style: string) => {
    switch (style) {
      case 'collaborative':
        return theme.colors.social;
      case 'tutorial':
        return theme.colors.accent;
      case 'discussion':
        return theme.colors.success;
      case 'practice':
        return theme.colors.warning;
      default:
        return theme.colors.textSecondary;
    }
  };

  const styleLabel: Record<string, string> = {
    collaborative: '協作式',
    tutorial: '教學式',
    discussion: '討論式',
    practice: '練習式',
  };

  return (
    <View
      style={[
        styles.groupCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.groupHeader}>
        <View style={styles.groupTitleSection}>
          <Text style={[styles.groupName, { color: theme.colors.text }]}>{group.name}</Text>
          <Text style={[styles.groupCourse, { color: theme.colors.textSecondary }]}>
            {group.courseName}
          </Text>
        </View>
        <View style={[styles.styleBadge, { backgroundColor: `${styleBadgeColor(group.style)}20` }]}>
          <Text style={[styles.styleBadgeText, { color: styleBadgeColor(group.style) }]}>
            {styleLabel[group.style]}
          </Text>
        </View>
      </View>

      {/* Member Progress Bar */}
      <View style={styles.memberSection}>
        <View style={styles.memberBar}>
          <View
            style={[
              styles.memberProgress,
              {
                width: `${memberPercentage}%`,
                backgroundColor: theme.colors.accent,
              },
            ]}
          />
        </View>
        <Text style={[styles.memberText, { color: theme.colors.textSecondary }]}>
          {memberCount} / {group.maxMembers} 成員
        </Text>
      </View>

      {/* Meeting Schedule */}
      {group.meetingSchedule && (
        <View style={styles.scheduleSection}>
          <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} />
          <Text style={[styles.scheduleText, { color: theme.colors.textSecondary }]}>
            {group.meetingSchedule.map(formatTimeSlot).join('、')}
          </Text>
        </View>
      )}

      <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.colors.success }]}>
        <Text style={styles.actionButtonText}>加入讀書會</Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// MAIN SCREEN
// ============================================================================
export function StudyBuddyScreen() {
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<TabType>('buddy');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myProfile, setMyProfile] = useState<StudyProfile | null>(null);
  const [buddyMatches, setBuddyMatches] = useState<BuddyMatch[]>([]);
  const [studyGroups, setStudyGroups] = useState<StudyGroup[]>([]);
  const [courseReviewSummary, setCourseReviewSummary] = useState<CourseReviewSummary | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewDifficulty, setReviewDifficulty] = useState(0);
  const [reviewWorkload, setReviewWorkload] = useState(0);
  const [reviewUtility, setReviewUtility] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [profile, matches, groups, reviews] = await Promise.all([
        buildMyStudyProfile(),
        getStudyBuddyMatches(),
        getStudyGroups(),
        getCourseReviewSummary(''),
      ]);
      setMyProfile(profile);
      setBuddyMatches(matches);
      setStudyGroups(groups);
      setCourseReviewSummary(reviews);
    } catch (error) {
      console.error('Failed to load study buddy data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleTabChange = (tab: TabType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
  };

  const handleSubmitReview = async () => {
    if (!selectedCourse) return;

    try {
      await submitCourseReview(
        selectedCourse,
        selectedCourse,
        reviewRating,
        reviewDifficulty,
        reviewWorkload,
        reviewUtility,
        reviewComment,
        [],
      );
      await earnXP('write_review');

      // Reset form
      setReviewRating(0);
      setReviewDifficulty(0);
      setReviewWorkload(0);
      setReviewUtility(0);
      setReviewComment('');
      setSelectedCourse('');
      setShowReviewModal(false);

      await loadData();
    } catch (error) {
      console.error('Failed to submit review:', error);
    }
  };

  const renderStars = (rating: number, onRate: (r: number) => void, size = 24) => (
    <View style={styles.starsContainer}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity key={star} onPress={() => onRate(star)}>
          <Ionicons
            name={star <= rating ? 'star' : 'star-outline'}
            size={size}
            color={star <= rating ? theme.colors.warning : theme.colors.border}
          />
        </TouchableOpacity>
      ))}
    </View>
  );

  const sentimentBar = courseReviewSummary
    ? [
        courseReviewSummary.sentimentDistribution.positive,
        courseReviewSummary.sentimentDistribution.neutral,
        courseReviewSummary.sentimentDistribution.negative,
      ]
    : [0, 0, 0];

  const sentimentTotal = sentimentBar.reduce((a, b) => a + b, 1);
  const sentimentPercentages = sentimentBar.map((s) => (s / sentimentTotal) * 100);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top,
        },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg,
        }}
      >
        {/* ===== HEADER ===== */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>學習夥伴</Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
            AI 智慧配對，找到最適合的學伴
          </Text>
        </View>

        {/* ===== MY PROFILE CARD ===== */}
        {myProfile ? (
          <View
            style={[
              styles.profileCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text style={[styles.profileTitle, { color: theme.colors.text }]}>我的學習檔案</Text>
            <View style={styles.profileGrid}>
              <View style={styles.profileItem}>
                <Text style={[styles.profileLabel, { color: theme.colors.textSecondary }]}>
                  系所
                </Text>
                <Text style={[styles.profileValue, { color: theme.colors.text }]}>
                  {myProfile.department}
                </Text>
              </View>
              <View style={styles.profileItem}>
                <Text style={[styles.profileLabel, { color: theme.colors.textSecondary }]}>
                  學習風格
                </Text>
                <Text style={[styles.profileValue, { color: theme.colors.text }]}>
                  {formatStudyStyle(myProfile.studyStyle)}
                </Text>
              </View>
            </View>

            {myProfile.strengths && myProfile.strengths.length > 0 && (
              <View>
                <Text
                  style={[
                    styles.profileLabel,
                    { color: theme.colors.textSecondary, marginBottom: theme.space.sm },
                  ]}
                >
                  強科
                </Text>
                <View style={styles.strengthsTags}>
                  {myProfile.strengths.map((strength, idx) => (
                    <View
                      key={idx}
                      style={[styles.tag, { backgroundColor: `${theme.colors.success}20` }]}
                    >
                      <Text style={[styles.tagText, { color: theme.colors.success }]}>
                        {strength}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.emptyProfileButton,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.accent,
              },
            ]}
            onPress={loadData}
          >
            <Ionicons name="person-add-outline" size={32} color={theme.colors.accent} />
            <Text style={[styles.emptyProfileText, { color: theme.colors.accent }]}>
              建立個人檔案
            </Text>
          </TouchableOpacity>
        )}

        {/* ===== TAB SWITCHER ===== */}
        <View style={[styles.tabSwitcher, { borderBottomColor: theme.colors.border }]}>
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'buddy' && {
                borderBottomColor: theme.colors.accent,
              },
            ]}
            onPress={() => handleTabChange('buddy')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'buddy'
                  ? { color: theme.colors.accent }
                  : { color: theme.colors.textSecondary },
              ]}
            >
              夥伴配對
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'group' && {
                borderBottomColor: theme.colors.accent,
              },
            ]}
            onPress={() => handleTabChange('group')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'group'
                  ? { color: theme.colors.accent }
                  : { color: theme.colors.textSecondary },
              ]}
            >
              讀書會
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'review' && {
                borderBottomColor: theme.colors.accent,
              },
            ]}
            onPress={() => handleTabChange('review')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'review'
                  ? { color: theme.colors.accent }
                  : { color: theme.colors.textSecondary },
              ]}
            >
              課程評價
            </Text>
          </TouchableOpacity>
        </View>

        {/* ===== TAB CONTENT ===== */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
          </View>
        ) : (
          <>
            {/* BUDDY MATCHES */}
            {activeTab === 'buddy' && (
              <View style={styles.tabContent}>
                {buddyMatches && buddyMatches.length > 0 ? (
                  buddyMatches.map((match, idx) => <BuddyMatchCard key={idx} match={match} />)
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="person-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={[styles.emptyStateText, { color: theme.colors.textSecondary }]}>
                      暫無配對結果
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* STUDY GROUPS */}
            {activeTab === 'group' && (
              <View style={styles.tabContent}>
                {studyGroups && studyGroups.length > 0 ? (
                  studyGroups.map((group, idx) => <StudyGroupCard key={idx} group={group} />)
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={[styles.emptyStateText, { color: theme.colors.textSecondary }]}>
                      暫無讀書會
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.fab, { backgroundColor: theme.colors.success }]}
                  onPress={() => setShowReviewModal(false)}
                >
                  <Ionicons name="add" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {/* COURSE REVIEWS */}
            {activeTab === 'review' && (
              <View style={styles.tabContent}>
                {courseReviewSummary && (
                  <>
                    {/* Star Rating */}
                    <View
                      style={[
                        styles.reviewSummaryCard,
                        {
                          backgroundColor: theme.colors.surface,
                          borderColor: theme.colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.reviewSummaryTitle, { color: theme.colors.text }]}>
                        平均評分
                      </Text>
                      <View style={styles.averageRatingDisplay}>
                        <Text style={[styles.averageRating, { color: theme.colors.accent }]}>
                          {courseReviewSummary.averageRating?.toFixed(1) || 'N/A'}
                        </Text>
                        <View style={styles.starsSmall}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Ionicons
                              key={star}
                              name={
                                star <= Math.round(courseReviewSummary.averageRating || 0)
                                  ? 'star'
                                  : 'star-outline'
                              }
                              size={16}
                              color={theme.colors.warning}
                            />
                          ))}
                        </View>
                      </View>

                      {/* Sentiment Bar */}
                      <Text style={[styles.sentimentLabel, { color: theme.colors.textSecondary }]}>
                        評論情緒分佈
                      </Text>
                      <View style={styles.sentimentBar}>
                        <View
                          style={[
                            styles.sentimentSegment,
                            {
                              width: `${sentimentPercentages[0]}%`,
                              backgroundColor: theme.colors.success,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.sentimentSegment,
                            {
                              width: `${sentimentPercentages[1]}%`,
                              backgroundColor: theme.colors.textSecondary,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.sentimentSegment,
                            {
                              width: `${sentimentPercentages[2]}%`,
                              backgroundColor: theme.colors.warning,
                            },
                          ]}
                        />
                      </View>

                      <View style={styles.sentimentLegend}>
                        <View style={styles.legendItem}>
                          <View
                            style={[styles.legendDot, { backgroundColor: theme.colors.success }]}
                          />
                          <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                            正面
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View
                            style={[
                              styles.legendDot,
                              { backgroundColor: theme.colors.textSecondary },
                            ]}
                          />
                          <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                            中立
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View
                            style={[styles.legendDot, { backgroundColor: theme.colors.warning }]}
                          />
                          <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                            負面
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Reviews List */}
                    {courseReviewSummary.recentReviews &&
                      courseReviewSummary.recentReviews.length > 0 && (
                        <View>
                          <Text style={[styles.reviewsListTitle, { color: theme.colors.text }]}>
                            評價列表
                          </Text>
                          {courseReviewSummary.recentReviews.slice(0, 3).map((review, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.reviewItem,
                                {
                                  backgroundColor: theme.colors.surface,
                                  borderColor: theme.colors.border,
                                },
                              ]}
                            >
                              <View style={styles.reviewHeader}>
                                <View style={styles.reviewRatingSmall}>
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <Ionicons
                                      key={star}
                                      name={star <= (review.rating || 0) ? 'star' : 'star-outline'}
                                      size={12}
                                      color={theme.colors.warning}
                                    />
                                  ))}
                                </View>
                                <View
                                  style={[
                                    styles.sentimentBadge,
                                    {
                                      backgroundColor: `${
                                        review.sentiment === 'positive'
                                          ? theme.colors.success
                                          : review.sentiment === 'negative'
                                            ? theme.colors.warning
                                            : theme.colors.textSecondary
                                      }20`,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.sentimentBadgeText,
                                      {
                                        color:
                                          review.sentiment === 'positive'
                                            ? theme.colors.success
                                            : review.sentiment === 'negative'
                                              ? theme.colors.warning
                                              : theme.colors.textSecondary,
                                      },
                                    ]}
                                  >
                                    {review.sentiment === 'positive'
                                      ? '正面'
                                      : review.sentiment === 'negative'
                                        ? '負面'
                                        : '中立'}
                                  </Text>
                                </View>
                              </View>
                              <Text style={[styles.reviewComment, { color: theme.colors.text }]}>
                                {review.comment}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                  </>
                )}

                <TouchableOpacity
                  style={[styles.fab, { backgroundColor: theme.colors.accent }]}
                  onPress={() => setShowReviewModal(true)}
                >
                  <Ionicons name="pencil" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ===== REVIEW MODAL ===== */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: `${theme.colors.bg}E5` }]}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>寫課程評價</Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              {/* Course Selection */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>選擇課程</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.bg,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                placeholder="搜尋課程"
                placeholderTextColor={theme.colors.textSecondary}
                value={selectedCourse}
                onChangeText={setSelectedCourse}
              />

              {/* Overall Rating */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>整體評分</Text>
              {renderStars(reviewRating, setReviewRating)}

              {/* Difficulty */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>難度</Text>
              {renderStars(reviewDifficulty, setReviewDifficulty, 20)}

              {/* Workload */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>工作量</Text>
              {renderStars(reviewWorkload, setReviewWorkload, 20)}

              {/* Utility */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>實用性</Text>
              {renderStars(reviewUtility, setReviewUtility, 20)}

              {/* Comment */}
              <Text style={[styles.inputLabel, { color: theme.colors.text }]}>評論</Text>
              <TextInput
                style={[
                  styles.inputMultiline,
                  {
                    backgroundColor: theme.colors.bg,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                placeholder="分享你對這門課的想法..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={4}
                value={reviewComment}
                onChangeText={setReviewComment}
              />

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: theme.colors.accent }]}
                onPress={handleSubmitReview}
              >
                <Text style={styles.submitButtonText}>提交評價</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.lg,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: theme.space.sm,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  profileCard: {
    marginHorizontal: theme.space.lg,
    marginBottom: theme.space.lg,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
  },
  profileTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: theme.space.md,
  },
  profileGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.space.md,
  },
  profileItem: {
    flex: 1,
  },
  profileLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: theme.space.xs,
  },
  profileValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  strengthsTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
  },
  emptyProfileButton: {
    marginHorizontal: theme.space.lg,
    marginBottom: theme.space.lg,
    paddingVertical: theme.space.xl,
    alignItems: 'center',
    borderRadius: theme.radius.lg,
    borderWidth: 2,
  },
  emptyProfileText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: theme.space.md,
  },
  tabSwitcher: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: theme.space.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.space.md,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabContent: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.lg,
  },
  loadingContainer: {
    paddingVertical: theme.space.xl * 2,
    alignItems: 'center',
  },
  matchCard: {
    marginBottom: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
  },
  matchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space.md,
  },
  scoreCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.space.md,
  },
  scoreInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
  },
  matchCardInfo: {
    flex: 1,
  },
  matchName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: theme.space.xs,
  },
  matchDept: {
    fontSize: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    marginBottom: theme.space.md,
  },
  tag: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.sm,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  moreText: {
    fontSize: 12,
    fontWeight: '500',
    alignSelf: 'center',
  },
  complementarySection: {
    marginBottom: theme.space.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: theme.space.sm,
  },
  complementaryRow: {
    flexDirection: 'row',
    gap: theme.space.sm,
  },
  complementaryPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  complementaryText: {
    fontSize: 12,
  },
  reasonsSection: {
    marginBottom: theme.space.md,
    gap: theme.space.sm,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  reasonText: {
    fontSize: 12,
    flex: 1,
  },
  timeSlotSection: {
    marginBottom: theme.space.md,
  },
  timeSlotRow: {
    flexDirection: 'row',
    gap: theme.space.sm,
  },
  timeSlot: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
  },
  timeSlotText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionButton: {
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  groupCard: {
    marginBottom: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.space.md,
  },
  groupTitleSection: {
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: theme.space.xs,
  },
  groupCourse: {
    fontSize: 12,
  },
  styleBadge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.sm,
  },
  styleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  memberSection: {
    marginBottom: theme.space.md,
  },
  memberBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: theme.space.sm,
  },
  memberProgress: {
    height: '100%',
  },
  memberText: {
    fontSize: 12,
  },
  scheduleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    marginBottom: theme.space.md,
  },
  scheduleText: {
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    bottom: theme.space.lg + TAB_BAR_CONTENT_BOTTOM_PADDING,
    right: theme.space.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewSummaryCard: {
    marginBottom: theme.space.lg,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
  },
  reviewSummaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: theme.space.md,
  },
  averageRatingDisplay: {
    alignItems: 'center',
    marginBottom: theme.space.lg,
  },
  averageRating: {
    fontSize: 36,
    fontWeight: '700',
    marginBottom: theme.space.sm,
  },
  starsSmall: {
    flexDirection: 'row',
    gap: theme.space.xs,
  },
  sentimentLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: theme.space.sm,
  },
  sentimentBar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: theme.space.md,
  },
  sentimentSegment: {
    height: '100%',
  },
  sentimentLegend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
  },
  reviewsListTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: theme.space.md,
    marginTop: theme.space.lg,
  },
  reviewItem: {
    marginBottom: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.space.md,
  },
  reviewRatingSmall: {
    flexDirection: 'row',
    gap: 2,
  },
  sentimentBadge: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.sm,
  },
  sentimentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  reviewComment: {
    fontSize: 12,
    lineHeight: 18,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: theme.space.md,
    marginBottom: theme.space.lg,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: theme.space.xl * 2,
  },
  emptyStateText: {
    fontSize: 14,
    marginTop: theme.space.md,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '90%',
    borderTopWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalScroll: {
    padding: theme.space.lg,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: theme.space.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    marginBottom: theme.space.lg,
    fontSize: 14,
  },
  inputMultiline: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    marginBottom: theme.space.lg,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  submitButton: {
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    marginVertical: theme.space.lg,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
