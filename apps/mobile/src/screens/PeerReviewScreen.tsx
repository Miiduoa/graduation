/* eslint-disable */
import React, { useState } from "react";
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  AnimatedCard,
  Button,
  SegmentedControl,
} from "../ui/components";
import { theme } from "../ui/theme";

// Types
type ReviewTab = "assigned" | "received";

interface PeerSubmission {
  id: string;
  peerName: string;
  peerLabel: string;
  submissionDate: string;
  content: string;
  reviewStatus: "pending" | "completed";
}

interface ReviewCriterion {
  key: string;
  label: string;
  chineseName: string;
  rating: number;
}

interface ReceivedReview {
  id: string;
  reviewerLabel: string;
  submissionDate: string;
  criteria: ReviewCriterion[];
  overallScore: number;
  comment: string;
}

interface ReviewFormState {
  submissionId: string;
  criteria: ReviewCriterion[];
  comment: string;
}

// Demo data
const DEMO_SUBMISSIONS: PeerSubmission[] = [
  {
    id: "peer_1",
    peerName: "李明哲",
    peerLabel: "同學 A",
    submissionDate: "2026-03-20 14:30",
    content: `我們的研究主題是「青少年社群媒體使用與心理健康的關係」。透過問卷調查和訪談，我們發現過度使用社群媒體確實與焦慮症狀呈正相關。

特別是在睡眠前一小時內使用社群媒體的青少年，其睡眠品質明顯下降。我們進一步分析了不同平台的影響，發現短影片平台對心理健康的負面影響最大。

基於這些發現，我們建議青少年應該建立健康的使用習慣，包括設定使用時間限制和建立無手機區域。`,
    reviewStatus: "pending",
  },
  {
    id: "peer_2",
    peerName: "王思柔",
    peerLabel: "同學 B",
    submissionDate: "2026-03-19 10:15",
    content: `我的專題是關於「人工智能在教育中的應用」。我研究了ChatGPT、Claude等大語言模型如何改變學習方式。

實驗結果表明，使用AI工具輔助學習的學生在理解複雜概念時效率提高了35%。但同時也發現了過度依賴AI可能導致批判性思維能力下降的風險。

我建議採用「人機協作」模式，讓AI作為助學工具而非替代品。`,
    reviewStatus: "pending",
  },
  {
    id: "peer_3",
    peerName: "陳俊宇",
    peerLabel: "同學 C",
    submissionDate: "2026-03-18 16:45",
    content: `本研究探討「永續時尚與消費者行為」的關係。我透過訪談20位時尚愛好者，分析他們購買決策的環境因素。

結果發現，雖然87%的受訪者表示關心環境，但實際購買行為卻不一致。主要障礙包括價格較高、款式選擇少和品牌知名度不足。

未來應從供給端（品牌端）和消費教育著手，才能真正推動永續時尚產業發展。`,
    reviewStatus: "pending",
  },
];

const DEMO_RECEIVED_REVIEWS: ReceivedReview[] = [
  {
    id: "review_1",
    reviewerLabel: "同學 D",
    submissionDate: "2026-03-21 09:20",
    criteria: [
      { key: "completeness", label: "內容完整性", chineseName: "完整性", rating: 4 },
      { key: "clarity", label: "邏輯清晰度", chineseName: "清晰度", rating: 5 },
      { key: "expression", label: "表達能力", chineseName: "表達", rating: 4 },
      { key: "creativity", label: "創意與見解", chineseName: "創意", rating: 3 },
      { key: "formatting", label: "格式與排版", chineseName: "排版", rating: 4 },
    ],
    overallScore: 4,
    comment: "內容論述非常清楚，邏輯結構良好。建議加強創意見解的部分，提供更多自己的看法而不只是文獻回顧。",
  },
  {
    id: "review_2",
    reviewerLabel: "同學 E",
    submissionDate: "2026-03-20 15:10",
    criteria: [
      { key: "completeness", label: "內容完整性", chineseName: "完整性", rating: 5 },
      { key: "clarity", label: "邏輯清晰度", chineseName: "清晰度", rating: 4 },
      { key: "expression", label: "表達能力", chineseName: "表達", rating: 5 },
      { key: "creativity", label: "創意與見解", chineseName: "創意", rating: 4 },
      { key: "formatting", label: "格式與排版", chineseName: "排版", rating: 5 },
    ],
    overallScore: 4.6,
    comment: "非常優秀的作品！資料蒐集完整，分析深入，表達清晰。唯一建議是可以添加更多圖表來視覺化呈現數據。",
  },
];

const REVIEW_CRITERIA: Array<{ key: string; label: string; chineseName: string }> = [
  { key: "completeness", label: "內容完整性", chineseName: "Content Completeness" },
  { key: "clarity", label: "邏輯清晰度", chineseName: "Logical Clarity" },
  { key: "expression", label: "表達能力", chineseName: "Expression Quality" },
  { key: "creativity", label: "創意與見解", chineseName: "Creativity & Insight" },
  { key: "formatting", label: "格式與排版", chineseName: "Formatting" },
];

const RATING_LABELS = ["差", "普通", "好", "很好", "優秀"];

export function PeerReviewScreen(props: any) {
  const nav = props?.navigation;
  const route = props?.route;
  const { assignmentId, groupId, title } = route?.params ?? {};

  const [activeTab, setActiveTab] = useState<ReviewTab>("assigned");
  const [selectedSubmission, setSelectedSubmission] = useState<PeerSubmission | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewFormState | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Handle star rating
  const handleRatingChange = (criterionKey: string, rating: number) => {
    if (!reviewForm) return;
    setReviewForm({
      ...reviewForm,
      criteria: reviewForm.criteria.map((c) =>
        c.key === criterionKey ? { ...c, rating } : c
      ),
    });
  };

  // Start reviewing
  const startReview = (submission: PeerSubmission) => {
    setSelectedSubmission(submission);
    setReviewForm({
      submissionId: submission.id,
      criteria: REVIEW_CRITERIA.map((c) => ({
        key: c.key,
        label: c.label,
        chineseName: c.chineseName,
        rating: 0,
      })),
      comment: "",
    });
  };

  // Submit review
  const submitReview = async () => {
    if (!reviewForm) return;

    const allRated = reviewForm.criteria.every((c) => c.rating > 0);
    const commentValid = reviewForm.comment.trim().length >= 20;

    if (!allRated) {
      Alert.alert("請完成評分", "請為所有項目評分");
      return;
    }

    if (!commentValid) {
      Alert.alert("評論不完整", "請輸入至少20個字的評論");
      return;
    }

    setShowConfirmDialog(true);
  };

  // Confirm and finalize submission
  const confirmSubmit = async () => {
    setShowConfirmDialog(false);
    Alert.alert("提交成功", "你的評論已提交給系統", [
      {
        text: "確認",
        onPress: () => {
          setSelectedSubmission(null);
          setReviewForm(null);
        },
      },
    ]);
  };

  // Calculate average score
  const getAverageScore = (reviews: ReceivedReview[]) => {
    if (reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, review) => acc + review.overallScore, 0);
    return (sum / reviews.length).toFixed(1);
  };

  // Review submission modal
  if (reviewForm && selectedSubmission) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Screen noPadding>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}
          >
            {/* Header */}
            <View style={{ marginBottom: theme.space.lg }}>
              <Pressable
                onPress={() => {
                  setSelectedSubmission(null);
                  setReviewForm(null);
                }}
                style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.space.md }}
              >
                <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: "600" }}>
                  返回
                </Text>
              </Pressable>
              <Text style={{ fontSize: 20, fontWeight: "700", color: theme.colors.text }}>
                評閱：{selectedSubmission.peerLabel}
              </Text>
              <Text style={{ fontSize: 14, color: theme.colors.muted, marginTop: 4 }}>
                {selectedSubmission.submissionDate}
              </Text>
            </View>

            {/* Submission Content Preview */}
            <AnimatedCard
              title="提交內容"
              delay={100}
            >
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  color: theme.colors.text,
                }}
              >
                {selectedSubmission.content}
              </Text>
            </AnimatedCard>

            {/* Review Form */}
            <View style={{ marginTop: theme.space.lg }}>
              <AnimatedCard title="評分表" delay={200}>
                <View style={{ gap: theme.space.lg }}>
                {reviewForm.criteria.map((criterion, idx) => {
                  const criterion_info = REVIEW_CRITERIA.find((c) => c.key === criterion.key);
                  return (
                    <View key={criterion.key} style={{ gap: 12 }}>
                      <View>
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "600",
                            color: theme.colors.text,
                          }}
                        >
                          {criterion_info?.label}
                        </Text>
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.muted,
                            marginTop: 2,
                          }}
                        >
                          {criterion_info?.chineseName}
                        </Text>
                      </View>

                      {/* Star Rating */}
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Pressable
                            key={star}
                            onPress={() => handleRatingChange(criterion.key, star)}
                            style={{ padding: 8 }}
                          >
                            <Ionicons
                              name={criterion.rating >= star ? "star" : "star-outline"}
                              size={28}
                              color={
                                criterion.rating >= star
                                  ? theme.colors.achievement
                                  : theme.colors.muted
                              }
                            />
                          </Pressable>
                        ))}
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.muted,
                            marginLeft: 8,
                            flex: 1,
                          }}
                        >
                          {criterion.rating > 0 ? RATING_LABELS[criterion.rating - 1] : "未評分"}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </AnimatedCard>
            </View>

            {/* Comment Section */}
            <View style={{ marginTop: theme.space.lg }}>
              <AnimatedCard
                title="整體評論"
                subtitle="必填，至少20個字"
                delay={300}
              >
              <TextInput
                placeholder="輸入你的評論和建議..."
                placeholderTextColor={theme.colors.muted}
                value={reviewForm.comment}
                onChangeText={(text) =>
                  setReviewForm({ ...reviewForm, comment: text })
                }
                multiline
                numberOfLines={5}
                style={{
                  backgroundColor: theme.colors.surface2,
                  borderRadius: theme.radius.md,
                  padding: theme.space.md,
                  color: theme.colors.text,
                  fontSize: 15,
                  lineHeight: 20,
                  textAlignVertical: "top",
                  fontFamily: Platform.OS === "android" ? "Roboto" : undefined,
                }}
              />
              <Text
                style={{
                  fontSize: 12,
                  color:
                    reviewForm.comment.length >= 20
                      ? theme.colors.success
                      : theme.colors.muted,
                  marginTop: 8,
                }}
              >
                {reviewForm.comment.length}/20 字元
              </Text>
            </AnimatedCard>
            </View>

            {/* Action Buttons */}
            <View
              style={{
                flexDirection: "row",
                gap: theme.space.md,
                marginTop: theme.space.lg,
                paddingBottom: theme.space.xl,
              }}
            >
              <View style={{ flex: 1 }}>
                <Button
                  text="取消"
                  kind="secondary"
                  onPress={() => {
                    setSelectedSubmission(null);
                    setReviewForm(null);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  text="提交評審"
                  kind="primary"
                  onPress={submitReview}
                  disabled={reviewForm.comment.length < 20}
                />
              </View>
            </View>
          </ScrollView>

          {/* Confirmation Dialog */}
          {showConfirmDialog && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: theme.colors.overlay,
                alignItems: "center",
                justifyContent: "center",
                padding: theme.space.lg,
              }}
            >
              <View
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.xl,
                  padding: theme.space.lg,
                  maxWidth: 300,
                }}
              >
                <Text
                  style={{
                    fontSize: 17,
                    fontWeight: "700",
                    color: theme.colors.text,
                    marginBottom: theme.space.md,
                  }}
                >
                  確認提交？
                </Text>
                <Text
                  style={{
                    fontSize: 15,
                    color: theme.colors.textSecondary,
                    lineHeight: 22,
                    marginBottom: theme.space.lg,
                  }}
                >
                  評論一旦提交將無法修改。請確認你的評分和評論無誤。
                </Text>
                <View style={{ flexDirection: "row", gap: theme.space.md }}>
                  <Pressable
                    onPress={() => setShowConfirmDialog(false)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: theme.colors.accent,
                      }}
                    >
                      返回編輯
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={confirmSubmit}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      backgroundColor: theme.colors.accent,
                      borderRadius: theme.radius.md,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: "#FFFFFF",
                      }}
                    >
                      確認提交
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  // Main screen - Assigned or Received reviews
  return (
    <Screen>
      {/* Header */}
      <View style={{ marginBottom: theme.space.lg }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: theme.colors.text }}>
          同儕互評
        </Text>
        {title && (
          <Text style={{ fontSize: 15, color: theme.colors.muted, marginTop: 4 }}>
            {title}
          </Text>
        )}
      </View>

      {/* Tab Control */}
      <View style={{ marginBottom: theme.space.lg }}>
        <SegmentedControl
          options={[
            { key: "assigned", label: "待評作業" },
            { key: "received", label: "我收到的評價" },
          ]}
          selected={activeTab}
          onChange={(key) => setActiveTab(key)}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {activeTab === "assigned" ? (
          <View style={{ gap: theme.space.md, paddingBottom: theme.space.xl }}>
            {/* Progress Summary */}
            <AnimatedCard delay={50}>
              <View style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: theme.colors.text,
                    }}
                  >
                    評審進度
                  </Text>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "700",
                      color: theme.colors.accent,
                    }}
                  >
                    已完成 1/3 篇
                  </Text>
                </View>

                {/* Progress Bar */}
                <View
                  style={{
                    height: 8,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: theme.radius.sm,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: "33.33%",
                      backgroundColor: theme.colors.success,
                    }}
                  />
                </View>

                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.muted,
                  }}
                >
                  截止日期：2026-03-28 23:59
                </Text>
              </View>
            </AnimatedCard>

            {/* Submission List */}
            {DEMO_SUBMISSIONS.map((submission, idx) => (
              <AnimatedCard
                key={submission.id}
                delay={100 + idx * 80}
              >
                <View style={{ gap: 12 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "600",
                          color: theme.colors.text,
                        }}
                      >
                        {submission.peerLabel}
                      </Text>
                      <Text
                        style={{
                          fontSize: 13,
                          color: theme.colors.muted,
                          marginTop: 4,
                        }}
                      >
                        {submission.submissionDate}
                      </Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        backgroundColor:
                          submission.reviewStatus === "completed"
                            ? theme.colors.successSoft
                            : theme.colors.warningSoft,
                        borderRadius: theme.radius.sm,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color:
                            submission.reviewStatus === "completed"
                              ? theme.colors.success
                              : theme.colors.warning,
                        }}
                      >
                        {submission.reviewStatus === "completed"
                          ? "已評審"
                          : "待評審"}
                      </Text>
                    </View>
                  </View>

                  {/* Preview */}
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.textSecondary,
                      lineHeight: 18,
                    }}
                    numberOfLines={2}
                  >
                    {submission.content}
                  </Text>

                  {/* Action Button */}
                  {submission.reviewStatus === "pending" && (
                    <Button
                      text="開始評審"
                      kind="accent-ghost"
                      size="small"
                      icon="edit-outline"
                      onPress={() => startReview(submission)}
                    />
                  )}
                </View>
              </AnimatedCard>
            ))}
          </View>
        ) : (
          <View style={{ gap: theme.space.md, paddingBottom: theme.space.xl }}>
            {/* Average Score Summary */}
            <AnimatedCard delay={50}>
              <View style={{ gap: 16, alignItems: "center" }}>
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.muted,
                    fontWeight: "500",
                  }}
                >
                  平均評分
                </Text>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Text
                    style={{
                      fontSize: 48,
                      fontWeight: "700",
                      color: theme.colors.accent,
                    }}
                  >
                    {getAverageScore(DEMO_RECEIVED_REVIEWS)}
                  </Text>
                  <View style={{ justifyContent: "flex-end", paddingBottom: 6 }}>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                          key={star}
                          name={
                            star <=
                            Math.round(
                              parseFloat(
                                String(getAverageScore(DEMO_RECEIVED_REVIEWS))
                              )
                            )
                              ? "star"
                              : "star-outline"
                          }
                          size={20}
                          color={theme.colors.achievement}
                        />
                      ))}
                    </View>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: theme.colors.muted }}>
                  共 {DEMO_RECEIVED_REVIEWS.length} 份評價
                </Text>
              </View>
            </AnimatedCard>

            {/* Received Reviews */}
            {DEMO_RECEIVED_REVIEWS.map((review, idx) => (
              <AnimatedCard
                key={review.id}
                delay={100 + idx * 80}
              >
                <View style={{ gap: 12 }}>
                  <View>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "600",
                        color: theme.colors.text,
                      }}
                    >
                      {review.reviewerLabel}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.colors.muted,
                        marginTop: 2,
                      }}
                    >
                      {review.submissionDate}
                    </Text>
                  </View>

                  {/* Score Grid */}
                  <View style={{ gap: 10 }}>
                    {review.criteria.map((criterion) => (
                      <View
                        key={criterion.key}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          paddingVertical: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.separator,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.textSecondary,
                            flex: 1,
                          }}
                        >
                          {criterion.label}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Ionicons
                              key={star}
                              name={
                                criterion.rating >= star
                                  ? "star"
                                  : "star-outline"
                              }
                              size={16}
                              color={
                                criterion.rating >= star
                                  ? theme.colors.achievement
                                  : theme.colors.muted
                              }
                            />
                          ))}
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: "600",
                              color: theme.colors.text,
                              marginLeft: 6,
                              minWidth: 20,
                            }}
                          >
                            {criterion.rating}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Overall Score */}
                  <View
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: theme.colors.surface2,
                      borderRadius: theme.radius.md,
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: theme.colors.text,
                      }}
                    >
                      綜合評分
                    </Text>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "700",
                        color: theme.colors.accent,
                      }}
                    >
                      {review.overallScore}
                    </Text>
                  </View>

                  {/* Comment */}
                  <View style={{ backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md, padding: 12 }}>
                    <Text
                      style={{
                        fontSize: 13,
                        lineHeight: 18,
                        color: theme.colors.text,
                      }}
                    >
                      {review.comment}
                    </Text>
                  </View>
                </View>
              </AnimatedCard>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
