import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  ScrollView,
  Text,
  View,
  Pressable,
  TextInput,
  Alert,
  RefreshControl,
  Animated,
  Modal,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, AnimatedCard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  doc,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  increment,
  query,
  orderBy,
  limit,
  getDoc,
} from "firebase/firestore";

let QRCodeSvg: React.ComponentType<{
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
}> | null = null;

try {
  QRCodeSvg = require("react-native-qrcode-svg").default;
} catch {
  QRCodeSvg = null;
}

type LiveSession = {
  sessionId: string;
  teacherId: string;
  active: boolean;
  qrToken?: string;
  qrExpiresAt?: any;
  reactions: { understood: number; partial: number; confused: number };
  attendeeCount: number;
};

type AnonQuestion = {
  id: string;
  text: string;
  upvotes: number;
  answered: boolean;
  createdAt?: any;
  upvotedBy?: string[];
};

type Poll = {
  id: string;
  question: string;
  options: string[];
  responses: Record<string, number>;
  active: boolean;
  createdAt?: any;
};

const REACTION_CONFIG = {
  understood: { icon: "checkmark-circle" as const, color: "#10B981", label: "懂了" },
  partial: { icon: "help-circle" as const, color: "#F59E0B", label: "有點懂" },
  confused: { icon: "close-circle" as const, color: "#EF4444", label: "不懂" },
} as const;

type ReactionKey = keyof typeof REACTION_CONFIG;

function ReactionBar({ reactions, totalCount, userReaction, onReact }: {
  reactions: LiveSession["reactions"];
  totalCount: number;
  userReaction: ReactionKey | null;
  onReact: (r: ReactionKey) => void;
}) {
  const total = Math.max(1, reactions.understood + reactions.partial + reactions.confused);

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        {(["understood", "partial", "confused"] as ReactionKey[]).map((key) => {
          const cfg = REACTION_CONFIG[key];
          const active = userReaction === key;
          return (
            <Pressable
              key={key}
              onPress={() => onReact(key)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                padding: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: active ? `${cfg.color}20` : theme.colors.surface2,
                borderWidth: active ? 2 : 1,
                borderColor: active ? cfg.color : theme.colors.border,
                opacity: pressed ? 0.8 : 1,
                gap: 6,
              })}
            >
              <Ionicons name={cfg.icon} size={28} color={active ? cfg.color : theme.colors.muted} />
              <Text style={{ color: active ? cfg.color : theme.colors.muted, fontWeight: "700", fontSize: 13 }}>
                {cfg.label}
              </Text>
              <Text style={{ color: active ? cfg.color : theme.colors.muted, fontSize: 11 }}>
                {reactions[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 進度條視覺化 */}
      {totalCount > 0 && (
        <View>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
            共 {totalCount} 人回應
          </Text>
          <View style={{ height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row" }}>
            {(["understood", "partial", "confused"] as ReactionKey[]).map((key) => {
              const pct = (reactions[key] / total) * 100;
              if (pct === 0) return null;
              return (
                <View
                  key={key}
                  style={{ width: `${pct}%`, height: "100%", backgroundColor: REACTION_CONFIG[key].color }}
                />
              );
            })}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
            {(["understood", "partial", "confused"] as ReactionKey[]).map((key) => {
              const pct = Math.round((reactions[key] / total) * 100);
              return (
                <Text key={key} style={{ color: REACTION_CONFIG[key].color, fontSize: 11, fontWeight: "700" }}>
                  {REACTION_CONFIG[key].label} {pct}%
                </Text>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function PollCard({ poll, myAnswer, onAnswer }: {
  poll: Poll;
  myAnswer: number | null;
  onAnswer: (idx: number) => void;
}) {
  const totalVotes = Object.values(poll.responses).length;
  const optionVotes = poll.options.map((_, i) =>
    Object.values(poll.responses).filter((v) => v === i).length
  );

  return (
    <View
      style={{
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 16,
        ...softShadowStyle(theme.shadows.soft),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Ionicons name="bar-chart" size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 13, flex: 1 }}>即時投票</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{totalVotes} 票</Text>
      </View>
      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
        {poll.question}
      </Text>
      <View style={{ gap: 8 }}>
        {poll.options.map((opt, i) => {
          const isSelected = myAnswer === i;
          const pct = totalVotes > 0 ? Math.round((optionVotes[i] / totalVotes) * 100) : 0;
          return (
            <Pressable
              key={i}
              onPress={() => onAnswer(i)}
              style={({ pressed }) => ({
                borderRadius: theme.radius.md,
                borderWidth: 2,
                borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                backgroundColor: isSelected ? theme.colors.accentSoft : theme.colors.surface2,
                overflow: "hidden",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              {myAnswer !== null && (
                <View
                  style={{
                    position: "absolute",
                    left: 0, top: 0, bottom: 0,
                    width: `${pct}%`,
                    backgroundColor: isSelected ? `${theme.colors.accent}30` : `${theme.colors.muted}15`,
                  }}
                />
              )}
              <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 10 }}>
                <Text style={{ color: isSelected ? theme.colors.accent : theme.colors.text, fontWeight: "700", flex: 1 }}>
                  {opt}
                </Text>
                {myAnswer !== null && (
                  <Text style={{ color: isSelected ? theme.colors.accent : theme.colors.muted, fontWeight: "700", fontSize: 13 }}>
                    {pct}%
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ClassroomScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const sessionId: string | undefined = props?.route?.params?.sessionId;
  const isTeacher: boolean = props?.route?.params?.isTeacher ?? false;

  const auth = useAuth();
  const db = getDb();
  const functions = getFunctions();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [questions, setQuestions] = useState<AnonQuestion[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState("");
  const [submittingQ, setSubmittingQ] = useState(false);
  const [userReaction, setUserReaction] = useState<ReactionKey | null>(null);
  const [myPollAnswers, setMyPollAnswers] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);

  // 教師：新增投票
  const [newPollQuestion, setNewPollQuestion] = useState("");
  const [newPollOptions, setNewPollOptions] = useState(["", ""]);

  // 訂閱 Session 狀態
  useEffect(() => {
    if (!groupId || !sessionId) return;
    const ref = doc(db, "groups", groupId, "liveSessions", sessionId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setSession({ sessionId, ...(snap.data() as any) });
      }
      setLoading(false);
    });
    return () => unsub();
  }, [groupId, sessionId]);

  // 訂閱問答
  useEffect(() => {
    if (!groupId || !sessionId) return;
    const ref = collection(db, "groups", groupId, "liveSessions", sessionId, "questions");
    const q = query(ref, orderBy("upvotes", "desc"), limit(30));
    const unsub = onSnapshot(q, (snap) => {
      setQuestions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AnonQuestion[]);
    });
    return () => unsub();
  }, [groupId, sessionId]);

  // 訂閱投票
  useEffect(() => {
    if (!groupId || !sessionId) return;
    const ref = collection(db, "groups", groupId, "liveSessions", sessionId, "polls");
    const unsub = onSnapshot(query(ref, orderBy("createdAt", "desc")), (snap) => {
      setPolls(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Poll[]);
    });
    return () => unsub();
  }, [groupId, sessionId]);

  // 學生加入課堂（一般加入）
  const handleJoin = useCallback(async () => {
    if (!groupId || !sessionId || !auth.user) return;
    try {
      const joinSession = httpsCallable(functions, "joinLiveSession");
      await joinSession({ groupId, sessionId });
      setJoined(true);
    } catch (e: any) {
      Alert.alert("加入失敗", e.message ?? "無法加入課堂");
    }
  }, [groupId, sessionId, auth.user]);

  // 學生：開啟 QR 掃描器簽到
  const handleOpenQRScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert("需要相機權限", "請在設定中允許相機存取，才能掃描 QR Code 簽到");
        return;
      }
    }
    scanLockRef.current = false;
    setShowQRScanner(true);
  }, [cameraPermission, requestCameraPermission]);

  // 掃描到 QR Code 後驗證並簽到
  const handleQRScanned = useCallback(async ({ data }: { data: string }) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setShowQRScanner(false);

    try {
      const url = new URL(data);
      const token = url.searchParams.get("token");
      const scannedGroupId = url.searchParams.get("groupId");
      const scannedSessionId = url.searchParams.get("sessionId");

      if (!token || scannedGroupId !== groupId || scannedSessionId !== sessionId) {
        Alert.alert("QR Code 無效", "請掃描老師目前課堂的 QR Code");
        return;
      }

      const joinSession = httpsCallable(functions, "joinLiveSession");
      await joinSession({ groupId, sessionId, qrToken: token });
      setJoined(true);
      Alert.alert("簽到成功", "出席已記錄！");
    } catch (e: any) {
      Alert.alert("簽到失敗", e.message ?? "無法完成簽到，請稍後再試");
    }
  }, [groupId, sessionId, functions]);

  // 提交匿名問題
  const handleSubmitQuestion = useCallback(async () => {
    if (!newQuestion.trim() || !groupId || !sessionId || !auth.user) return;
    setSubmittingQ(true);
    try {
      await addDoc(collection(db, "groups", groupId, "liveSessions", sessionId, "questions"), {
        text: newQuestion.trim(),
        upvotes: 0,
        answered: false,
        createdAt: serverTimestamp(),
        upvotedBy: [],
      });
      setNewQuestion("");
    } catch {
      Alert.alert("發送失敗", "請稍後再試");
    } finally {
      setSubmittingQ(false);
    }
  }, [newQuestion, groupId, sessionId, auth.user]);

  // 問題 Upvote
  const handleUpvote = useCallback(async (question: AnonQuestion) => {
    if (!groupId || !sessionId || !auth.user) return;
    const uid = auth.user.uid;
    const alreadyVoted = question.upvotedBy?.includes(uid);
    const ref = doc(db, "groups", groupId, "liveSessions", sessionId, "questions", question.id);
    await updateDoc(ref, {
      upvotes: increment(alreadyVoted ? -1 : 1),
      upvotedBy: alreadyVoted
        ? (question.upvotedBy ?? []).filter((id: string) => id !== uid)
        : [...(question.upvotedBy ?? []), uid],
    });
  }, [groupId, sessionId, auth.user]);

  // 標記問題已回答
  const handleMarkAnswered = useCallback(async (questionId: string) => {
    if (!groupId || !sessionId) return;
    const ref = doc(db, "groups", groupId, "liveSessions", sessionId, "questions", questionId);
    await updateDoc(ref, { answered: true });
  }, [groupId, sessionId]);

  // 提交理解度反饋
  const handleReact = useCallback(async (reaction: ReactionKey) => {
    if (!groupId || !sessionId || !auth.user) return;
    try {
      const submitReaction = httpsCallable(functions, "submitReaction");
      await submitReaction({ groupId, sessionId, reaction });
      setUserReaction(reaction);
    } catch {
      Alert.alert("回報失敗", "請稍後再試");
    }
  }, [groupId, sessionId, auth.user]);

  // 回答投票
  const handlePollAnswer = useCallback(async (pollId: string, optionIdx: number) => {
    if (!groupId || !sessionId || !auth.user) return;
    try {
      const submitPoll = httpsCallable(functions, "submitPollResponse");
      await submitPoll({ groupId, sessionId, pollId, optionIdx });
      setMyPollAnswers((prev) => ({ ...prev, [pollId]: optionIdx }));
    } catch {
      Alert.alert("投票失敗", "請稍後再試");
    }
  }, [groupId, sessionId, auth.user]);

  // 教師：新增投票
  const handleCreatePoll = useCallback(async () => {
    if (!newPollQuestion.trim() || newPollOptions.filter((o) => o.trim()).length < 2) return;
    if (!groupId || !sessionId) return;
    try {
      await addDoc(collection(db, "groups", groupId, "liveSessions", sessionId, "polls"), {
        question: newPollQuestion.trim(),
        options: newPollOptions.map((o) => o.trim()).filter(Boolean),
        responses: {},
        active: true,
        createdAt: serverTimestamp(),
      });
      setNewPollQuestion("");
      setNewPollOptions(["", ""]);
    } catch {
      Alert.alert("建立失敗", "請稍後再試");
    }
  }, [newPollQuestion, newPollOptions, groupId, sessionId]);

  // 結束課堂（教師）
  const handleEndSession = useCallback(async () => {
    Alert.alert("結束課堂", "確定要結束今天的課堂互動？", [
      { text: "取消", style: "cancel" },
      {
        text: "結束",
        style: "destructive",
        onPress: async () => {
          try {
            const endSession = httpsCallable(functions, "endLiveSession");
            await endSession({ groupId, sessionId });
            nav?.goBack?.();
          } catch {
            Alert.alert("操作失敗", "請稍後再試");
          }
        },
      },
    ]);
  }, [groupId, sessionId]);

  if (!auth.user) return <ErrorState title="課堂" subtitle="尚未登入" hint="請先登入才能加入課堂" />;
  if (!groupId || !sessionId) return <ErrorState title="課堂" subtitle="缺少課堂資訊" hint="請從群組頁面進入課堂" />;
  if (loading) return <LoadingState title="課堂" subtitle="連線中..." rows={3} />;
  if (!session) return <ErrorState title="課堂" subtitle="找不到課堂" hint="課堂可能已結束或不存在" />;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(false)} tintColor={theme.colors.accent} />}
      >
        {/* 課堂狀態標頭 */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
            gap: 12,
            backgroundColor: session.active ? "#10B98110" : theme.colors.surface2,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: session.active ? "#10B981" : "#EF4444",
            }}
          />
          <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16, flex: 1 }}>
            {session.active ? "課堂進行中" : "課堂已結束"}
          </Text>
          <Pill text={`${session.attendeeCount} 人在線`} kind="accent" />
          {isTeacher && session.active && (
            <Pressable
              onPress={handleEndSession}
              style={{ padding: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.dangerSoft }}
            >
              <Ionicons name="stop-circle" size={20} color={theme.colors.danger} />
            </Pressable>
          )}
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          {/* 學生：尚未加入時顯示加入按鈕 */}
          {!isTeacher && !joined && session.active && (
            <Card title="加入課堂" subtitle="點擊加入今天的即時互動">
              <View style={{ gap: 10 }}>
                <Button text="立即加入課堂" kind="primary" onPress={handleJoin} />
                {session.qrToken && (
                  <Button
                    text="掃描 QR Code 簽到"
                    kind="ghost"
                    icon="qr-code-outline"
                    onPress={handleOpenQRScanner}
                  />
                )}
              </View>
            </Card>
          )}

          {/* 教師：QR Code 出席打卡 */}
          {isTeacher && session.qrToken && session.active && (
            <AnimatedCard title="出席打卡 QR Code" subtitle="學生掃碼即可記錄出席">
              <View style={{ alignItems: "center", padding: 16, gap: 12 }}>
                {QRCodeSvg ? (
                  <QRCodeSvg
                    value={`campusone://classroom/join?groupId=${groupId}&sessionId=${sessionId}&token=${session.qrToken}`}
                    size={180}
                    color={theme.colors.text}
                    backgroundColor="transparent"
                  />
                ) : (
                  <View
                    style={{
                      width: 180,
                      height: 180,
                      borderRadius: 24,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 18,
                      gap: 8,
                    }}
                  >
                    <Ionicons name="qr-code-outline" size={36} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.text, fontWeight: "700", textAlign: "center" }}>
                      QR 套件尚未安裝
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
                      目前先保留課堂流程，安裝 `react-native-qrcode-svg` 後即可顯示正式 QR Code。
                    </Text>
                  </View>
                )}
                <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: "center" }}>
                  此 QR Code 每 5 分鐘更新一次以防代掃
                </Text>
              </View>
            </AnimatedCard>
          )}

          {/* 理解度反饋（學生） */}
          {!isTeacher && joined && session.active && (
            <Card title="即時理解度" subtitle="讓老師知道你的學習狀況">
              <ReactionBar
                reactions={session.reactions}
                totalCount={session.attendeeCount}
                userReaction={userReaction}
                onReact={handleReact}
              />
            </Card>
          )}

          {/* 理解度總覽（教師） */}
          {isTeacher && (
            <Card title="學生理解度即時統計" subtitle="即時了解全班狀況">
              <ReactionBar
                reactions={session.reactions}
                totalCount={session.attendeeCount}
                userReaction={null}
                onReact={() => {}}
              />
            </Card>
          )}

          {/* 投票 */}
          {polls.filter((p) => p.active).length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>即時投票</Text>
              {polls.filter((p) => p.active).map((poll) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  myAnswer={myPollAnswers[poll.id] ?? null}
                  onAnswer={(idx) => handlePollAnswer(poll.id, idx)}
                />
              ))}
            </View>
          )}

          {/* 教師：建立投票 */}
          {isTeacher && session.active && (
            <Card title="建立投票" subtitle="向學生發送即時選擇題">
              <TextInput
                value={newPollQuestion}
                onChangeText={setNewPollQuestion}
                placeholder="輸入問題..."
                placeholderTextColor={theme.colors.muted}
                style={{
                  color: theme.colors.text,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  backgroundColor: theme.colors.surface2,
                  marginBottom: 10,
                }}
              />
              {newPollOptions.map((opt, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput
                    value={opt}
                    onChangeText={(v) => {
                      const arr = [...newPollOptions];
                      arr[i] = v;
                      setNewPollOptions(arr);
                    }}
                    placeholder={`選項 ${i + 1}`}
                    placeholderTextColor={theme.colors.muted}
                    style={{
                      flex: 1,
                      color: theme.colors.text,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      padding: 10,
                      backgroundColor: theme.colors.surface2,
                    }}
                  />
                  {newPollOptions.length > 2 && (
                    <Pressable
                      onPress={() => setNewPollOptions(newPollOptions.filter((_, idx) => idx !== i))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="close-circle" size={20} color={theme.colors.danger} />
                    </Pressable>
                  )}
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Pressable
                  onPress={() => setNewPollOptions([...newPollOptions, ""])}
                  style={{ flex: 1, padding: 10, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center" }}
                >
                  <Text style={{ color: theme.colors.muted }}>+ 新增選項</Text>
                </Pressable>
                <Pressable
                  onPress={handleCreatePoll}
                  style={{ flex: 1, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>發送投票</Text>
                </Pressable>
              </View>
            </Card>
          )}

          {/* 匿名問答 */}
          <Card title={`匿名問答 (${questions.length})`} subtitle="問題越多 upvote 越優先顯示">
            {/* 提問輸入 */}
            {session.active && (
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
                <TextInput
                  value={newQuestion}
                  onChangeText={setNewQuestion}
                  placeholder="輸入匿名問題..."
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    flex: 1,
                    color: theme.colors.text,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 20,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: theme.colors.surface2,
                  }}
                />
                <Pressable
                  onPress={handleSubmitQuestion}
                  disabled={!newQuestion.trim() || submittingQ}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: newQuestion.trim() ? theme.colors.accent : theme.colors.surface2,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Ionicons name="send" size={18} color={newQuestion.trim() ? "#fff" : theme.colors.muted} />
                </Pressable>
              </View>
            )}

            {questions.length === 0 ? (
              <Text style={{ color: theme.colors.muted, textAlign: "center", paddingVertical: 16 }}>
                尚無問題，鼓起勇氣提問！
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {questions.map((q) => {
                  const voted = q.upvotedBy?.includes(auth.user?.uid ?? "");
                  return (
                    <View
                      key={q.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: q.answered ? theme.colors.successSoft : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: q.answered ? theme.colors.success : theme.colors.border,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{q.text}</Text>
                        {q.answered && (
                          <Text style={{ color: theme.colors.success, fontSize: 11, fontWeight: "700", marginTop: 4 }}>
                            ✓ 已回答
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: "center", gap: 6 }}>
                        <Pressable
                          onPress={() => handleUpvote(q)}
                          style={{
                            alignItems: "center",
                            padding: 8,
                            borderRadius: theme.radius.md,
                            backgroundColor: voted ? theme.colors.accentSoft : "transparent",
                          }}
                        >
                          <Ionicons
                            name={voted ? "thumbs-up" : "thumbs-up-outline"}
                            size={20}
                            color={voted ? theme.colors.accent : theme.colors.muted}
                          />
                          <Text style={{ color: voted ? theme.colors.accent : theme.colors.muted, fontSize: 12, fontWeight: "700" }}>
                            {q.upvotes}
                          </Text>
                        </Pressable>
                        {isTeacher && !q.answered && (
                          <Pressable
                            onPress={() => handleMarkAnswered(q.id)}
                            style={{ padding: 6 }}
                          >
                            <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.success} />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        </View>
      </ScrollView>

      {/* QR Code 掃描器 Modal */}
      <Modal visible={showQRScanner} animationType="slide" onRequestClose={() => setShowQRScanner(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleQRScanned}
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 220,
                height: 220,
                borderRadius: 16,
                borderWidth: 3,
                borderColor: "#fff",
                backgroundColor: "transparent",
              }}
            />
            <Text style={{ color: "#fff", marginTop: 20, fontSize: 15, textAlign: "center" }}>
              將 QR Code 對準框內掃描簽到
            </Text>
          </View>
          <Pressable
            onPress={() => setShowQRScanner(false)}
            style={{
              position: "absolute",
              top: 56,
              right: 20,
              backgroundColor: "rgba(0,0,0,0.5)",
              borderRadius: 20,
              padding: 8,
            }}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </Screen>
  );
}
