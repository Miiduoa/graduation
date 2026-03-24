/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../ui/theme";
import { Screen, Card, Button, AnimatedCard, Pill } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";

// ============================================================================
// Type Definitions
// ============================================================================

type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "fill_in_blank";

interface QuizQuestion {
  id: string;
  questionNum: number;
  prompt: string;
  type: QuestionType;
  options?: string[];
  correctAnswers?: string[];
  points?: number;
}

interface QuizAnswer {
  questionId: string;
  type: QuestionType;
  answer: string | string[];
}

interface QuizResult {
  questionId: string;
  questionNum: number;
  prompt: string;
  type: QuestionType;
  userAnswer: string | string[];
  correctAnswer?: string | string[];
  isCorrect: boolean;
  points?: number;
  earnedPoints: number;
}

// ============================================================================
// Demo Questions Generator (for when data source is unavailable)
// ============================================================================

function generateDemoQuestions(count: number = 8): QuizQuestion[] {
  const singleChoiceQuestions = [
    {
      id: "q1",
      questionNum: 1,
      prompt: "下列何者為市場經濟的主要特徵？",
      type: "single_choice" as const,
      options: ["A. 政府完全控制生產", "B. 供求關係決定價格", "C. 計劃經濟制度", "D. 公社集體生產"],
      correctAnswers: ["B. 供求關係決定價格"],
      points: 10,
    },
    {
      id: "q2",
      questionNum: 2,
      prompt: "以下哪個選項正確表示光合作用的過程？",
      type: "single_choice" as const,
      options: ["A. 水和氮 → 葡萄糖", "B. 水和二氧化碳 + 光照 → 葡萄糖和氧氣", "C. 葡萄糖 → 能量", "D. 磷和鉀 → 蛋白質"],
      correctAnswers: ["B. 水和二氧化碳 + 光照 → 葡萄糖和氧氣"],
      points: 10,
    },
    {
      id: "q3",
      questionNum: 3,
      prompt: "法國大革命發生於哪一年？",
      type: "single_choice" as const,
      options: ["A. 1789 年", "B. 1815 年", "C. 1848 年", "D. 1871 年"],
      correctAnswers: ["A. 1789 年"],
      points: 10,
    },
  ];

  const multipleChoiceQuestions = [
    {
      id: "q4",
      questionNum: 4,
      prompt: "下列哪些物質是必需胺基酸？（可複選）",
      type: "multiple_choice" as const,
      options: ["A. 異白胺酸", "B. 麩胺酸", "C. 白胺酸", "D. 絲胺酸"],
      correctAnswers: ["A. 異白胺酸", "C. 白胺酸"],
      points: 15,
    },
    {
      id: "q5",
      questionNum: 5,
      prompt: "以下何者屬於再生能源？（可複選）",
      type: "multiple_choice" as const,
      options: ["A. 太陽能", "B. 煤炭", "C. 風力能", "D. 天然氣"],
      correctAnswers: ["A. 太陽能", "C. 風力能"],
      points: 15,
    },
  ];

  const trueFalseQuestions = [
    {
      id: "q6",
      questionNum: 6,
      prompt: "地球上最高的山峰是喜馬拉雅山的聖母峰。",
      type: "true_false" as const,
      options: ["True（正確）", "False（錯誤）"],
      correctAnswers: ["True（正確）"],
      points: 5,
    },
    {
      id: "q7",
      questionNum: 7,
      prompt: "一個八邊形有 8 條對角線。",
      type: "true_false" as const,
      options: ["True（正確）", "False（錯誤）"],
      correctAnswers: ["False（錯誤）"],
      points: 5,
    },
  ];

  const fillInBlankQuestions = [
    {
      id: "q8",
      questionNum: 8,
      prompt: "杜甫是唐代著名詩人，被尊稱為「______」。",
      type: "fill_in_blank" as const,
      correctAnswers: ["詩聖"],
      points: 10,
    },
  ];

  const all = [...singleChoiceQuestions, ...multipleChoiceQuestions, ...trueFalseQuestions, ...fillInBlankQuestions];
  return all.slice(0, count);
}

// ============================================================================
// Timer Component
// ============================================================================

function CountdownTimer({
  initialSeconds,
  onExpire,
}: {
  initialSeconds: number;
  onExpire: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpire();
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          onExpire();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft, onExpire]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isLowTime = secondsLeft < 300; // Less than 5 minutes

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: theme.radius.md,
        backgroundColor: isLowTime ? theme.colors.dangerSoft : theme.colors.accentSoft,
      }}
    >
      <Ionicons
        name="time-outline"
        size={18}
        color={isLowTime ? theme.colors.danger : theme.colors.accent}
      />
      <Text
        style={{
          color: isLowTime ? theme.colors.danger : theme.colors.accent,
          fontWeight: "700",
          fontSize: 14,
        }}
      >
        {minutes}:{seconds.toString().padStart(2, "0")}
      </Text>
    </View>
  );
}

// ============================================================================
// Question Navigator Component
// ============================================================================

function QuestionNavigator({
  totalQuestions,
  currentQuestion,
  answeredQuestions,
  onNavigate,
}: {
  totalQuestions: number;
  currentQuestion: number;
  answeredQuestions: Set<string>;
  onNavigate: (questionNum: number) => void;
}) {
  return (
    <View
      style={{
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      }}
    >
      <Text style={{ fontSize: 12, color: theme.colors.muted, fontWeight: "600" }}>
        題目進度
      </Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {Array.from({ length: totalQuestions }, (_, i) => {
          const questionNum = i + 1;
          const isAnswered = answeredQuestions.has(`q${questionNum}`);
          const isCurrent = currentQuestion === questionNum;

          return (
            <Pressable
              key={`nav-${questionNum}`}
              onPress={() => onNavigate(questionNum)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: theme.radius.md,
                backgroundColor: isCurrent
                  ? theme.colors.accent
                  : isAnswered
                    ? theme.colors.successSoft
                    : theme.colors.surface,
                borderWidth: isCurrent ? 2 : 1,
                borderColor: isCurrent ? theme.colors.accentHover : theme.colors.border,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  color: isCurrent
                    ? "#FFF"
                    : isAnswered
                      ? theme.colors.success
                      : theme.colors.text,
                  fontWeight: "700",
                  fontSize: 13,
                }}
              >
                {questionNum}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================================
// Progress Bar Component
// ============================================================================

function ProgressBar({
  answeredCount,
  totalCount,
}: {
  answeredCount: number;
  totalCount: number;
}) {
  const progress = (answeredCount / totalCount) * 100;

  return (
    <View style={{ gap: 6, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 13, color: theme.colors.muted, fontWeight: "600" }}>
          進度
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.accent, fontWeight: "700" }}>
          {answeredCount} / {totalCount}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surface2,
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={{
            height: "100%",
            width: `${progress}%`,
            backgroundColor: theme.colors.success,
          }}
        />
      </View>
    </View>
  );
}

// ============================================================================
// Single Choice Question Component
// ============================================================================

function SingleChoiceQuestion({
  question,
  answer,
  onChange,
}: {
  question: QuizQuestion;
  answer: string | string[] | undefined;
  onChange: (value: string) => void;
}) {
  const currentAnswer = Array.isArray(answer) ? answer[0] : answer;

  return (
    <View style={{ gap: 12 }}>
      {question.options?.map((option, idx) => {
        const isSelected = currentAnswer === option;

        return (
          <Pressable
            key={`option-${idx}`}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              borderRadius: theme.radius.md,
              borderWidth: 2,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface2,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 2,
                borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                backgroundColor: isSelected ? theme.colors.accent : "transparent",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={14} color="#FFF" />
              )}
            </View>
            <Text
              style={{
                flex: 1,
                color: theme.colors.text,
                fontSize: 15,
                fontWeight: "500",
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================================
// Multiple Choice Question Component
// ============================================================================

function MultipleChoiceQuestion({
  question,
  answer,
  onChange,
}: {
  question: QuizQuestion;
  answer: string | string[] | undefined;
  onChange: (value: string[]) => void;
}) {
  const currentAnswers = Array.isArray(answer) ? answer : answer ? [answer] : [];

  const toggleOption = (option: string) => {
    if (currentAnswers.includes(option)) {
      onChange(currentAnswers.filter((a) => a !== option));
    } else {
      onChange([...currentAnswers, option]);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {question.options?.map((option, idx) => {
        const isSelected = currentAnswers.includes(option);

        return (
          <Pressable
            key={`option-${idx}`}
            onPress={() => toggleOption(option)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              borderRadius: theme.radius.md,
              borderWidth: 2,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface2,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                backgroundColor: isSelected ? theme.colors.accent : "transparent",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={14} color="#FFF" />
              )}
            </View>
            <Text
              style={{
                flex: 1,
                color: theme.colors.text,
                fontSize: 15,
                fontWeight: "500",
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================================
// True/False Question Component
// ============================================================================

function TrueFalseQuestion({
  question,
  answer,
  onChange,
}: {
  question: QuizQuestion;
  answer: string | string[] | undefined;
  onChange: (value: string) => void;
}) {
  const currentAnswer = Array.isArray(answer) ? answer[0] : answer;

  return (
    <View style={{ gap: 12 }}>
      {["True（正確）", "False（錯誤）"].map((option) => {
        const isSelected = currentAnswer === option;

        return (
          <Pressable
            key={`tf-${option}`}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: theme.radius.md,
              borderWidth: 2,
              borderColor: isSelected ? theme.colors.accent : theme.colors.border,
              backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface2,
              alignItems: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text
              style={{
                color: theme.colors.text,
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================================
// Fill in Blank Question Component
// ============================================================================

function FillInBlankQuestion({
  question,
  answer,
  onChange,
}: {
  question: QuizQuestion;
  answer: string | string[] | undefined;
  onChange: (value: string) => void;
}) {
  const currentAnswer = Array.isArray(answer) ? answer[0] : answer || "";

  return (
    <View style={{ gap: 12 }}>
      <TextInput
        value={currentAnswer}
        onChangeText={onChange}
        placeholder="請輸入答案..."
        placeholderTextColor={theme.colors.muted}
        style={{
          minHeight: 50,
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.text,
          fontSize: 15,
        }}
      />
      <Text style={{ fontSize: 12, color: theme.colors.muted, fontStyle: "italic" }}>
        提示：請仔細檢查拼寫和標點符號
      </Text>
    </View>
  );
}

// ============================================================================
// Results Screen Component
// ============================================================================

function ResultsScreen({
  quizTitle,
  totalPoints,
  earnedPoints,
  results,
  timeTaken,
  onRestart,
}: {
  quizTitle: string;
  totalPoints: number;
  earnedPoints: number;
  results: QuizResult[];
  timeTaken: number;
  onRestart: () => void;
}) {
  const percentage = Math.round((earnedPoints / totalPoints) * 100);
  const correctCount = results.filter((r) => r.isCorrect).length;

  const getResultStatus = (): { color: string; label: string } => {
    if (percentage >= 90) return { color: theme.colors.success, label: "優秀" };
    if (percentage >= 80) return { color: theme.colors.accent, label: "良好" };
    if (percentage >= 70) return { color: theme.colors.warning, label: "及格" };
    return { color: theme.colors.danger, label: "未及格" };
  };

  const status = getResultStatus();
  const minutes = Math.floor(timeTaken / 60);
  const seconds = timeTaken % 60;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
    >
      <AnimatedCard title="測驗成績" delay={0}>
        <View style={{ alignItems: "center", gap: 16 }}>
          {/* Score Circle */}
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: status.color,
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.15,
              position: "relative",
            }}
          >
            <View
              style={{
                position: "absolute",
                width: 100,
                height: 100,
                borderRadius: 50,
                borderWidth: 3,
                borderColor: status.color,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 32, fontWeight: "800", color: status.color }}>
                  {percentage}%
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                  {status.label}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ gap: 8, width: "100%", alignItems: "center" }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.text }}>
              {quizTitle}
            </Text>
            <Text style={{ fontSize: 14, color: theme.colors.muted }}>
              得分: {earnedPoints} / {totalPoints} 分
            </Text>
          </View>
        </View>
      </AnimatedCard>

      <AnimatedCard title="統計資訊" delay={100}>
        <View style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.muted }}>正確題數</Text>
            <Text style={{ color: theme.colors.success, fontWeight: "700" }}>
              {correctCount} / {results.length}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.muted }}>作答時間</Text>
            <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
              {minutes} 分 {seconds} 秒
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: theme.colors.muted }}>答題速度</Text>
            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
              {(timeTaken / results.length).toFixed(1)} 秒/題
            </Text>
          </View>
        </View>
      </AnimatedCard>

      <AnimatedCard title="詳細答題分析" delay={200}>
        <View style={{ gap: 12 }}>
          {results.map((result, idx) => {
            const answerArray = Array.isArray(result.userAnswer)
              ? result.userAnswer
              : [result.userAnswer];
            const correctArray = Array.isArray(result.correctAnswer)
              ? result.correctAnswer
              : result.correctAnswer
                ? [result.correctAnswer]
                : [];

            return (
              <View
                key={`result-${idx}`}
                style={{
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: result.isCorrect
                    ? theme.colors.successSoft
                    : theme.colors.dangerSoft,
                  borderLeftWidth: 4,
                  borderLeftColor: result.isCorrect ? theme.colors.success : theme.colors.danger,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Ionicons
                    name={result.isCorrect ? "checkmark-circle" : "close-circle"}
                    size={18}
                    color={result.isCorrect ? theme.colors.success : theme.colors.danger}
                  />
                  <Text style={{ flex: 1, fontWeight: "700", color: theme.colors.text }}>
                    第 {result.questionNum || idx + 1} 題
                  </Text>
                  <Text
                    style={{
                      color: result.isCorrect ? theme.colors.success : theme.colors.danger,
                      fontWeight: "700",
                    }}
                  >
                    {result.earnedPoints} / {result.points || 10} 分
                  </Text>
                </View>

                <Text style={{ color: theme.colors.text, fontSize: 13, marginBottom: 8 }}>
                  {result.prompt}
                </Text>

                <View style={{ gap: 6 }}>
                  <View>
                    <Text style={{ fontSize: 11, color: theme.colors.muted, fontWeight: "600" }}>
                      你的答案：
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.text,
                        marginTop: 4,
                        paddingLeft: 8,
                      }}
                    >
                      {answerArray.length > 0
                        ? answerArray.join(", ")
                        : "（未回答）"}
                    </Text>
                  </View>

                  {!result.isCorrect && correctArray.length > 0 && (
                    <View>
                      <Text style={{ fontSize: 11, color: theme.colors.muted, fontWeight: "600" }}>
                        正確答案：
                      </Text>
                      <Text
                        style={{
                          color: theme.colors.success,
                          marginTop: 4,
                          paddingLeft: 8,
                        }}
                      >
                        {correctArray.join(", ")}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </AnimatedCard>

      <Button
        text="返回測驗列表"
        kind="primary"
        fullWidth
        onPress={onRestart}
      />
    </ScrollView>
  );
}

// ============================================================================
// Main Quiz Taking Screen
// ============================================================================

export function QuizTakingScreen(props: any) {
  const nav = props?.navigation;
  const params = props?.route?.params as {
    quizId: string;
    groupId: string;
    title: string;
    duration: number;
    questionCount: number;
  };

  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [showResults, setShowResults] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [quizStartTime] = useState(Date.now());

  // Load questions on mount
  useEffect(() => {
    const loadQuestions = async () => {
      try {
        // In a real app, you would fetch from ds.listAssignments() or similar
        // For now, we generate demo questions
        const demoQuestions = generateDemoQuestions(params?.questionCount || 8);
        setQuestions(demoQuestions);
      } catch (error) {
        console.error("Error loading questions:", error);
        // Fallback to demo questions
        const demoQuestions = generateDemoQuestions(params?.questionCount || 8);
        setQuestions(demoQuestions);
      } finally {
        setLoading(false);
      }
    };

    loadQuestions();
  }, []);

  const handleTimeExpire = () => {
    setTimeExpired(true);
    // Auto submit
    submitQuiz();
  };

  const currentQuestionData = questions[currentQuestion - 1];
  const answeredQuestions = new Set(
    Object.keys(answers).filter((key) => {
      const answer = answers[key];
      if (Array.isArray(answer.answer)) {
        return answer.answer.length > 0;
      }
      return answer.answer && answer.answer.trim() !== "";
    })
  );

  const handleAnswerChange = (value: string | string[]) => {
    if (!currentQuestionData) return;

    setAnswers((prev) => ({
      ...prev,
      [`q${currentQuestion}`]: {
        questionId: currentQuestionData.id,
        type: currentQuestionData.type,
        answer: value,
      },
    }));
  };

  const submitQuiz = () => {
    const unansweredCount = questions.length - answeredQuestions.size;

    if (unansweredCount > 0 && !timeExpired) {
      Alert.alert(
        "警告",
        `還有 ${unansweredCount} 題未回答。確定要提交嗎？`,
        [
          { text: "繼續作答", onPress: () => {} },
          { text: "確認提交", onPress: () => performSubmit() },
        ]
      );
    } else {
      performSubmit();
    }
  };

  const performSubmit = () => {
    // Calculate results
    const results: QuizResult[] = questions.map((q) => {
      const userAnswer = answers[`q${q.questionNum}`];
      const userAnswerValue = userAnswer?.answer || "";
      const correctAnswers = q.correctAnswers || [];

      // Simple answer checking
      let isCorrect = false;
      let earnedPoints = 0;
      const maxPoints = q.points || 10;

      if (q.type === "fill_in_blank") {
        // For fill in blank, do simple string comparison (case insensitive)
        const userStr = (typeof userAnswerValue === "string" ? userAnswerValue : "").toLowerCase().trim();
        isCorrect = correctAnswers.some((ca) => ca.toLowerCase().trim() === userStr);
        earnedPoints = isCorrect ? maxPoints : 0;
      } else if (q.type === "multiple_choice") {
        // For multiple choice, must match all correct answers
        const userAnswers = Array.isArray(userAnswerValue)
          ? userAnswerValue.sort()
          : userAnswerValue
            ? [userAnswerValue]
            : [];
        const correct = correctAnswers.sort();
        isCorrect = JSON.stringify(userAnswers) === JSON.stringify(correct);
        earnedPoints = isCorrect ? maxPoints : 0;
      } else {
        // Single choice and true/false
        isCorrect = correctAnswers.includes(userAnswerValue as string);
        earnedPoints = isCorrect ? maxPoints : 0;
      }

      return {
        questionId: q.id,
        prompt: q.prompt,
        type: q.type,
        userAnswer: userAnswerValue,
        correctAnswer: correctAnswers.length === 1 ? correctAnswers[0] : correctAnswers,
        isCorrect,
        points: maxPoints,
        earnedPoints,
        questionNum: q.questionNum,
      };
    });

    const totalPoints = results.reduce((sum, r) => sum + (r.points || 10), 0);
    const earnedPoints = results.reduce((sum, r) => sum + r.earnedPoints, 0);
    const timeTaken = Math.floor((Date.now() - quizStartTime) / 1000);

    setShowResults(true);
    // In a real app, you would save results to backend here
  };

  const handleNavigation = (questionNum: number) => {
    setCurrentQuestion(questionNum);
  };

  const handlePrevious = () => {
    if (currentQuestion > 1) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleNext = () => {
    if (currentQuestion < questions.length) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handleRestart = () => {
    nav?.goBack();
  };

  // Loading state
  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted }}>正在加載題目...</Text>
        </View>
      </Screen>
    );
  }

  // Results screen
  if (showResults) {
    const results: QuizResult[] = questions.map((q) => {
      const userAnswer = answers[`q${q.questionNum}`];
      const userAnswerValue = userAnswer?.answer || "";
      const correctAnswers = q.correctAnswers || [];

      let isCorrect = false;
      let earnedPoints = 0;
      const maxPoints = q.points || 10;

      if (q.type === "fill_in_blank") {
        const userStr = (typeof userAnswerValue === "string" ? userAnswerValue : "").toLowerCase().trim();
        isCorrect = correctAnswers.some((ca) => ca.toLowerCase().trim() === userStr);
        earnedPoints = isCorrect ? maxPoints : 0;
      } else if (q.type === "multiple_choice") {
        const userAnswers = Array.isArray(userAnswerValue)
          ? userAnswerValue.sort()
          : userAnswerValue
            ? [userAnswerValue]
            : [];
        const correct = correctAnswers.sort();
        isCorrect = JSON.stringify(userAnswers) === JSON.stringify(correct);
        earnedPoints = isCorrect ? maxPoints : 0;
      } else {
        isCorrect = correctAnswers.includes(userAnswerValue as string);
        earnedPoints = isCorrect ? maxPoints : 0;
      }

      return {
        questionId: q.id,
        prompt: q.prompt,
        type: q.type,
        userAnswer: userAnswerValue,
        correctAnswer: correctAnswers.length === 1 ? correctAnswers[0] : correctAnswers,
        isCorrect,
        points: maxPoints,
        earnedPoints,
        questionNum: q.questionNum,
      };
    });

    const totalPoints = results.reduce((sum, r) => sum + (r.points || 10), 0);
    const earnedPoints = results.reduce((sum, r) => sum + r.earnedPoints, 0);
    const timeTaken = Math.floor((Date.now() - quizStartTime) / 1000);

    return (
      <ResultsScreen
        quizTitle={params?.title || "測驗"}
        totalPoints={totalPoints}
        earnedPoints={earnedPoints}
        results={results}
        timeTaken={timeTaken}
        onRestart={handleRestart}
      />
    );
  }

  // Quiz taking screen
  return (
    <Screen noPadding>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text, flex: 1 }}>
              {params?.title || "測驗"}
            </Text>
            {params?.duration && (
              <CountdownTimer
                initialSeconds={params.duration * 60}
                onExpire={handleTimeExpire}
              />
            )}
          </View>
          <ProgressBar
            answeredCount={answeredQuestions.size}
            totalCount={questions.length}
          />
        </View>

        {/* Question Navigator */}
        <QuestionNavigator
          totalQuestions={questions.length}
          currentQuestion={currentQuestion}
          answeredQuestions={answeredQuestions}
          onNavigate={handleNavigation}
        />

        {/* Main Content */}
        {currentQuestionData ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              gap: 16,
              padding: 16,
              paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 80,
            }}
          >
            {/* Time Expired Warning */}
            {timeExpired && (
              <Card variant="filled">
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
                  <Text style={{ color: theme.colors.danger, flex: 1, fontWeight: "600" }}>
                    時間已到，測驗已自動提交
                  </Text>
                </View>
              </Card>
            )}

            {/* Question Card */}
            <AnimatedCard
              title={`第 ${currentQuestion} 題 / 共 ${questions.length} 題`}
              subtitle={getQuestionTypeLabel(currentQuestionData.type)}
              delay={0}
            >
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 15, color: theme.colors.text, lineHeight: 22 }}>
                  {currentQuestionData.prompt}
                </Text>

                {currentQuestionData.points && (
                  <Pill text={`${currentQuestionData.points} 分`} kind="accent" size="sm" />
                )}

                {/* Question Type Renderer */}
                <View style={{ marginTop: 8 }}>
                  {currentQuestionData.type === "single_choice" && (
                    <SingleChoiceQuestion
                      question={currentQuestionData}
                      answer={answers[`q${currentQuestion}`]?.answer}
                      onChange={handleAnswerChange}
                    />
                  )}

                  {currentQuestionData.type === "multiple_choice" && (
                    <MultipleChoiceQuestion
                      question={currentQuestionData}
                      answer={answers[`q${currentQuestion}`]?.answer}
                      onChange={(value) => handleAnswerChange(value)}
                    />
                  )}

                  {currentQuestionData.type === "true_false" && (
                    <TrueFalseQuestion
                      question={currentQuestionData}
                      answer={answers[`q${currentQuestion}`]?.answer}
                      onChange={handleAnswerChange}
                    />
                  )}

                  {currentQuestionData.type === "fill_in_blank" && (
                    <FillInBlankQuestion
                      question={currentQuestionData}
                      answer={answers[`q${currentQuestion}`]?.answer}
                      onChange={handleAnswerChange}
                    />
                  )}
                </View>
              </View>
            </AnimatedCard>
          </ScrollView>
        ) : null}

        {/* Navigation Buttons */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
            backgroundColor: theme.colors.surface,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              text="上一題"
              kind="secondary"
              icon="chevron-back"
              disabled={currentQuestion === 1}
              onPress={handlePrevious}
              fullWidth
            />
            <Button
              text="下一題"
              kind="secondary"
              icon="chevron-forward"
              disabled={currentQuestion === questions.length}
              onPress={handleNext}
              fullWidth
            />
          </View>
          <Button
            text="提交測驗"
            kind="primary"
            icon="checkmark-done"
            onPress={submitQuiz}
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}

// Helper function to get question type label (moved outside since can't use this)
function getQuestionTypeLabel(type: QuestionType): string {
  const labels: Record<QuestionType, string> = {
    single_choice: "單選題",
    multiple_choice: "多選題",
    true_false: "是非題",
    fill_in_blank: "填空題",
  };
  return labels[type] || "問題";
}
