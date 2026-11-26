import { attendanceSubmissionIssue } from '@campus/shared/src/attendanceReliability';
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  Alert,
  RefreshControl,
  Modal,
  Linking,
  AppState,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCodeSvg from 'react-native-qrcode-svg';
import { Screen, Button, LoadingState, ErrorState } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { joinClassroomAttendance, readAttendanceQr } from '../services/liveAttendance';
import { useClassroomFeed } from '../hooks/useClassroomFeed';
import { useClassroomSession, type LiveClassroomSession } from '../hooks/useClassroomSession';
import { ClassroomCourseSearch } from './ClassroomCourseSearch';
import {
  doc,
  collection,
  addDoc,
  arrayRemove,
  arrayUnion,
  updateDoc,
  serverTimestamp,
  increment,
  runTransaction,
} from 'firebase/firestore';

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

/** 反應語意色一律於 render 時取自即時 theme，隨亮／暗切換 */
const REACTION_CONFIG = {
  understood: { icon: 'checkmark-circle-outline' as const, tone: 'success' as const, label: '懂了' },
  partial: { icon: 'help-circle-outline' as const, tone: 'warning' as const, label: '有點懂' },
  confused: { icon: 'close-circle-outline' as const, tone: 'danger' as const, label: '不懂' },
} as const;

type ReactionKey = keyof typeof REACTION_CONFIG;

/** QR 掃描／顯示面固定黑白高對比，不隨主題變動，確保相機可辨識。 */
const QR_INK = '#132D23';
const QR_PAPER = '#FFFFFF';

/** 區塊：清楚標題 + 分隔線群組，取代一張張堆疊的卡片 */
function Section({
  title,
  subtitle,
  children,
  bare,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** 內容自行管理群組外框（例如列表） */
  bare?: boolean;
}) {
  const s = useThemeStyleSheet(createStyles);
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text accessibilityRole="header" style={s.sectionTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={s.sectionSub}>{subtitle}</Text> : null}
      </View>
      {bare ? children : <View style={[s.group, s.groupBody]}>{children}</View>}
    </View>
  );
}

function ReactionBar({
  reactions,
  totalCount,
  userReaction,
  onReact,
}: {
  reactions: LiveClassroomSession['reactions'];
  totalCount: number;
  userReaction: ReactionKey | null;
  onReact: (r: ReactionKey) => void;
}) {
  const s = useThemeStyleSheet(createStyles);
  const total = Math.max(1, reactions.understood + reactions.partial + reactions.confused);
  const keys = ['understood', 'partial', 'confused'] as ReactionKey[];

  return (
    <View style={s.stack}>
      <View style={s.reactionRow}>
        {keys.map((key) => {
          const cfg = REACTION_CONFIG[key];
          const tone = theme.colors[cfg.tone];
          const active = userReaction === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${cfg.label}，${reactions[key]} 人`}
              onPress={() => onReact(key)}
              style={({ pressed }) => [
                s.reactionButton,
                active && { borderColor: tone, backgroundColor: theme.colors[`${cfg.tone}Soft`] },
                pressed && s.pressed,
              ]}
            >
              <Ionicons name={cfg.icon} size={24} color={active ? tone : theme.colors.textSecondary} />
              <Text style={s.reactionLabel}>{cfg.label}</Text>
              <Text style={s.metaText}>{reactions[key]}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* 進度條視覺化 */}
      {totalCount > 0 && (
        <View style={s.stack}>
          <Text style={s.metaText}>共 {totalCount} 人回應</Text>
          <View style={s.reactionTrack}>
            {keys.map((key) => {
              const pct = (reactions[key] / total) * 100;
              if (pct === 0) return null;
              return (
                <View
                  key={key}
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: theme.colors[REACTION_CONFIG[key].tone],
                  }}
                />
              );
            })}
          </View>
          <View style={s.spaceBetween}>
            {keys.map((key) => {
              const pct = Math.round((reactions[key] / total) * 100);
              return (
                <Text key={key} style={s.metaText}>
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

function PollCard({
  poll,
  myAnswer,
  onAnswer,
  first,
}: {
  poll: Poll;
  myAnswer: number | null;
  onAnswer: (idx: number) => void;
  first: boolean;
}) {
  const s = useThemeStyleSheet(createStyles);
  const totalVotes = Object.values(poll.responses).length;
  const optionVotes = poll.options.map(
    (_, i) => Object.values(poll.responses).filter((v) => v === i).length,
  );

  return (
    <View style={[s.groupBody, s.stack, !first && s.divider]}>
      <View style={s.spaceBetween}>
        <Text style={s.metaText}>即時投票</Text>
        <Text style={s.metaText}>{totalVotes} 票</Text>
      </View>
      <Text style={s.questionText}>{poll.question}</Text>
      <View style={s.optionStack}>
        {poll.options.map((opt, i) => {
          const isSelected = myAnswer === i;
          const pct = totalVotes > 0 ? Math.round((optionVotes[i] / totalVotes) * 100) : 0;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onAnswer(i)}
              style={({ pressed }) => [
                s.pollOption,
                isSelected && s.pollOptionActive,
                pressed && s.pressed,
              ]}
            >
              {myAnswer !== null && (
                <View
                  style={[
                    s.pollFill,
                    { width: `${pct}%` },
                    isSelected ? s.pollFillActive : s.pollFillIdle,
                  ]}
                />
              )}
              <View style={s.pollOptionBody}>
                <Text style={[s.optionText, isSelected && s.optionTextActive]}>{opt}</Text>
                {myAnswer !== null && <Text style={s.metaText}>{pct}%</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ClassroomScreen(props: any) {
  const s = useThemeStyleSheet(createStyles);
  const nav = props?.navigation;
  const focused = useIsFocused();
  const groupId: string | undefined = props?.route?.params?.groupId;
  const sessionId: string | undefined = props?.route?.params?.sessionId;
  const courseQuery =
    typeof props?.route?.params?.q === 'string' ? props.route.params.q.trim().slice(0, 120) : '';
  const courseCodeParam =
    typeof props?.route?.params?.code === 'string'
      ? props.route.params.code.trim().slice(0, 40)
      : '';

  const auth = useAuth();
  const db = getDb();
  const functions = getFunctionsInstance();

  const {
    session,
    loading,
    isTeacher,
    canAttend,
    qrToken,
    qrExpiresAt,
    joined,
    receipt,
    error: sessionError,
    refresh,
  } = useClassroomSession(
    db,
    {
      groupId,
      sessionId,
      userId: auth.user?.uid,
      schoolId: auth.profile?.schoolId,
    },
    auth.user,
    focused && !isFirebaseMockMode() && !auth.loading && !auth.tokenExpired && !auth.tokenError,
  );
  const receiptRef = useRef(receipt);
  receiptRef.current = receipt;
  const [attendanceCode, setAttendanceCode] = useState('');
  const [joining, setJoining] = useState(false);
  const joinLock = useRef(false);
  const [pending, setPending] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const identityKey = JSON.stringify([auth.user?.uid, auth.profile?.schoolId, groupId, sessionId]);
  const identityRef = useRef({ key: identityKey, user: auth.user });
  identityRef.current = { key: identityKey, user: auth.user };
  const feedIdentity = { groupId, sessionId, userId: auth.user?.uid, schoolId: auth.profile?.schoolId };
  const feedEnabled = focused && !isFirebaseMockMode() && !auth.loading && !auth.tokenExpired && !auth.tokenError;
  const { items: questions, error: questionError } = useClassroomFeed<AnonQuestion>(db, feedIdentity, auth.user, feedEnabled, 'questions');
  const { items: polls, error: pollError } = useClassroomFeed<Poll>(db, feedIdentity, auth.user, feedEnabled, 'polls');
  const accessError = sessionError ?? questionError ?? pollError;
  const [newQuestion, setNewQuestion] = useState('');
  const [submittingQ, setSubmittingQ] = useState(false);
  const [userReaction, setUserReaction] = useState<ReactionKey | null>(null);
  const [myPollAnswers, setMyPollAnswers] = useState<Record<string, number>>({});
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);

  // 教師：新增投票
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);

  // 搶答
  const [quickAnswerActive, setQuickAnswerActive] = useState(false);
  const [quickAnswerStartTime, setQuickAnswerStartTime] = useState<number | null>(null);
  const [quickAnswerResponses, setQuickAnswerResponses] = useState<Record<string, number>>({});
  const [quickAnswerCountdown, setQuickAnswerCountdown] = useState(3);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 即時小測
  const [quizActive, setQuizActive] = useState(false);
  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizOptions, setQuizOptions] = useState(['', '', '']);
  const [quizTimerSeconds, setQuizTimerSeconds] = useState(30);
  const [quizResponses, setQuizResponses] = useState<Record<string, number>>({});
  const [, setQuizStartTime] = useState<number | null>(null);
  const quizTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMyPollAnswers({});
    setNewQuestion('');
    setUserReaction(null);
    setPending(false);
    setAttendanceError(null);
    setAttendanceCode('');
    setJoining(false);
    setShowQRScanner(false);
    scanLockRef.current = false;
  }, [identityKey, auth.user]);

  useEffect(() => {
    if (receipt) { setPending(false); setAttendanceCode(''); setAttendanceError(null); }
  }, [receipt]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setShowQRScanner(false);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!focused) setShowQRScanner(false);
  }, [focused]);

  // 清理計時器
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (quizTimerRef.current) clearInterval(quizTimerRef.current);
    };
  }, []);

  const handleJoin = useCallback(
    async (token: string) => {
      if (!groupId || !sessionId || !auth.user || !session?.active || !canAttend || joinLock.current) return;
      joinLock.current = true;
      setAttendanceCode(token);
      setPending(true);
      const requestIdentity = identityRef.current;
      setJoining(true);
      setAttendanceError(null);
      try {
        await joinClassroomAttendance(functions, { groupId, sessionId, qrToken: token });
        if (
          identityRef.current.key !== requestIdentity.key ||
          identityRef.current.user !== requestIdentity.user
        )
          return;
      } catch (e: any) {
        if (receiptRef.current) return;
        if (
          identityRef.current.key === requestIdentity.key &&
          identityRef.current.user === requestIdentity.user
        ) {
          const issue = attendanceSubmissionIssue(e);
          setAttendanceError(issue.message);
          setPending(issue.pending);
          if (issue.rescan) setAttendanceCode('');
        }
      } finally {
        joinLock.current = false;
        if (
          identityRef.current.key === requestIdentity.key &&
          identityRef.current.user === requestIdentity.user
        )
          setJoining(false);
      }
    },
    [groupId, sessionId, auth.user, functions, identityKey, joining, session?.active, canAttend],
  );

  // 學生：開啟 QR 掃描器簽到
  const handleOpenQRScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('相機還沒開放', '可以到設定允許相機，回來後再掃一次；也可以直接輸入老師提供的簽到碼。', [
          { text: '輸入簽到碼', style: 'cancel' },
          { text: '開啟設定', onPress: () => { void Linking.openSettings(); } },
        ]);
        return;
      }
    }
    scanLockRef.current = false;
    setShowQRScanner(true);
  }, [cameraPermission, requestCameraPermission]);

  // 掃描到 QR Code 後驗證並簽到
  const handleQRScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanLockRef.current) return;
      scanLockRef.current = true;
      setShowQRScanner(false);

      try {
        if (!groupId || !sessionId) return;
        await handleJoin(readAttendanceQr(data, groupId, sessionId));
      } catch (e: any) {
        Alert.alert('簽到失敗', e.message ?? '無法完成簽到，請稍後再試');
      }
    },
    [groupId, sessionId, handleJoin],
  );

  // 提交匿名問題
  const handleSubmitQuestion = useCallback(async () => {
    if (!newQuestion.trim() || !groupId || !sessionId || !auth.user) return;
    setSubmittingQ(true);
    try {
      await addDoc(collection(db, 'groups', groupId, 'liveSessions', sessionId, 'questions'), {
        text: newQuestion.trim(),
        authorId: auth.user.uid,
        upvotes: 0,
        answered: false,
        createdAt: serverTimestamp(),
        upvotedBy: [],
      });
      setNewQuestion('');
    } catch {
      Alert.alert('發送失敗', '請稍後再試');
    } finally {
      setSubmittingQ(false);
    }
  }, [newQuestion, groupId, sessionId, auth.user]);

  // 問題 Upvote
  const handleUpvote = useCallback(
    async (question: AnonQuestion) => {
      if (!groupId || !sessionId || !auth.user || !session?.active) return;
      const uid = auth.user.uid;
      const addVote = !question.upvotedBy?.includes(uid);
      const ref = doc(db, 'groups', groupId, 'liveSessions', sessionId, 'questions', question.id);
      try {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists()) return;
          const hasVoted = snapshot.data().upvotedBy?.includes(uid) ?? false;
          if (hasVoted === addVote) return;
          transaction.update(ref, {
            upvotes: increment(addVote ? 1 : -1),
            upvotedBy: addVote ? arrayUnion(uid) : arrayRemove(uid),
          });
        });
      } catch {
        Alert.alert('未能更新投票', '請稍後再試');
      }
    },
    [groupId, sessionId, auth.user, session?.active],
  );

  // 標記問題已回答
  const handleMarkAnswered = useCallback(
    async (questionId: string) => {
      if (!groupId || !sessionId) return;
      const ref = doc(db, 'groups', groupId, 'liveSessions', sessionId, 'questions', questionId);
      await updateDoc(ref, { answered: true });
    },
    [groupId, sessionId],
  );

  // 提交理解度反饋
  const handleReact = useCallback(
    async (reaction: ReactionKey) => {
      if (!groupId || !sessionId || !auth.user) return;
      try {
        const submitReaction = httpsCallable(functions, 'submitReaction');
        await submitReaction({ groupId, sessionId, reaction });
        setUserReaction(reaction);
      } catch {
        Alert.alert('回報失敗', '請稍後再試');
      }
    },
    [groupId, sessionId, auth.user],
  );

  // 回答投票
  const handlePollAnswer = useCallback(
    async (pollId: string, optionIdx: number) => {
      if (!groupId || !sessionId || !auth.user) return;
      try {
        const submitPoll = httpsCallable(functions, 'submitPollResponse');
        await submitPoll({ groupId, sessionId, pollId, optionIdx });
        setMyPollAnswers((prev) => ({ ...prev, [pollId]: optionIdx }));
      } catch {
        Alert.alert('投票失敗', '請稍後再試');
      }
    },
    [groupId, sessionId, auth.user],
  );

  // 教師：新增投票
  const handleCreatePoll = useCallback(async () => {
    if (!newPollQuestion.trim() || newPollOptions.filter((o) => o.trim()).length < 2) return;
    if (!groupId || !sessionId) return;
    try {
      await addDoc(collection(db, 'groups', groupId, 'liveSessions', sessionId, 'polls'), {
        question: newPollQuestion.trim(),
        options: newPollOptions.map((o) => o.trim()).filter(Boolean),
        responses: {},
        active: true,
        createdAt: serverTimestamp(),
      });
      setNewPollQuestion('');
      setNewPollOptions(['', '']);
    } catch {
      Alert.alert('建立失敗', '請稍後再試');
    }
  }, [newPollQuestion, newPollOptions, groupId, sessionId]);

  // 結束課堂（教師）
  const handleEndSession = useCallback(async () => {
    if (!isTeacher || !session?.active || session.teacherId !== auth.user?.uid) return;
    Alert.alert('結束課堂', '確定要結束今天的課堂互動？', [
      { text: '取消', style: 'cancel' },
      {
        text: '結束',
        style: 'destructive',
        onPress: async () => {
          try {
            const endSession = httpsCallable(functions, 'endLiveSession');
            await endSession({ groupId, sessionId });
            nav?.goBack?.();
          } catch {
            Alert.alert('操作失敗', '請稍後再試');
          }
        },
      },
    ]);
  }, [groupId, sessionId, isTeacher, session?.active, session?.teacherId, auth.user?.uid]);

  // ===== 搶答 (Quick Answer Race) =====
  const handleStartQuickAnswer = useCallback(() => {
    setQuickAnswerActive(true);
    setQuickAnswerCountdown(3);
    setQuickAnswerStartTime(null);
    setQuickAnswerResponses({});

    let countdown = 3;
    countdownIntervalRef.current = setInterval(() => {
      countdown--;
      setQuickAnswerCountdown(countdown);
      if (countdown <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        setQuickAnswerStartTime(Date.now());
      }
    }, 1000);
  }, []);

  const handleSubmitQuickAnswer = useCallback(async () => {
    if (!quickAnswerStartTime || !auth.user) return;
    const responseTime = Math.round((Date.now() - quickAnswerStartTime) / 1000);
    try {
      const submitAnswer = httpsCallable(functions, 'submitQuickAnswer');
      await submitAnswer({ groupId, sessionId, responseTime });
      setQuickAnswerResponses((prev) => ({
        ...prev,
        [auth.user!.uid]: responseTime,
      }));
    } catch {
      Alert.alert('提交失敗', '請稍後再試');
    }
  }, [quickAnswerStartTime, auth.user, groupId, sessionId]);

  const handleStopQuickAnswer = useCallback(() => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setQuickAnswerActive(false);
    setQuickAnswerStartTime(null);
  }, []);

  // ===== 即時小測 (Pop Quiz) =====
  const handleCreatePopQuiz = useCallback(() => {
    if (!quizQuestion.trim() || quizOptions.filter((o) => o.trim()).length < 2) {
      Alert.alert('建立失敗', '請輸入問題並至少設定 2 個選項');
      return;
    }
    setQuizActive(true);
    setQuizStartTime(Date.now());
    setQuizResponses({});

    // Auto-stop timer
    quizTimerRef.current = setInterval(() => {
      setQuizTimerSeconds((prev) => {
        if (prev <= 1) {
          if (quizTimerRef.current) clearInterval(quizTimerRef.current);
          setQuizActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [quizQuestion, quizOptions]);

  const handleSubmitPopQuizAnswer = useCallback(
    async (optionIdx: number) => {
      if (!auth.user || !quizActive) return;
      try {
        const submitQuiz = httpsCallable(functions, 'submitPopQuizAnswer');
        await submitQuiz({ groupId, sessionId, optionIdx });
        setQuizResponses((prev) => ({
          ...prev,
          [auth.user!.uid]: optionIdx,
        }));
      } catch {
        Alert.alert('提交失敗', '請稍後再試');
      }
    },
    [auth.user, quizActive, groupId, sessionId],
  );

  // Timetable fallback: no live session ids, but a course search query from the schedule.
  // Uses nuni session inside ClassroomCourseSearch; do not require Firebase classroom auth here.
  if ((!groupId || !sessionId) && courseQuery) {
    return (
      <ClassroomCourseSearch
        query={courseQuery}
        courseCode={courseCodeParam || undefined}
        navigation={nav ?? {}}
      />
    );
  }
  if (!auth.user)
    return <ErrorState title="課堂" subtitle="尚未登入" hint="請先登入才能加入課堂" />;
  if (!groupId || !sessionId)
    return <ErrorState title="課堂" subtitle="缺少課堂資訊" hint="請從群組頁面進入課堂" />;
  if (loading) return <LoadingState title="課堂" subtitle="連線中..." rows={3} />;
  if (!session)
    return (
      <ErrorState
        title="課堂"
        subtitle="找不到課堂"
        hint={attendanceError ?? accessError ?? '課堂可能已結束或不存在'}
      />
    );

  const myUid = auth.user.uid;
  const activePolls = polls.filter((p) => p.active);
  const receiptLabel = receipt
    ? `${receipt.source === 'manual' ? '教師已核定' : '簽到收據'} · ${
        ({ present: '出席', late: '遲到', absent: '缺席', excused: '請假' })[receipt.status]
      } · ${
        receipt.correctedAt || receipt.checkedInAt
          ? new Date((receipt.correctedAt ?? receipt.checkedInAt)!).toLocaleString('zh-TW', {
              timeZone: 'Asia/Taipei',
            })
          : '時間尚未確認'
      }`
    : '';

  return (
    <Screen>
      <ScrollView
        style={s.flex}
        contentContainerStyle={[s.content, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} tintColor={theme.colors.accent} />
        }
      >
        {/* 課堂狀態 */}
        <View style={s.statusRow}>
          <View
            style={[
              s.statusDot,
              { backgroundColor: session.active ? theme.colors.success : theme.colors.danger },
            ]}
          />
          <View style={s.flex}>
            <Text accessibilityRole="header" style={s.statusTitle}>
              {session.active ? '課堂進行中' : '課堂已結束'}
            </Text>
            <Text style={s.metaText}>{session.attendeeCount} 人已簽到</Text>
          </View>
          {isTeacher && session.active && session.teacherId === myUid && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="結束課堂"
              onPress={handleEndSession}
              style={s.iconButton}
            >
              <Ionicons name="stop-circle-outline" size={24} color={theme.colors.danger} />
            </Pressable>
          )}
        </View>

        {isTeacher && session.active && session.teacherId !== myUid && (
          <Text style={s.noteText}>這場課堂由另一位老師開始，請由該老師結束點名。</Text>
        )}
        {(attendanceError || accessError) && (
          <Text accessibilityRole="alert" style={s.errorText}>
            {attendanceError || accessError}
          </Text>
        )}
        {!isTeacher && joined && (
          <View style={s.inlineRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
            <Text style={s.successText}>
              {receipt?.status === 'late' ? '已記錄遲到' : '已完成簽到'}
            </Text>
          </View>
        )}
        {!isTeacher && receipt && (
          <Text selectable style={s.noteText}>
            {receiptLabel}
          </Text>
        )}

        {/* 學生：尚未加入時顯示加入按鈕 */}
        {!isTeacher && canAttend && !joined && !receipt && session.active && (
          <Section title="課堂簽到" subtitle="掃描老師顯示的 QR Code，或輸入簽到碼。">
            <View style={s.stack}>
              {pending && (
                <Text accessibilityRole="alert" style={s.noteText}>
                  待確認 · 尚未收到簽到收據
                </Text>
              )}
              <Button
                text="掃描 QR Code"
                kind="primary"
                icon="qr-code-outline"
                fullWidth
                onPress={handleOpenQRScanner}
                disabled={joining}
              />
              <TextInput
                value={attendanceCode}
                onChangeText={(value) => {
                  setAttendanceCode(value);
                  setPending(false);
                }}
                placeholder="老師提供的簽到碼"
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel="簽到碼"
                autoCapitalize="none"
                autoCorrect={false}
                style={s.input}
              />
              <Button
                text={joining ? '正在確認…' : pending ? '再確認簽到' : '確認簽到'}
                kind="outline"
                fullWidth
                onPress={() => handleJoin(attendanceCode)}
                disabled={joining || !attendanceCode.trim()}
              />
            </View>
          </Section>
        )}

        {/* 教師：QR Code 出席打卡 */}
        {isTeacher && qrToken && session.active && (
          <Section title="出席打卡 QR Code" subtitle="學生掃碼即可記錄出席">
            <View style={s.qrBlock}>
              <View style={s.qrFrame}>
                <QRCodeSvg
                  value={`campusone://classroom/join?groupId=${encodeURIComponent(groupId)}&sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(qrToken)}`}
                  size={180}
                  color={QR_INK}
                  backgroundColor={QR_PAPER}
                  quietZone={12}
                />
              </View>
              <Text selectable style={s.codeText}>
                簽到碼：{qrToken}
              </Text>
              <Text style={[s.metaText, s.centerText]}>
                {`有效至 ${new Date(qrExpiresAt!).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}；逾時請結束後重新開始點名。`}
              </Text>
            </View>
          </Section>
        )}

        {isTeacher && session.active && !qrToken && (
          <Section
            title="簽到碼暫時無法顯示"
            subtitle="確認連線後重新讀取；若已到期，請結束後重新開始點名。"
          >
            <Button text="重新確認課堂" kind="outline" onPress={refresh} />
          </Section>
        )}

        {/* 理解度反饋（學生） */}
        {!isTeacher && joined && session.active && (
          <Section title="即時理解度" subtitle="讓老師知道你的學習狀況">
            <ReactionBar
              reactions={session.reactions}
              totalCount={session.attendeeCount}
              userReaction={userReaction}
              onReact={handleReact}
            />
          </Section>
        )}

        {/* 理解度總覽（教師） */}
        {isTeacher && (
          <Section title="學生理解度即時統計" subtitle="即時了解全班狀況">
            <ReactionBar
              reactions={session.reactions}
              totalCount={session.attendeeCount}
              userReaction={null}
              onReact={() => {}}
            />
          </Section>
        )}

        {/* 搶答 (Quick Answer Race) */}
        {quickAnswerActive && (
          <Section title="搶答" subtitle="快速回答老師的問題">
            <View style={s.stack}>
              {quickAnswerStartTime === null ? (
                <View style={s.countdownBlock}>
                  <Text style={s.countdownText}>
                    {quickAnswerCountdown > 0 ? quickAnswerCountdown : 'GO!'}
                  </Text>
                  <Text style={s.noteText}>
                    {quickAnswerCountdown > 0 ? '準備好了嗎？' : '開始搶答！'}
                  </Text>
                </View>
              ) : (
                <View style={s.stack}>
                  <View style={s.spaceBetween}>
                    <Text style={s.metaText}>回應者</Text>
                    <Text style={s.strongValue}>
                      {Object.keys(quickAnswerResponses).length} 人
                    </Text>
                  </View>
                  {Object.keys(quickAnswerResponses).length > 0 && (
                    <View style={s.subGroup}>
                      <Text style={s.subGroupTitle}>回應時間排行</Text>
                      {Object.entries(quickAnswerResponses)
                        .sort(([, a], [, b]) => a - b)
                        .slice(0, 5)
                        .map(([uid, time], idx) => (
                          <View key={uid} style={[s.rankRow, s.divider]}>
                            <Text style={[s.rankNumber, idx < 3 && s.rankNumberTop]}>
                              {idx + 1}
                            </Text>
                            <Text style={s.rankName}>學生 {uid.slice(0, 4)}</Text>
                            <Text style={s.rankTime}>{time}s</Text>
                          </View>
                        ))}
                    </View>
                  )}
                </View>
              )}
              {!isTeacher &&
                quickAnswerStartTime !== null &&
                !quickAnswerResponses[auth.user?.uid ?? ''] && (
                  <Button
                    text="搶答"
                    kind="primary"
                    size="large"
                    fullWidth
                    onPress={handleSubmitQuickAnswer}
                  />
                )}
              {isTeacher && quickAnswerStartTime !== null && (
                <Button text="結束搶答" kind="danger" fullWidth onPress={handleStopQuickAnswer} />
              )}
            </View>
          </Section>
        )}

        {/* 教師：啟動搶答 */}
        {isTeacher && !quickAnswerActive && session.active && (
          <Button text="啟動搶答" kind="primary" fullWidth onPress={handleStartQuickAnswer} />
        )}

        {/* 投票 */}
        {activePolls.length > 0 && (
          <Section title="即時投票" bare>
            <View style={s.group}>
              {activePolls.map((poll, index) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  first={index === 0}
                  myAnswer={myPollAnswers[poll.id] ?? null}
                  onAnswer={(idx) => handlePollAnswer(poll.id, idx)}
                />
              ))}
            </View>
          </Section>
        )}

        {/* 即時小測 - 進行中 */}
        {quizActive && (
          <Section title="即時小測" subtitle={`剩餘時間: ${quizTimerSeconds} 秒`}>
            <View style={s.stack}>
              <Text style={s.questionText}>{quizQuestion}</Text>
              <View style={s.optionStack}>
                {quizOptions
                  .filter((o) => o.trim())
                  .map((opt, i) => {
                    const totalResponses = Object.keys(quizResponses).length;
                    const thisOptionCount = Object.values(quizResponses).filter(
                      (v) => v === i,
                    ).length;
                    const pct =
                      totalResponses > 0 ? Math.round((thisOptionCount / totalResponses) * 100) : 0;
                    const userAnswered = quizResponses[auth.user?.uid ?? ''] === i;

                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: userAnswered,
                          disabled: !quizActive || !!quizResponses[auth.user?.uid ?? ''],
                        }}
                        onPress={() => handleSubmitPopQuizAnswer(i)}
                        disabled={!quizActive || !!quizResponses[auth.user?.uid ?? '']}
                        style={({ pressed }) => [
                          s.pollOption,
                          s.quizOption,
                          userAnswered && s.pollOptionActive,
                          pressed && s.pressed,
                        ]}
                      >
                        <Text style={s.quizLetter}>{String.fromCharCode(65 + i)}</Text>
                        <Text style={[s.optionText, userAnswered && s.optionTextActive]}>{opt}</Text>
                        {totalResponses > 0 && (
                          <Text style={s.metaText}>
                            {pct}% ({thisOptionCount})
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          </Section>
        )}

        {/* 教師：建立投票 */}
        {isTeacher && session.active && (
          <Section title="建立投票" subtitle="向學生發送即時選擇題">
            <View style={s.stack}>
              <TextInput
                value={newPollQuestion}
                onChangeText={setNewPollQuestion}
                placeholder="輸入問題..."
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel="投票問題"
                style={s.input}
              />
              {newPollOptions.map((opt, i) => (
                <View key={i} style={s.inputRow}>
                  <TextInput
                    value={opt}
                    onChangeText={(v) => {
                      const arr = [...newPollOptions];
                      arr[i] = v;
                      setNewPollOptions(arr);
                    }}
                    placeholder={`選項 ${i + 1}`}
                    placeholderTextColor={theme.colors.muted}
                    accessibilityLabel={`投票選項 ${i + 1}`}
                    style={[s.input, s.flex]}
                  />
                  {newPollOptions.length > 2 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`移除選項 ${i + 1}`}
                      onPress={() =>
                        setNewPollOptions(newPollOptions.filter((_, idx) => idx !== i))
                      }
                      style={s.iconButton}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={theme.colors.danger} />
                    </Pressable>
                  )}
                </View>
              ))}
              <View style={s.buttonRow}>
                <View style={s.flex}>
                  <Button
                    text="+ 新增選項"
                    kind="outline"
                    fullWidth
                    onPress={() => setNewPollOptions([...newPollOptions, ''])}
                  />
                </View>
                <View style={s.flex}>
                  <Button text="發送投票" kind="primary" fullWidth onPress={handleCreatePoll} />
                </View>
              </View>
            </View>
          </Section>
        )}

        {/* 教師：建立即時小測 */}
        {isTeacher && session.active && !quizActive && (
          <Section title="建立即時小測" subtitle="快速出題考查學生理解度">
            <View style={s.stack}>
              <TextInput
                value={quizQuestion}
                onChangeText={setQuizQuestion}
                placeholder="輸入測驗問題..."
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel="測驗問題"
                style={[s.input, s.multiline]}
                multiline
              />

              {quizOptions.map((opt, i) => (
                <View key={i} style={s.inputRow}>
                  <TextInput
                    value={opt}
                    onChangeText={(v) => {
                      const arr = [...quizOptions];
                      arr[i] = v;
                      setQuizOptions(arr);
                    }}
                    placeholder={`選項 ${String.fromCharCode(65 + i)}`}
                    placeholderTextColor={theme.colors.muted}
                    accessibilityLabel={`測驗選項 ${String.fromCharCode(65 + i)}`}
                    style={[s.input, s.flex]}
                  />
                  {quizOptions.length > 2 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`移除選項 ${String.fromCharCode(65 + i)}`}
                      onPress={() => setQuizOptions(quizOptions.filter((_, idx) => idx !== i))}
                      style={s.iconButton}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={theme.colors.danger} />
                    </Pressable>
                  )}
                </View>
              ))}

              <Button
                text="+ 新增選項"
                kind="outline"
                disabled={quizOptions.length >= 4}
                onPress={() => {
                  if (quizOptions.length < 4) {
                    setQuizOptions([...quizOptions, '']);
                  }
                }}
              />

              <View style={s.timerBlock}>
                <Text style={s.fieldLabel}>回答時間</Text>
                <View style={s.buttonRow}>
                  {[30, 60, 90].map((secs) => {
                    const active = quizTimerSeconds === secs;
                    return (
                      <Pressable
                        key={secs}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setQuizTimerSeconds(secs)}
                        style={[s.timerChip, active && s.timerChipActive]}
                      >
                        <Text style={[s.timerText, active && s.timerTextActive]}>{secs}s</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Button text="發送小測" kind="primary" fullWidth onPress={handleCreatePopQuiz} />
            </View>
          </Section>
        )}

        {/* 匿名問答 */}
        <Section
          title={`匿名問答 (${questions.length})`}
          subtitle="問題越多 upvote 越優先顯示"
          bare
        >
          {/* 提問輸入 */}
          {session.active && (
            <View style={s.inputRow}>
              <TextInput
                value={newQuestion}
                onChangeText={setNewQuestion}
                placeholder="輸入匿名問題..."
                placeholderTextColor={theme.colors.muted}
                accessibilityLabel="匿名問題"
                style={[s.input, s.flex]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="送出匿名問題"
                onPress={handleSubmitQuestion}
                disabled={!newQuestion.trim() || submittingQ}
                style={({ pressed }) => [
                  s.sendButton,
                  newQuestion.trim() ? s.sendButtonActive : s.sendButtonIdle,
                  pressed && s.pressed,
                ]}
              >
                <Ionicons
                  name="send"
                  size={18}
                  color={newQuestion.trim() ? theme.colors.onAccent : theme.colors.muted}
                />
              </Pressable>
            </View>
          )}

          {questions.length === 0 ? (
            <View style={[s.group, s.groupBody]}>
              <Text style={[s.noteText, s.centerText]}>尚無問題，鼓起勇氣提問！</Text>
            </View>
          ) : (
            <View style={s.group}>
              {questions.map((q, index) => {
                const voted = q.upvotedBy?.includes(auth.user?.uid ?? '');
                return (
                  <View key={q.id} style={[s.questionRow, index > 0 && s.divider]}>
                    <View style={s.flex}>
                      <Text style={s.questionBody}>{q.text}</Text>
                      {q.answered && (
                        <View style={s.inlineRow}>
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={14}
                            color={theme.colors.success}
                          />
                          <Text style={s.successText}>已回答</Text>
                        </View>
                      )}
                    </View>
                    <Pressable
                      disabled={!session.active}
                      accessibilityRole="button"
                      accessibilityLabel={voted ? '收回這個問題的票' : '為這個問題投票'}
                      accessibilityState={{ disabled: !session.active, selected: voted === true }}
                      onPress={() => handleUpvote(q)}
                      style={[
                        s.voteButton,
                        voted && s.voteButtonActive,
                        !session.active && s.disabled,
                      ]}
                    >
                      <Ionicons
                        name={voted ? 'thumbs-up' : 'thumbs-up-outline'}
                        size={18}
                        color={voted ? theme.colors.accent : theme.colors.textSecondary}
                      />
                      <Text style={[s.metaText, voted && s.voteCountActive]}>{q.upvotes}</Text>
                    </Pressable>
                    {isTeacher && !q.answered && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="標記為已回答"
                        onPress={() => handleMarkAnswered(q.id)}
                        style={s.iconButton}
                      >
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={22}
                          color={theme.colors.success}
                        />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </Section>
      </ScrollView>

      {/* QR Code 掃描器 Modal：相機與掃描框維持固定高對比 */}
      <Modal
        visible={showQRScanner}
        animationType="slide"
        onRequestClose={() => setShowQRScanner(false)}
      >
        <View style={s.scannerRoot}>
          <CameraView
            style={s.flex}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleQRScanned}
          />
          <View style={s.scannerOverlay} pointerEvents="none">
            <View style={s.scannerFrame} />
            <Text style={s.scannerHint}>將 QR Code 對準框內掃描簽到</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="關閉掃描器"
            onPress={() => setShowQRScanner(false)}
            style={s.scannerClose}
          >
            <Ionicons name="close" size={24} color={QR_PAPER} />
          </Pressable>
        </View>
      </Modal>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: theme.space.sm + 4 },
    content: { gap: theme.layout.sectionGap },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    disabled: { opacity: 0.55 },
    centerText: { textAlign: 'center' },
    spaceBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.sm,
    },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs + 2 },
    buttonRow: { flexDirection: 'row', gap: theme.space.sm },
    section: { gap: theme.space.sm },
    sectionHead: { gap: 2 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
      fontWeight: '700',
    },
    sectionSub: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    groupBody: { padding: theme.space.md },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    metaText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
    noteText: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    errorText: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
    successText: { color: theme.colors.success, fontSize: 12, fontWeight: '600' },
    strongValue: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
    fieldLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 56,
      paddingBottom: theme.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
    input: {
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
      color: theme.colors.text,
      fontSize: 15,
    },
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    qrBlock: { alignItems: 'center', gap: theme.space.sm + 4 },
    qrFrame: {
      padding: theme.space.xs,
      borderRadius: theme.radius.md,
      backgroundColor: QR_PAPER,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    codeText: { color: theme.colors.text, fontWeight: '700', fontSize: 16 },
    reactionRow: { flexDirection: 'row', gap: theme.space.sm },
    reactionButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 76,
      paddingVertical: theme.space.sm + 4,
      gap: 2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    reactionLabel: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
    reactionTrack: {
      height: 8,
      borderRadius: 4,
      overflow: 'hidden',
      flexDirection: 'row',
      backgroundColor: theme.colors.separator,
    },
    questionText: { color: theme.colors.text, fontWeight: '700', fontSize: 16, lineHeight: 22 },
    optionStack: { gap: theme.space.sm },
    pollOption: {
      minHeight: 48,
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    pollOptionActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    pollFillActive: { backgroundColor: theme.colors.accentSoft },
    pollFillIdle: { backgroundColor: theme.colors.surfaceInteractive },
    pollOptionBody: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 2,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm + 4,
    },
    optionText: { flex: 1, color: theme.colors.text, fontWeight: '600', fontSize: 15 },
    optionTextActive: { fontWeight: '700' },
    quizOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 2,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm + 4,
    },
    quizLetter: { width: 22, color: theme.colors.textSecondary, fontWeight: '700' },
    countdownBlock: { alignItems: 'center', paddingVertical: theme.space.md, gap: theme.space.sm },
    countdownText: { color: theme.colors.text, fontSize: 48, fontWeight: '700' },
    subGroup: {
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    subGroupTitle: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 13,
      padding: theme.space.sm + 4,
    },
    rankRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 44,
      paddingHorizontal: theme.space.sm + 4,
    },
    rankNumber: { width: 20, color: theme.colors.textSecondary, fontWeight: '600', fontSize: 13 },
    rankNumberTop: { color: theme.colors.text, fontWeight: '700' },
    rankName: { flex: 1, color: theme.colors.text, fontWeight: '600' },
    rankTime: { color: theme.colors.text, fontWeight: '700' },
    timerBlock: { gap: theme.space.sm },
    timerChip: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    timerChipActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    timerText: { color: theme.colors.textSecondary, fontWeight: '600', fontSize: 14 },
    timerTextActive: { color: theme.colors.text, fontWeight: '700' },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonActive: { backgroundColor: theme.colors.accent },
    sendButtonIdle: { backgroundColor: theme.colors.disabledBg },
    questionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minHeight: 56,
      paddingVertical: theme.space.sm + 2,
      paddingLeft: theme.space.md,
      paddingRight: theme.space.sm,
    },
    questionBody: { color: theme.colors.text, fontSize: 15, lineHeight: 21 },
    voteButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
    },
    voteButtonActive: { backgroundColor: theme.colors.accentSoft },
    voteCountActive: { color: theme.colors.text, fontWeight: '700' },
    scannerRoot: { flex: 1, backgroundColor: '#000000' },
    scannerOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scannerFrame: {
      width: 220,
      height: 220,
      borderRadius: 16,
      borderWidth: 3,
      borderColor: QR_PAPER,
      backgroundColor: 'transparent',
    },
    scannerHint: { color: QR_PAPER, marginTop: 20, fontSize: 15, textAlign: 'center' },
    scannerClose: {
      position: 'absolute',
      top: 56,
      right: 20,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 22,
    },
  });
