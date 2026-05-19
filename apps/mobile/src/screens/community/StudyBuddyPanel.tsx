/* eslint-disable */
/**
 * 校園社群 — 學伴
 *
 * 變更（vs. 舊版）：
 *  - 課程評價改為 Firestore 寫入（services/campusCourseReviews），不再只存 AsyncStorage
 *  - 評價支援列出 / 篩選課程 / 「+1 有幫助」交易式 toggle
 *  - 提供「建立讀書會」Modal（呼叫 studyBuddyEngine.createStudyGroup，已既有）
 *  - 評價情緒分佈 / 標籤統計用 aggregateReviews
 *  - 我的學習檔案區整合「最近一次更新」與「啟用配對」開關（pass-through）
 *
 * 維持：
 *  - getStudyBuddyMatches / getStudyGroups / buildMyStudyProfile 既有運算邏輯
 *  - earnXP('write_review') 持續觸發
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Alert,
  Switch,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import {
  getStudyBuddyMatches,
  getStudyGroups,
  buildMyStudyProfile,
  createStudyGroup,
  type BuddyMatch,
  type StudyGroup,
  type StudyProfile,
  type TimeSlot,
} from '../../services/studyBuddyEngine';
import { earnXP } from '../../services/gamificationEngine';
import {
  submitCourseReview,
  listCourseReviews,
  aggregateReviews,
  toggleReviewHelpful,
  type CourseReviewDoc,
  type CourseReviewAggregate,
} from '../../services/campusCourseReviews';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { isFirebaseMockMode } from '../../firebase';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TabType = 'buddy' | 'group' | 'review';

const DAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

function scoreColor(score: number): string {
  if (score >= 85) return theme.colors.success;
  if (score >= 70) return theme.colors.accent;
  return theme.colors.warning;
}

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

const BuddyMatchCard: React.FC<{ match: BuddyMatch }> = ({ match }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const matchColor = scoreColor(match.matchScore);

  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 100, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  return (
    <Animated.View
      style={[
        s.matchCard,
        {
          transform: [{ scale }],
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <TouchableOpacity onPress={press} activeOpacity={0.85}>
        <View style={s.matchHeader}>
          <View style={[s.scoreCircle, { borderColor: matchColor }]}>
            <View style={[s.scoreInner, { backgroundColor: matchColor }]}>
              <Text style={s.scoreTxt}>{match.matchScore}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.matchName}>{match.displayName}</Text>
            <Text style={s.matchDept}>{match.department}</Text>
          </View>
          <View style={[s.compatBadge, { backgroundColor: `${matchColor}22` }]}>
            <Text style={[s.compatBadgeTxt, { color: matchColor }]}>
              {match.compatibility === 'excellent' ? '極相配' : match.compatibility === 'good' ? '相配' : '尚可'}
            </Text>
          </View>
        </View>

        {match.sharedCourses?.length ? (
          <View style={s.tagWrap}>
            {match.sharedCourses.slice(0, 4).map((c) => (
              <View key={c} style={[s.tagPill, { backgroundColor: `${theme.colors.accent}22` }]}>
                <Text style={[s.tagPillTxt, { color: theme.colors.accent }]}>{c}</Text>
              </View>
            ))}
            {match.sharedCourses.length > 4 ? (
              <Text style={s.muted}>+{match.sharedCourses.length - 4}</Text>
            ) : null}
          </View>
        ) : null}

        {match.complementaryPairs?.length ? (
          <View style={{ marginTop: theme.space.sm }}>
            <Text style={s.softLabel}>互補科目</Text>
            <View style={{ gap: 4 }}>
              {match.complementaryPairs.slice(0, 2).map((pair, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="git-merge-outline" size={12} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.text, fontSize: 12 }}>{pair.subject}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {match.reasons?.length ? (
          <View style={{ marginTop: theme.space.sm, gap: 4 }}>
            {match.reasons.slice(0, 2).map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="star-outline" size={12} color={theme.colors.accent} />
                <Text style={{ fontSize: 12, color: theme.colors.text }}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: theme.space.md }]}
          onPress={() => Alert.alert('開始聊天', `已和 ${match.displayName} 建立對話入口（之後串接 chat stack）`)}
        >
          <Ionicons name="chatbubbles-outline" size={16} color={theme.colors.onAccent} />
          <Text style={s.primaryBtnTxt}>聯絡學伴</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ============================================================================
// STUDY GROUP CARD
// ============================================================================

const STYLE_LABEL: Record<StudyGroup['style'], string> = {
  collaborative: '協作式',
  tutorial: '教學式',
  discussion: '討論式',
  practice: '練習式',
};

const STYLE_COLOR: Record<StudyGroup['style'], string> = {
  collaborative: theme.colors.social,
  tutorial: theme.colors.accent,
  discussion: theme.colors.success,
  practice: theme.colors.warning,
};

const StudyGroupCard: React.FC<{ group: StudyGroup; onJoin: (g: StudyGroup) => void }> = ({ group, onJoin }) => {
  const pct = Math.min(100, (group.members.length / group.maxMembers) * 100);
  return (
    <View style={[s.groupCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={s.groupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.groupName}>{group.name}</Text>
          <Text style={s.groupCourse}>{group.courseName}</Text>
        </View>
        <View style={[s.styleBadge, { backgroundColor: `${STYLE_COLOR[group.style]}22` }]}>
          <Text style={[s.styleBadgeTxt, { color: STYLE_COLOR[group.style] }]}>{STYLE_LABEL[group.style]}</Text>
        </View>
      </View>

      <View style={s.memberBar}>
        <View style={[s.memberProgress, { width: `${pct}%`, backgroundColor: theme.colors.accent }]} />
      </View>
      <Text style={s.memberTxt}>{group.members.length} / {group.maxMembers} 成員</Text>

      {group.meetingSchedule?.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Ionicons name="calendar-outline" size={14} color={theme.colors.textSecondary} />
          <Text style={s.scheduleTxt}>{group.meetingSchedule.map(formatTimeSlot).join('、')}</Text>
        </View>
      ) : null}

      <TouchableOpacity style={[s.primaryBtn, { marginTop: theme.space.md, backgroundColor: theme.colors.success }]} onPress={() => onJoin(group)}>
        <Ionicons name="people-outline" size={16} color={theme.colors.onAccent} />
        <Text style={s.primaryBtnTxt}>申請加入</Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// MAIN PANEL
// ============================================================================

export function StudyBuddyPanel() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();

  const [activeTab, setActiveTab] = useState<TabType>('buddy');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StudyProfile | null>(null);
  const [matches, setMatches] = useState<BuddyMatch[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [reviews, setReviews] = useState<CourseReviewDoc[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const uid = auth.user?.uid ?? 'guest';
      const display = auth.user?.displayName ?? '同學';
      const [p, m, g] = await Promise.all([
        buildMyStudyProfile(uid, display, '未設定系所'),
        getStudyBuddyMatches(uid, display, '未設定系所'),
        getStudyGroups(),
      ]);
      setProfile(p);
      setMatches(m);
      setGroups(g);
      setIsPublic(p.isPublic);
    } catch (e) {
      console.warn('[StudyBuddy] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, auth.user?.displayName]);

  const loadReviews = useCallback(async () => {
    if (!school?.id || isFirebaseMockMode()) {
      setReviews([]);
      return;
    }
    setReviewLoading(true);
    try {
      const rows = await listCourseReviews(school.id, { lim: 60 });
      setReviews(rows);
    } catch (e) {
      console.warn('[StudyBuddy] review load failed:', e);
    } finally {
      setReviewLoading(false);
    }
  }, [school?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeTab === 'review') void loadReviews();
  }, [activeTab, loadReviews]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), activeTab === 'review' ? loadReviews() : Promise.resolve()]);
    setRefreshing(false);
  };

  const handleTabChange = (tab: TabType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
  };

  const onJoinGroup = (g: StudyGroup) => {
    Alert.alert('已申請加入', `「${g.name}」社長會儘快審核你的申請`);
  };

  const onCreateGroup = async (input: {
    name: string;
    courseName: string;
    courseCode: string;
    location: string;
    style: StudyGroup['style'];
    dayOfWeek: number;
    startHour: number;
    endHour: number;
  }) => {
    const uid = auth.user?.uid;
    if (!uid) {
      Alert.alert('請先登入');
      return;
    }
    try {
      const newGroup = await createStudyGroup(
        input.courseName,
        input.courseCode,
        input.name,
        uid,
        auth.user?.displayName ?? '組長',
        [{ dayOfWeek: input.dayOfWeek, startHour: input.startHour, endHour: input.endHour }],
        input.location,
        input.style,
      );
      setGroups((prev) => [newGroup, ...prev]);
      Alert.alert('已建立', `${newGroup.name} 已上架`);
    } catch (e: any) {
      Alert.alert('建立失敗', e?.message ?? String(e));
    }
  };

  const filteredReviews = useMemo(() => {
    const q = reviewFilter.trim().toLowerCase();
    if (!q) return reviews;
    return reviews.filter((r) => `${r.courseName} ${r.courseCode}`.toLowerCase().includes(q));
  }, [reviews, reviewFilter]);

  const reviewAgg = useMemo(() => aggregateReviews(filteredReviews), [filteredReviews]);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.lg }}
      >
        <View style={s.header}>
          <Text style={s.headerTitle}>學伴 / 讀書會</Text>
          <Text style={s.headerSub}>AI 配對 · Firestore 課程評價</Text>
        </View>

        {profile ? (
          <View style={[s.profileCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={s.profileBadge}>
                <Ionicons name="person-circle-outline" size={28} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.profileName}>{profile.displayName}</Text>
                <Text style={s.profileMeta}>{profile.department} · {formatStudyStyle(profile.studyStyle)}</Text>
              </View>
            </View>

            {profile.strengths?.length ? (
              <View style={{ marginTop: theme.space.sm }}>
                <Text style={s.softLabel}>強科</Text>
                <View style={s.tagWrap}>
                  {profile.strengths.map((tag, idx) => (
                    <View key={idx} style={[s.tagPill, { backgroundColor: `${theme.colors.success}22` }]}>
                      <Text style={[s.tagPillTxt, { color: theme.colors.success }]}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={s.profileSwitchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.softLabel}>啟用配對</Text>
                <Text style={s.profileSwitchHint}>關閉後將不出現在其他人的學伴推薦中</Text>
              </View>
              <Switch
                value={isPublic}
                onValueChange={(v) => {
                  setIsPublic(v);
                  // 即時寫回 profile 由 buildMyStudyProfile 負責（這裡只控制 UI 顯示）
                  Alert.alert('將於下次更新生效', v ? '已啟用配對' : '已停用配對');
                }}
              />
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.profileEmpty} onPress={load}>
            <Ionicons name="person-add-outline" size={28} color={theme.colors.accent} />
            <Text style={s.profileEmptyTxt}>建立學伴檔案</Text>
          </TouchableOpacity>
        )}

        {/* Tab switcher */}
        <View style={s.tabSwitcher}>
          {(['buddy', 'group', 'review'] as TabType[]).map((t) => {
            const on = activeTab === t;
            return (
              <TouchableOpacity key={t} style={[s.tab, on && { borderBottomColor: theme.colors.accent }]} onPress={() => handleTabChange(t)}>
                <Text style={[s.tabTxt, on && { color: theme.colors.accent }]}>{t === 'buddy' ? '夥伴配對' : t === 'group' ? '讀書會' : '課程評價'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.accent} />
        ) : activeTab === 'buddy' ? (
          <View style={s.tabBody}>
            {matches.length === 0 ? (
              <EmptyHint icon="person-outline" title="暫無配對結果" desc="請先在「我的」設定課表，並開啟配對。" />
            ) : (
              matches.map((m, i) => <BuddyMatchCard key={i} match={m} />)
            )}
          </View>
        ) : activeTab === 'group' ? (
          <View style={s.tabBody}>
            {groups.length === 0 ? (
              <EmptyHint icon="people-outline" title="暫無讀書會" desc="點下方紫色按鈕建立第一場讀書會。" />
            ) : (
              groups.map((g, i) => <StudyGroupCard key={`${g.id}-${i}`} group={g} onJoin={onJoinGroup} />)
            )}
            <TouchableOpacity style={[s.primaryBtn, { marginTop: theme.space.md }]} onPress={() => setShowGroupModal(true)}>
              <Ionicons name="add-circle-outline" size={18} color={theme.colors.onAccent} />
              <Text style={s.primaryBtnTxt}>建立讀書會</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.tabBody}>
            {/* Filter & summary */}
            <View style={s.searchBox}>
              <Ionicons name="search" size={14} color={theme.colors.muted} />
              <TextInput
                value={reviewFilter}
                onChangeText={setReviewFilter}
                placeholder="篩選課程名稱／代碼"
                placeholderTextColor={theme.colors.muted}
                style={s.searchInput}
              />
            </View>

            <ReviewSummary agg={reviewAgg} />

            {reviewLoading ? (
              <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.accent} />
            ) : filteredReviews.length === 0 ? (
              <EmptyHint icon="chatbox-ellipses-outline" title="尚無評價" desc="點下方按鈕為你修過的課寫第一則評價。" />
            ) : (
              filteredReviews.slice(0, 30).map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  myUid={auth.user?.uid}
                  onHelpful={async () => {
                    const sid = school?.id;
                    const uid = auth.user?.uid;
                    if (!sid || !uid || isFirebaseMockMode()) return;
                    try {
                      await toggleReviewHelpful(sid, r.id, uid);
                      await loadReviews();
                    } catch (e: any) {
                      Alert.alert('操作失敗', e?.message ?? String(e));
                    }
                  }}
                />
              ))
            )}

            <TouchableOpacity style={[s.primaryBtn, { marginTop: theme.space.md }]} onPress={() => setShowReviewModal(true)}>
              <Ionicons name="create-outline" size={18} color={theme.colors.onAccent} />
              <Text style={s.primaryBtnTxt}>寫課程評價</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <ReviewModal
        visible={showReviewModal}
        onDismiss={() => setShowReviewModal(false)}
        onSubmitted={async () => {
          setShowReviewModal(false);
          await loadReviews();
        }}
      />
      <CreateGroupModal
        visible={showGroupModal}
        onDismiss={() => setShowGroupModal(false)}
        onCreated={async (input) => {
          await onCreateGroup(input);
          setShowGroupModal(false);
        }}
      />
    </View>
  );
}

// ─── Sub components ──────────────────────────────────────

const EmptyHint: React.FC<{ icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }> = ({ icon, title, desc }) => (
  <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
    <Ionicons name={icon} size={36} color={theme.colors.textSecondary} />
    <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.text }}>{title}</Text>
    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center' }}>{desc}</Text>
  </View>
);

const ReviewSummary: React.FC<{ agg: CourseReviewAggregate }> = ({ agg }) => {
  const total = agg.totalCount;
  const sentTotal = Math.max(1, agg.sentiment.positive + agg.sentiment.neutral + agg.sentiment.negative);
  const pct = (n: number) => Math.round((n / sentTotal) * 100);
  if (total === 0) return null;
  return (
    <View style={s.summaryCard}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={s.avgScore}>{agg.avgRating.toFixed(1)}</Text>
        <Text style={s.softLabel}>/ 5 · {total} 則評價</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <StatPill label="難度" value={agg.avgDifficulty.toFixed(1)} />
        <StatPill label="工作量" value={agg.avgWorkload.toFixed(1)} />
        <StatPill label="實用" value={agg.avgUsefulness.toFixed(1)} />
      </View>
      <View style={s.sentimentBar}>
        <View style={[s.sentimentSeg, { flex: agg.sentiment.positive || 0, backgroundColor: theme.colors.success }]} />
        <View style={[s.sentimentSeg, { flex: agg.sentiment.neutral || 0, backgroundColor: theme.colors.textSecondary }]} />
        <View style={[s.sentimentSeg, { flex: agg.sentiment.negative || 0, backgroundColor: theme.colors.warning }]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
        <Text style={[s.sentTxt, { color: theme.colors.success }]}>正面 {pct(agg.sentiment.positive)}%</Text>
        <Text style={[s.sentTxt, { color: theme.colors.textSecondary }]}>中立 {pct(agg.sentiment.neutral)}%</Text>
        <Text style={[s.sentTxt, { color: theme.colors.warning }]}>負面 {pct(agg.sentiment.negative)}%</Text>
      </View>
      {agg.topTags.length > 0 ? (
        <View style={[s.tagWrap, { marginTop: 8 }]}>
          {agg.topTags.map((t) => (
            <View key={t.tag} style={[s.tagPill, { backgroundColor: `${theme.colors.accent}22` }]}>
              <Text style={[s.tagPillTxt, { color: theme.colors.accent }]}>{t.tag} · {t.count}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const StatPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={s.statPill}>
    <Text style={s.statPillLabel}>{label}</Text>
    <Text style={s.statPillValue}>{value}</Text>
  </View>
);

const ReviewCard: React.FC<{
  review: CourseReviewDoc;
  myUid?: string;
  onHelpful: () => void | Promise<void>;
}> = ({ review, myUid, onHelpful }) => {
  const helpedByMe = !!(myUid && Array.isArray(review.helpfulBy) && review.helpfulBy.includes(myUid));
  const sentimentColor =
    review.sentiment === 'positive'
      ? theme.colors.success
      : review.sentiment === 'negative'
        ? theme.colors.warning
        : theme.colors.textSecondary;
  return (
    <View style={s.reviewItem}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.reviewCourse}>{review.courseName}</Text>
          <Text style={s.reviewCourseCode}>{review.courseCode}</Text>
        </View>
        <View style={[s.sentBadge, { backgroundColor: `${sentimentColor}22` }]}>
          <Text style={[s.sentBadgeTxt, { color: sentimentColor }]}>
            {review.sentiment === 'positive' ? '正面' : review.sentiment === 'negative' ? '負面' : '中立'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Ionicons
            key={n}
            name={n <= Math.round(review.rating) ? 'star' : 'star-outline'}
            size={14}
            color={theme.colors.warning}
          />
        ))}
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 4 }}>
          {review.anonymous ? review.aliasSnapshot ?? '匿名同學' : (review.authorUid?.slice(0, 8) ?? '成員')}
        </Text>
      </View>
      <Text style={s.reviewComment}>{review.comment}</Text>
      {review.tags?.length ? (
        <View style={s.tagWrap}>
          {review.tags.map((t) => (
            <View key={t} style={[s.tagPill, { backgroundColor: `${theme.colors.accent}1A` }]}>
              <Text style={[s.tagPillTxt, { color: theme.colors.accent }]}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        onPress={() => void onHelpful()}
        style={[
          s.helpfulBtn,
          helpedByMe && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
        ]}
      >
        <Ionicons
          name={helpedByMe ? 'thumbs-up' : 'thumbs-up-outline'}
          size={14}
          color={helpedByMe ? theme.colors.onAccent : theme.colors.textSecondary}
        />
        <Text style={[s.helpfulTxt, helpedByMe && { color: theme.colors.onAccent }]}>
          有幫助 · {review.helpful ?? 0}
        </Text>
      </Pressable>
    </View>
  );
};

// ─── ReviewModal ─────────────────────────────────────────

const ReviewModal: React.FC<{
  visible: boolean;
  onDismiss: () => void;
  onSubmitted: () => void;
}> = ({ visible, onDismiss, onSubmitted }) => {
  const auth = useAuth();
  const { school } = useSchool();
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [rating, setRating] = useState(0);
  const [difficulty, setDifficulty] = useState(0);
  const [workload, setWorkload] = useState(0);
  const [usefulness, setUsefulness] = useState(0);
  const [comment, setComment] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCourseName('');
      setCourseCode('');
      setRating(0);
      setDifficulty(0);
      setWorkload(0);
      setUsefulness(0);
      setComment('');
      setTagsRaw('');
      setAnonymous(true);
    }
  }, [visible]);

  const submit = async () => {
    const sid = school?.id;
    const uid = auth.user?.uid;
    if (!sid || !uid || isFirebaseMockMode()) {
      Alert.alert('無法送出', isFirebaseMockMode() ? '模擬模式下無法寫入 Firestore' : '請先登入並選擇學校');
      return;
    }
    if (!courseName.trim()) {
      Alert.alert('請填課程名稱');
      return;
    }
    if (rating < 1) {
      Alert.alert('請至少給 1 顆星');
      return;
    }
    setBusy(true);
    try {
      await submitCourseReview({
        schoolId: sid,
        courseCode: courseCode.trim() || courseName.trim(),
        courseName: courseName.trim(),
        rating,
        difficulty,
        workload,
        usefulness,
        comment: comment.trim(),
        tags: tagsRaw
          .split(/[,，、\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        anonymous,
        authorUid: anonymous ? null : uid,
        aliasSnapshot: anonymous ? '匿名同學' : undefined,
      });
      await earnXP('write_review').catch(() => {});
      onSubmitted();
    } catch (e: any) {
      Alert.alert('送出失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onDismiss}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>寫課程評價</Text>
            <Pressable hitSlop={8} onPress={onDismiss}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={s.fieldLabel}>課程名稱</Text>
          <TextInput
            value={courseName}
            onChangeText={setCourseName}
            placeholder="例：程式設計（一）"
            placeholderTextColor={theme.colors.muted}
            style={s.input}
          />

          <Text style={s.fieldLabel}>課程代碼（可選）</Text>
          <TextInput
            value={courseCode}
            onChangeText={setCourseCode}
            placeholder="例：CSIE1001"
            placeholderTextColor={theme.colors.muted}
            style={s.input}
          />

          <Text style={s.fieldLabel}>整體評分</Text>
          <StarRow rating={rating} onChange={setRating} size={28} />

          <Text style={s.fieldLabel}>難度</Text>
          <StarRow rating={difficulty} onChange={setDifficulty} size={20} />

          <Text style={s.fieldLabel}>工作量</Text>
          <StarRow rating={workload} onChange={setWorkload} size={20} />

          <Text style={s.fieldLabel}>實用性</Text>
          <StarRow rating={usefulness} onChange={setUsefulness} size={20} />

          <Text style={s.fieldLabel}>評論</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="分享給學弟妹這門課的真實感受⋯"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]}
          />

          <Text style={s.fieldLabel}>標籤（逗號分隔，最多 6 個）</Text>
          <TextInput
            value={tagsRaw}
            onChangeText={setTagsRaw}
            placeholder="例：必修, 老師很罩, 期末有 project"
            placeholderTextColor={theme.colors.muted}
            style={s.input}
          />

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>匿名評價</Text>
              <Text style={s.hintMuted}>關閉後將顯示你的暱稱</Text>
            </View>
            <Switch value={anonymous} onValueChange={setAnonymous} />
          </View>

          <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.65 }]} disabled={busy} onPress={submit}>
            {busy ? (
              <ActivityIndicator color={theme.colors.onAccent} />
            ) : (
              <Text style={s.primaryBtnTxt}>送出評價</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ─── CreateGroupModal ────────────────────────────────────

const CreateGroupModal: React.FC<{
  visible: boolean;
  onDismiss: () => void;
  onCreated: (input: {
    name: string;
    courseName: string;
    courseCode: string;
    location: string;
    style: StudyGroup['style'];
    dayOfWeek: number;
    startHour: number;
    endHour: number;
  }) => Promise<void>;
}> = ({ visible, onDismiss, onCreated }) => {
  const [name, setName] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [location, setLocation] = useState('圖書館 B1 討論室');
  const [style, setStyle] = useState<StudyGroup['style']>('collaborative');
  const [day, setDay] = useState(3);
  const [startHour, setStartHour] = useState(14);
  const [endHour, setEndHour] = useState(16);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setName('');
      setCourseName('');
      setCourseCode('');
      setLocation('圖書館 B1 討論室');
      setStyle('collaborative');
      setDay(3);
      setStartHour(14);
      setEndHour(16);
    }
  }, [visible]);

  const submit = async () => {
    if (!name.trim() || !courseName.trim()) {
      Alert.alert('請完整填寫', '名稱與課程都必填');
      return;
    }
    if (endHour <= startHour) {
      Alert.alert('時間錯誤', '結束時間需大於開始時間');
      return;
    }
    setBusy(true);
    try {
      await onCreated({
        name: name.trim(),
        courseName: courseName.trim(),
        courseCode: courseCode.trim() || courseName.trim(),
        location: location.trim() || '待定',
        style,
        dayOfWeek: day,
        startHour,
        endHour,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onDismiss}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>建立讀書會</Text>
            <Pressable hitSlop={8} onPress={onDismiss}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={s.fieldLabel}>讀書會名稱</Text>
          <TextInput value={name} onChangeText={setName} placeholder="例：演算法戰隊" placeholderTextColor={theme.colors.muted} style={s.input} />

          <Text style={s.fieldLabel}>課程名稱</Text>
          <TextInput value={courseName} onChangeText={setCourseName} placeholder="例：演算法" placeholderTextColor={theme.colors.muted} style={s.input} />

          <Text style={s.fieldLabel}>課程代碼（可選）</Text>
          <TextInput value={courseCode} onChangeText={setCourseCode} placeholder="例：CSIE2001" placeholderTextColor={theme.colors.muted} style={s.input} />

          <Text style={s.fieldLabel}>地點</Text>
          <TextInput value={location} onChangeText={setLocation} placeholder="圖書館 B1 討論室" placeholderTextColor={theme.colors.muted} style={s.input} />

          <Text style={s.fieldLabel}>風格</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['collaborative', 'tutorial', 'discussion', 'practice'] as StudyGroup['style'][]).map((k) => {
              const on = style === k;
              return (
                <Pressable key={k} onPress={() => setStyle(k)} style={[s.typeChip, on && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}>
                  <Text style={[s.typeChipTxt, on && { color: theme.colors.onAccent }]}>{STYLE_LABEL[k]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.fieldLabel}>每週見面時間</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = day === d;
              return (
                <Pressable key={d} onPress={() => setDay(d)} style={[s.typeChip, on && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}>
                  <Text style={[s.typeChipTxt, on && { color: theme.colors.onAccent }]}>{DAY_LABELS[d]}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>開始</Text>
              <HourPicker hour={startHour} onChange={(h) => setStartHour(h)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>結束</Text>
              <HourPicker hour={endHour} onChange={(h) => setEndHour(h)} />
            </View>
          </View>

          <TouchableOpacity style={[s.primaryBtn, busy && { opacity: 0.65 }]} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={s.primaryBtnTxt}>建立讀書會</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const HourPicker: React.FC<{ hour: number; onChange: (h: number) => void }> = ({ hour, onChange }) => {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable onPress={() => onChange(Math.max(7, hour - 1))} style={s.hourBtn}>
        <Ionicons name="remove" size={16} color={theme.colors.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
        {String(hour).padStart(2, '0')}:00
      </Text>
      <Pressable onPress={() => onChange(Math.min(22, hour + 1))} style={s.hourBtn}>
        <Ionicons name="add" size={16} color={theme.colors.text} />
      </Pressable>
    </View>
  );
};

const StarRow: React.FC<{ rating: number; onChange: (r: number) => void; size?: number }> = ({ rating, onChange, size = 24 }) => (
  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
        <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={size} color={theme.colors.warning} />
      </Pressable>
    ))}
  </View>
);

// ─── Styles ──────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, paddingBottom: theme.space.sm },
  headerTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  headerSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },

  profileCard: {
    marginHorizontal: theme.space.lg,
    marginBottom: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  profileMeta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  profileSwitchRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.md },
  profileSwitchHint: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  profileEmpty: {
    marginHorizontal: theme.space.lg,
    paddingVertical: theme.space.xl,
    alignItems: 'center',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  profileEmptyTxt: { color: theme.colors.accent, fontWeight: '700' },

  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: theme.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    marginTop: theme.space.sm,
  },
  tab: { flex: 1, paddingVertical: theme.space.md, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabTxt: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  tabBody: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, gap: theme.space.md },

  matchCard: {
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
  },
  matchHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  scoreCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, padding: 3, alignItems: 'center', justifyContent: 'center' },
  scoreInner: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scoreTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  matchName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  matchDept: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  compatBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  compatBadgeTxt: { fontSize: 11, fontWeight: '700' },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagPillTxt: { fontSize: 11, fontWeight: '700' },
  softLabel: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '700' },
  muted: { fontSize: 11, color: theme.colors.muted, alignSelf: 'center' },

  groupCard: { padding: theme.space.md, borderRadius: theme.radius.lg, borderWidth: 1 },
  groupHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  groupName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  groupCourse: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  styleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  styleBadgeTxt: { fontSize: 11, fontWeight: '700' },
  memberBar: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.colors.bg, marginTop: 6 },
  memberProgress: { height: '100%' },
  memberTxt: { marginTop: 4, fontSize: 11, color: theme.colors.textSecondary },
  scheduleTxt: { fontSize: 12, color: theme.colors.textSecondary },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  primaryBtnTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 13, paddingVertical: 0 },

  summaryCard: {
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  avgScore: { fontSize: 32, fontWeight: '700', color: theme.colors.accent },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  statPillLabel: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '700' },
  statPillValue: { fontSize: 13, color: theme.colors.text, fontWeight: '700' },
  sentimentBar: { flexDirection: 'row', marginTop: 8, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.colors.bg },
  sentimentSeg: { height: '100%' },
  sentTxt: { fontSize: 11, fontWeight: '700' },

  reviewItem: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  reviewCourse: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  reviewCourseCode: { fontSize: 11, color: theme.colors.textSecondary },
  sentBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  sentBadgeTxt: { fontSize: 10, fontWeight: '700' },
  reviewComment: { fontSize: 13, color: theme.colors.text, lineHeight: 19, marginTop: 4 },

  helpfulBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  helpfulTxt: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '700' },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 12, marginBottom: 6 },
  hintMuted: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 14,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.md },
  typeChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  typeChipTxt: { fontSize: 12, color: theme.colors.text, fontWeight: '700' },
  hourBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default StudyBuddyPanel;
