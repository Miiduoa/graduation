import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ScrollView, Text, TextInput, View, Pressable, Alert, Linking } from "react-native";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, SectionTitle, AnimatedCard, Avatar, StatusBadge, CountdownTimer, ProgressRing, SegmentedControl, SearchBar } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAsyncList } from "../hooks/useAsyncList";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";

type Group = {
  id: string;
  type: "course" | "club" | "admin";
  name: string;
};

type Assignment = {
  id: string;
  title: string;
  description: string;
  dueAt?: any;
  allowLate?: boolean;
  createdAt?: any;
  createdBy: string;
  createdByEmail?: string | null;
  gradesPublished?: boolean;
};

type Submission = {
  id: string; // uid
  uid: string;
  authorEmail?: string | null;
  authorName?: string | null;
  text: string;
  links: string[];
  files?: { name: string; url: string; size?: number }[];
  submittedAt?: any;
  updatedAt?: any;
  isLate?: boolean;
  grade?: number;
  feedback?: string;
  gradedAt?: any;
  graderId?: string;
  graderEmail?: string | null;
};

type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  studentId?: string;
  department?: string;
};

function parseLinks(input: string) {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AssignmentDetailScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const assignmentId: string | undefined = props?.route?.params?.assignmentId;

  const auth = useAuth();
  const db = getDb();

  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingGrade, setSavingGrade] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<{ name: string; uri: string; size?: number }[]>([]);
  const [viewMode, setViewMode] = useState<"all" | "graded" | "ungraded">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showStats, setShowStats] = useState(true);

  const { items: groupMeta } = useAsyncList<Group>(
    async () => {
      if (!groupId) return [];
      const snap = await getDoc(doc(db, "groups", groupId));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) } as Group];
    },
    [db, groupId]
  );

  const group = groupMeta[0];

  const { items: myMemberRows } = useAsyncList<{ role?: string }>(
    async () => {
      if (!groupId) return [];
      if (!auth.user) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "members", auth.user.uid));
      if (!snap.exists()) return [];
      return [snap.data() as any];
    },
    [db, groupId, auth.user?.uid]
  );

  const myRole = myMemberRows[0]?.role as any;
  const canManageCourse = group?.type === "course" && (myRole === "owner" || myRole === "instructor");

  const {
    items: assignmentRows,
    loading: assignmentLoading,
    error: assignmentError,
    reload: reloadAssignment,
  } = useAsyncList<Assignment>(
    async () => {
      if (!groupId || !assignmentId) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "assignments", assignmentId));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) } as any];
    },
    [db, groupId, assignmentId]
  );

  const assignment = assignmentRows[0];

  const {
    items: mySubmissionRows,
    loading: mySubmissionLoading,
    error: mySubmissionError,
    reload: reloadMySubmission,
  } = useAsyncList<Submission>(
    async () => {
      if (!groupId || !assignmentId) return [];
      if (!auth.user) return [];
      const snap = await getDoc(doc(db, "groups", groupId, "assignments", assignmentId, "submissions", auth.user.uid));
      if (!snap.exists()) return [];
      return [{ id: snap.id, uid: snap.id, ...(snap.data() as any) } as any];
    },
    [db, groupId, assignmentId, auth.user?.uid]
  );

  const mySubmission = mySubmissionRows[0];

  const [myText, setMyText] = useState("");
  const [myLinksText, setMyLinksText] = useState("");

  React.useEffect(() => {
    // Sync local inputs when submission loads/changes.
    setMyText(mySubmission?.text ?? "");
    setMyLinksText((mySubmission?.links ?? []).join("\n"));
  }, [mySubmission?.id]);

  const {
    items: submissions,
    loading: submissionsLoading,
    error: submissionsError,
    reload: reloadSubmissions,
  } = useAsyncList<Submission>(
    async () => {
      if (!groupId || !assignmentId) return [];
      if (!canManageCourse) return [];
      const ref = collection(db, "groups", groupId, "assignments", assignmentId, "submissions");
      const qy = query(ref, orderBy("submittedAt", "desc"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, uid: d.id, ...(d.data() as any) })) as any;
    },
    [db, groupId, assignmentId, canManageCourse]
  );

  // Fetch user profiles for submissions display
  const { items: userProfiles } = useAsyncList<UserProfile>(
    async () => {
      if (!canManageCourse || submissions.length === 0) return [];
      const uids = [...new Set(submissions.map(s => s.uid))];
      const profiles: UserProfile[] = [];
      for (const uid of uids) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) {
            profiles.push({ uid, ...(snap.data() as any) });
          }
        } catch {}
      }
      return profiles;
    },
    [db, canManageCourse, submissions.map(s => s.uid).join(",")]
  );

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) map[p.uid] = p;
    return map;
  }, [userProfiles]);

  // Calculate assignment stats
  const stats = useMemo(() => {
    const total = submissions.length;
    const graded = submissions.filter(s => typeof s.grade === "number").length;
    const ungraded = total - graded;
    const lateCount = submissions.filter(s => s.isLate).length;
    const grades = submissions.filter(s => typeof s.grade === "number").map(s => s.grade!);
    const avgGrade = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : 0;
    const maxGrade = grades.length > 0 ? Math.max(...grades) : 0;
    const minGrade = grades.length > 0 ? Math.min(...grades) : 0;
    return { total, graded, ungraded, lateCount, avgGrade, maxGrade, minGrade };
  }, [submissions]);

  // Filter submissions for teacher view
  const filteredSubmissions = useMemo(() => {
    let list = submissions;
    if (viewMode === "graded") list = list.filter(s => typeof s.grade === "number");
    if (viewMode === "ungraded") list = list.filter(s => typeof s.grade !== "number");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => {
        const profile = profilesById[s.uid];
        return (
          s.authorEmail?.toLowerCase().includes(q) ||
          profile?.displayName?.toLowerCase().includes(q) ||
          profile?.studentId?.toLowerCase().includes(q) ||
          profile?.department?.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [submissions, viewMode, searchQuery, profilesById]);

  // Calculate due status
  const dueStatus = useMemo(() => {
    if (!assignment?.dueAt) return { status: "no_due", remaining: 0 };
    const dueDate = assignment.dueAt?.toDate?.() ?? new Date(assignment.dueAt);
    const now = new Date();
    const remaining = dueDate.getTime() - now.getTime();
    if (remaining <= 0) return { status: "overdue", remaining: 0 };
    if (remaining < 24 * 60 * 60 * 1000) return { status: "urgent", remaining };
    if (remaining < 3 * 24 * 60 * 60 * 1000) return { status: "soon", remaining };
    return { status: "ok", remaining };
  }, [assignment?.dueAt]);

  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});

  // 同儕互評狀態
  const [peerReviewEnabled, setPeerReviewEnabled] = useState<boolean>(false);
  const [myReviewTask, setMyReviewTask] = useState<{ submissionOwnerId: string; ownerEmail?: string } | null>(null);
  const [peerScores, setPeerScores] = useState<Record<string, string>>({});
  const [peerComment, setPeerComment] = useState("");
  const [submittingPeerReview, setSubmittingPeerReview] = useState(false);
  const [peerReviewSent, setPeerReviewSent] = useState(false);
  const [peerReviewReceivedCount, setPeerReviewReceivedCount] = useState(0);
  const [myAggregateScore, setMyAggregateScore] = useState<number | null>(null);

  const PEER_REVIEW_CRITERIA = [
    { key: "logic", label: "邏輯清晰度", weight: 0.3 },
    { key: "completeness", label: "完整性", weight: 0.4 },
    { key: "creativity", label: "創意", weight: 0.3 },
  ];

  React.useEffect(() => {
    if (!canManageCourse) return;
    const nextG: Record<string, string> = {};
    const nextF: Record<string, string> = {};
    for (const s of submissions) {
      nextG[s.uid] = typeof s.grade === "number" ? String(s.grade) : gradeDraft[s.uid] ?? "";
      nextF[s.uid] = typeof s.feedback === "string" ? s.feedback : feedbackDraft[s.uid] ?? "";
    }
    setGradeDraft(nextG);
    setFeedbackDraft(nextF);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions.map((s) => `${s.uid}:${s.grade ?? ""}:${s.feedback ?? ""}`).join("|")]);

  const canSeeMyGrade = useMemo(() => {
    if (canManageCourse) return true;
    return !!assignment?.gradesPublished;
  }, [assignment?.gradesPublished, canManageCourse]);

  // 載入同儕互評狀態
  React.useEffect(() => {
    if (!groupId || !assignmentId || !auth.user) return;
    const uid = auth.user.uid;

    async function loadPeerReview() {
      try {
        const assignRef = doc(db, "groups", groupId!, "assignments", assignmentId!);
        const assignSnap = await getDoc(assignRef);
        const enabled = assignSnap.data()?.peerReviewEnabled ?? false;
        setPeerReviewEnabled(enabled);
        if (!enabled) return;

        const myReviewRef = doc(db, "groups", groupId!, "assignments", assignmentId!, "peerReviews", uid);
        const myReviewSnap = await getDoc(myReviewRef);
        if (myReviewSnap.exists()) {
          const data = myReviewSnap.data();
          if (!data.submittedAt) {
            setMyReviewTask({ submissionOwnerId: data.submissionOwnerId, ownerEmail: data.ownerEmail });
          } else {
            setPeerReviewSent(true);
          }
        }

        const receivedSnap = await getDocs(
          query(
            collection(db, "groups", groupId!, "assignments", assignmentId!, "peerReviews"),
            where("submissionOwnerId", "==", uid),
            where("submittedAt", "!=", null)
          )
        ).catch(() => ({ docs: [] as any[], size: 0 }));
        setPeerReviewReceivedCount(receivedSnap.size ?? receivedSnap.docs.length);

        if (receivedSnap.docs.length > 0) {
          let totalScore = 0;
          receivedSnap.docs.forEach((d) => {
            const scores: Record<string, number> = d.data().scores ?? {};
            const weighted = PEER_REVIEW_CRITERIA.reduce((sum, c) => {
              return sum + (scores[c.key] ?? 0) * c.weight;
            }, 0);
            totalScore += weighted;
          });
          setMyAggregateScore(Math.round(totalScore / receivedSnap.docs.length));
        }
      } catch {}
    }
    loadPeerReview();
  }, [groupId, assignmentId, auth.user?.uid, assignment?.id]);

  const enablePeerReview = async () => {
    if (!groupId || !assignmentId || !auth.user) return;
    const allSubs = submissions;
    if (allSubs.length < 2) {
      Alert.alert("人數不足", "至少需要 2 名學生繳交才能開啟同儕互評");
      return;
    }

    try {
      // 隨機分配評審：每人評審另一人（循環分配）
      const uids = allSubs.map((s) => s.uid);
      const shuffled = [...uids].sort(() => Math.random() - 0.5);

      await Promise.all(
        shuffled.map((reviewerId, i) => {
          const ownerId = shuffled[(i + 1) % shuffled.length];
          const ownerSubmission = allSubs.find((s) => s.uid === ownerId);
          return setDoc(
            doc(db, "groups", groupId!, "assignments", assignmentId!, "peerReviews", reviewerId),
            {
              reviewerId,
              submissionOwnerId: ownerId,
              ownerEmail: ownerSubmission?.authorEmail ?? "",
              assignedAt: serverTimestamp(),
              submittedAt: null,
              scores: {},
              comment: "",
            }
          );
        })
      );

      await updateDoc(doc(db, "groups", groupId!, "assignments", assignmentId!), {
        peerReviewEnabled: true,
        peerReviewEnabledAt: serverTimestamp(),
        peerReviewEnabledBy: auth.user.uid,
      });

      setPeerReviewEnabled(true);
      Alert.alert("同儕互評已開啟！", `已為 ${shuffled.length} 位學生隨機分配評審任務`);
    } catch (e: any) {
      Alert.alert("開啟失敗", e.message ?? "請稍後再試");
    }
  };

  const submitPeerReview = async () => {
    if (!myReviewTask || !groupId || !assignmentId || !auth.user) return;
    const scores: Record<string, number> = {};
    for (const c of PEER_REVIEW_CRITERIA) {
      const val = parseFloat(peerScores[c.key] ?? "0");
      if (isNaN(val) || val < 0 || val > 100) {
        Alert.alert("評分錯誤", `請為「${c.label}」輸入 0-100 的分數`);
        return;
      }
      scores[c.key] = val;
    }

    setSubmittingPeerReview(true);
    try {
      await updateDoc(
        doc(db, "groups", groupId!, "assignments", assignmentId!, "peerReviews", auth.user.uid),
        {
          scores,
          comment: peerComment.trim(),
          submittedAt: serverTimestamp(),
        }
      );
      setPeerReviewSent(true);
      setMyReviewTask(null);
      Alert.alert("評審完成！", "你的評語將匿名傳送給對方");
    } catch {
      Alert.alert("提交失敗", "請稍後再試");
    } finally {
      setSubmittingPeerReview(false);
    }
  };

  // File picker handler
  const handlePickFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const newFiles = result.assets.map(f => ({
        name: f.name,
        uri: f.uri,
        size: f.size,
      }));
      setSelectedFiles(prev => [...prev, ...newFiles]);
    } catch (e: any) {
      setErr("選擇檔案失敗：" + (e?.message ?? ""));
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!groupId || !assignmentId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    const text = myText.trim();
    const links = parseLinks(myLinksText);

    if (!text && links.length === 0 && selectedFiles.length === 0) {
      setErr("請至少填寫文字、連結或附件");
      return;
    }

    // Check late submission
    const dueAtDate = assignment?.dueAt?.toDate?.() ?? assignment?.dueAt;
    const dueMs = dueAtDate ? new Date(dueAtDate).getTime() : null;
    const nowMs = Date.now();
    const isLate = typeof dueMs === "number" && Number.isFinite(dueMs) ? nowMs > dueMs : false;

    if (isLate && !assignment?.allowLate) {
      Alert.alert(
        "截止時間已過",
        "此作業不允許遲交，是否仍要繳交？",
        [
          { text: "取消", style: "cancel" },
          { text: "仍要繳交", onPress: () => doSubmit(text, links, isLate) },
        ]
      );
      return;
    }

    await doSubmit(text, links, isLate);
  };

  const doSubmit = async (text: string, links: string[], isLate: boolean) => {
    if (!groupId || !assignmentId || !auth.user) return;
    setSubmitting(true);
    try {
      // Note: In production, files would be uploaded to Firebase Storage first
      // For now, we'll save file metadata (name, size)
      const filesMeta = selectedFiles.map(f => ({
        name: f.name,
        url: f.uri, // In production: upload to storage and get URL
        size: f.size,
      }));

      await setDoc(
        doc(db, "groups", groupId, "assignments", assignmentId, "submissions", auth.user.uid),
        {
          uid: auth.user.uid,
          authorEmail: auth.user.email ?? null,
          authorName: auth.profile?.displayName ?? null,
          text,
          links,
          files: filesMeta,
          isLate,
          updatedAt: serverTimestamp(),
          submittedAt: mySubmission?.submittedAt ?? serverTimestamp(),
        },
        { merge: true }
      );
      setSuccessMsg("繳交成功！");
      setSelectedFiles([]);
      reloadMySubmission();
      if (canManageCourse) reloadSubmissions();
    } catch (e: any) {
      setErr(e?.message ?? "繳交失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const onSaveGrade = async (uid: string) => {
    setErr(null);
    setSuccessMsg(null);
    if (!groupId || !assignmentId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canManageCourse) {
      setErr("你沒有權限評分");
      return;
    }

    const raw = (gradeDraft[uid] ?? "").trim();
    const grade = raw.length ? Number(raw) : null;
    if (raw.length && Number.isNaN(grade)) {
      setErr("分數必須是數字");
      return;
    }

    setSavingGrade(uid);
    try {
      await setDoc(
        doc(db, "groups", groupId, "assignments", assignmentId, "submissions", uid),
        {
          grade,
          feedback: (feedbackDraft[uid] ?? "").trim(),
          gradedAt: serverTimestamp(),
          graderId: auth.user.uid,
          graderEmail: auth.user.email ?? null,
        },
        { merge: true }
      );
      setSuccessMsg("評分已儲存");
      reloadSubmissions();
      reloadMySubmission();
    } catch (e: any) {
      setErr(e?.message ?? "儲存評分失敗");
    } finally {
      setSavingGrade(null);
    }
  };

  // Batch grade all ungraded submissions with same score
  const onBatchGrade = () => {
    const ungraded = submissions.filter(s => typeof s.grade !== "number");
    if (ungraded.length === 0) {
      Alert.alert("提示", "沒有待評分的繳交");
      return;
    }
    Alert.prompt?.(
      "批量評分",
      `將為 ${ungraded.length} 份未評分的繳交設定相同分數`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確定",
          onPress: async (value) => {
            const grade = Number(value);
            if (Number.isNaN(grade)) {
              setErr("請輸入有效數字");
              return;
            }
            setSubmitting(true);
            try {
              for (const s of ungraded) {
                await setDoc(
                  doc(db, "groups", groupId!, "assignments", assignmentId!, "submissions", s.uid),
                  {
                    grade,
                    gradedAt: serverTimestamp(),
                    graderId: auth.user!.uid,
                    graderEmail: auth.user!.email ?? null,
                  },
                  { merge: true }
                );
              }
              setSuccessMsg(`已為 ${ungraded.length} 份繳交評分`);
              reloadSubmissions();
            } catch (e: any) {
              setErr(e?.message ?? "批量評分失敗");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
      "plain-text",
      "",
      "numeric"
    ) ?? Alert.alert("批量評分", "此功能需要 iOS Alert.prompt 支援");
  };

  const setGradesPublished = async (next: boolean) => {
    setErr(null);
    if (!groupId || !assignmentId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canManageCourse) {
      setErr("你沒有權限發布成績");
      return;
    }

    try {
      await setDoc(doc(db, "groups", groupId, "assignments", assignmentId), { gradesPublished: next }, { merge: true });
      reloadAssignment();
    } catch (e: any) {
      setErr(e?.message ?? "更新成績發布狀態失敗");
    }
  };

  if (!groupId || !assignmentId) return <ErrorState title="作業" subtitle="缺少 groupId 或 assignmentId" />;
  if (assignmentLoading) return <LoadingState title="作業" subtitle="載入中..." rows={2} />;
  if (assignmentError) return <ErrorState title="作業" subtitle="讀取作業失敗" hint={assignmentError} />;

  if (!assignment) {
    return <ErrorState title="作業" subtitle="找不到作業" actionText="返回" onAction={() => nav?.goBack?.()} />;
  }

  const dueDate = assignment.dueAt?.toDate?.() ?? (assignment.dueAt ? new Date(assignment.dueAt) : null);
  const getDueStatusColor = () => {
    switch (dueStatus.status) {
      case "overdue": return theme.colors.danger;
      case "urgent": return "#F59E0B";
      case "soon": return theme.colors.accent;
      default: return theme.colors.success;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* Error/Success Messages */}
        {err && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.danger}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
              <Text style={{ flex: 1, color: theme.colors.danger }}>{err}</Text>
              <Pressable onPress={() => setErr(null)}>
                <Ionicons name="close" size={20} color={theme.colors.danger} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}
        {successMsg && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.success}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ flex: 1, color: theme.colors.success }}>{successMsg}</Text>
              <Pressable onPress={() => setSuccessMsg(null)}>
                <Ionicons name="close" size={20} color={theme.colors.success} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}

        {/* Assignment Info Card */}
        <AnimatedCard title={assignment.title} subtitle={group?.name}>
          <Text style={{ color: theme.colors.text, lineHeight: 22, marginBottom: 12 }}>{assignment.description}</Text>
          
          {/* Due Date Section */}
          {dueDate && (
            <View style={{ 
              padding: 14, 
              borderRadius: theme.radius.md, 
              backgroundColor: `${getDueStatusColor()}10`,
              borderWidth: 1,
              borderColor: `${getDueStatusColor()}30`,
              marginBottom: 12,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons 
                  name={dueStatus.status === "overdue" ? "time" : "calendar"} 
                  size={24} 
                  color={getDueStatusColor()} 
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: getDueStatusColor(), fontWeight: "700", fontSize: 14 }}>
                    {dueStatus.status === "overdue" ? "已截止" : "截止時間"}
                  </Text>
                  <Text style={{ color: theme.colors.text, fontSize: 15, marginTop: 2 }}>
                    {dueDate.toLocaleString("zh-TW", { 
                      year: "numeric", month: "long", day: "numeric", 
                      hour: "2-digit", minute: "2-digit" 
                    })}
                  </Text>
                </View>
                {dueStatus.status !== "overdue" && dueStatus.status !== "no_due" && (
                  <CountdownTimer targetDate={dueDate} />
                )}
              </View>
              {dueStatus.status === "overdue" && assignment.allowLate && (
                <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="information-circle" size={16} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>此作業允許遲交</Text>
                </View>
              )}
            </View>
          )}

          {/* Status Pills */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge 
              status={assignment.gradesPublished ? "success" : "warning"} 
              label={assignment.gradesPublished ? "成績已發布" : "成績未發布"} 
            />
            <Pill text={canManageCourse ? "教師" : "學生"} kind={canManageCourse ? "accent" : "default"} />
            {mySubmission && <StatusBadge status="success" label="已繳交" />}
            {mySubmission?.isLate && <StatusBadge status="warning" label="遲交" />}
          </View>

          {/* Teacher Actions */}
          {canManageCourse && (
            <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button
                text={assignment.gradesPublished ? "取消發布成績" : "發布成績"}
                kind={assignment.gradesPublished ? "secondary" : "primary"}
                onPress={() => setGradesPublished(!assignment.gradesPublished)}
              />
            </View>
          )}
        </AnimatedCard>

        {/* My Submission Section */}
        <AnimatedCard 
          title="我的繳交" 
          subtitle={mySubmission ? `最後更新：${mySubmission.updatedAt?.toDate?.()?.toLocaleString?.() ?? ""}` : "尚未繳交"}
          delay={50}
        >
          {mySubmissionLoading ? (
            <Text style={{ color: theme.colors.muted }}>載入中...</Text>
          ) : mySubmissionError ? (
            <Text style={{ color: theme.colors.danger }}>讀取繳交失敗：{mySubmissionError}</Text>
          ) : null}

          {/* Text Input */}
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>作業內容</Text>
            <TextInput
              value={myText}
              onChangeText={setMyText}
              placeholder="輸入你的作業內容..."
              placeholderTextColor="rgba(168,176,194,0.6)"
              multiline
              style={{
                minHeight: 100,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
                textAlignVertical: "top",
              }}
            />
          </View>

          {/* Links Input */}
          <View style={{ marginTop: 12 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>相關連結（每行一個）</Text>
            <TextInput
              value={myLinksText}
              onChangeText={setMyLinksText}
              placeholder="https://github.com/...\nhttps://drive.google.com/..."
              placeholderTextColor="rgba(168,176,194,0.6)"
              multiline
              style={{
                minHeight: 70,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
                textAlignVertical: "top",
              }}
            />
          </View>

          {/* File Attachments */}
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>附件檔案</Text>
              <Pressable 
                onPress={handlePickFiles}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Ionicons name="attach" size={16} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>新增檔案</Text>
              </Pressable>
            </View>
            
            {selectedFiles.length > 0 && (
              <View style={{ gap: 8 }}>
                {selectedFiles.map((file, idx) => (
                  <View 
                    key={idx}
                    style={{ 
                      flexDirection: "row", 
                      alignItems: "center", 
                      gap: 10, 
                      padding: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Ionicons name="document" size={20} color={theme.colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>{file.name}</Text>
                      {file.size && <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{formatFileSize(file.size)}</Text>}
                    </View>
                    <Pressable onPress={() => removeFile(idx)}>
                      <Ionicons name="close-circle" size={20} color={theme.colors.muted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Show existing files from submission */}
            {mySubmission?.files && mySubmission.files.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>已上傳的檔案：</Text>
                {mySubmission.files.map((file, idx) => (
                  <View 
                    key={idx}
                    style={{ 
                      flexDirection: "row", 
                      alignItems: "center", 
                      gap: 10, 
                      padding: 8,
                      borderRadius: theme.radius.sm,
                      backgroundColor: `${theme.colors.success}10`,
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                    <Text style={{ color: theme.colors.text, fontSize: 12 }} numberOfLines={1}>{file.name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Submit Buttons */}
          <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button 
              text={submitting ? "繳交中..." : (auth.user ? (mySubmission ? "更新繳交" : "送出作業") : "請先登入")} 
              kind="primary" 
              disabled={!auth.user || submitting} 
              onPress={onSubmit} 
            />
            <Button
              text="重新整理"
              onPress={() => {
                reloadMySubmission();
                if (canManageCourse) reloadSubmissions();
              }}
            />
          </View>

          {/* My Grade Display */}
          {mySubmission && (
            <View style={{ 
              marginTop: 14, 
              padding: 14, 
              borderRadius: theme.radius.md, 
              backgroundColor: theme.colors.surface2,
              borderLeftWidth: 3,
              borderLeftColor: canSeeMyGrade && typeof mySubmission.grade === "number" ? theme.colors.success : theme.colors.muted,
            }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>繳交狀態</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons 
                  name={mySubmission.isLate ? "time" : "checkmark-circle"} 
                  size={18} 
                  color={mySubmission.isLate ? "#F59E0B" : theme.colors.success} 
                />
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                  {mySubmission.isLate ? "已遲交繳交" : "已準時繳交"}
                </Text>
              </View>

              {canSeeMyGrade ? (
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 28 }}>
                      {typeof mySubmission.grade === "number" ? mySubmission.grade : "-"}
                    </Text>
                    <Text style={{ color: theme.colors.muted }}>分</Text>
                  </View>
                  {mySubmission.feedback && (
                    <View style={{ marginTop: 8, padding: 10, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }}>教師回饋</Text>
                      <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{mySubmission.feedback}</Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={{ color: theme.colors.muted, marginTop: 8 }}>成績尚未發布</Text>
              )}
            </View>
          )}
        </AnimatedCard>

        {/* Teacher: All Submissions Section */}
        {canManageCourse && (
          <AnimatedCard 
            title="全部繳交" 
            subtitle={`教師評分區 · 共 ${stats.total} 份`}
            delay={100}
          >
            {/* Stats Section */}
            <Pressable onPress={() => setShowStats(!showStats)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <Ionicons name={showStats ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>統計數據</Text>
              </View>
            </Pressable>

            {showStats && (
              <View style={{ 
                flexDirection: "row", 
                flexWrap: "wrap", 
                gap: 10, 
                marginBottom: 14,
                padding: 12,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.md,
              }}>
                <View style={{ flex: 1, minWidth: 80, alignItems: "center" }}>
                  <ProgressRing progress={stats.total > 0 ? stats.graded / stats.total : 0} size={50} />
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>已評分</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{stats.graded}/{stats.total}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 80, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{stats.avgGrade.toFixed(1)}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>平均分</Text>
                </View>
                <View style={{ flex: 1, minWidth: 80, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{stats.maxGrade}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>最高分</Text>
                </View>
                <View style={{ flex: 1, minWidth: 80, alignItems: "center" }}>
                  <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 24 }}>{stats.lateCount}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>遲交</Text>
                </View>
              </View>
            )}

            {/* Filter & Search */}
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="搜尋學生（姓名、學號）"
            />
            
            <View style={{ marginTop: 10 }}>
              <SegmentedControl
                options={[
                  { key: "all", label: `全部 (${stats.total})` },
                  { key: "ungraded", label: `待評 (${stats.ungraded})` },
                  { key: "graded", label: `已評 (${stats.graded})` },
                ]}
                selected={viewMode}
                onChange={(k) => setViewMode(k as any)}
              />
            </View>

            {/* Batch Actions */}
            {stats.ungraded > 0 && (
              <View style={{ marginTop: 12 }}>
                <Button text={`批量評分 (${stats.ungraded} 份)`} kind="secondary" onPress={onBatchGrade} />
              </View>
            )}

            {submissionsLoading ? (
              <LoadingState title="繳交" subtitle="載入中..." rows={2} />
            ) : submissionsError ? (
              <ErrorState title="繳交" subtitle="讀取繳交失敗" hint={submissionsError} actionText="重試" onAction={reloadSubmissions} />
            ) : (
              <View style={{ gap: 12, marginTop: 14 }}>
                {filteredSubmissions.map((s, idx) => {
                  const profile = profilesById[s.uid];
                  const displayName = profile?.displayName || s.authorEmail || s.uid.slice(0, 8);
                  const isSaving = savingGrade === s.uid;

                  return (
                    <AnimatedCard key={s.uid} delay={idx * 30}>
                      <View style={{ 
                        padding: 14, 
                        borderRadius: theme.radius.md, 
                        borderWidth: 1, 
                        borderColor: typeof s.grade === "number" ? `${theme.colors.success}40` : theme.colors.border,
                        backgroundColor: typeof s.grade === "number" ? `${theme.colors.success}05` : theme.colors.surface,
                      }}>
                        {/* Student Header */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                          {profile?.avatarUrl ? (
                            <Avatar name={displayName} size={44} imageUrl={profile.avatarUrl} />
                          ) : (
                            <View style={{
                              width: 44, height: 44, borderRadius: 22,
                              backgroundColor: theme.colors.surface2,
                              alignItems: "center", justifyContent: "center",
                            }}>
                              <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 16 }}>
                                {displayName[0]?.toUpperCase() ?? "?"}
                              </Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{displayName}</Text>
                            <View style={{ flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                              {profile?.studentId && <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{profile.studentId}</Text>}
                              {profile?.department && <Text style={{ color: theme.colors.muted, fontSize: 12 }}>· {profile.department}</Text>}
                            </View>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            {typeof s.grade === "number" ? (
                              <View style={{ alignItems: "center" }}>
                                <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 20 }}>{s.grade}</Text>
                                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>已評分</Text>
                              </View>
                            ) : (
                              <StatusBadge status="warning" label="待評分" />
                            )}
                          </View>
                        </View>

                        {/* Submission Status */}
                        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                          {s.isLate && <StatusBadge status="warning" label="遲交" />}
                          {s.submittedAt && (
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                              繳交於 {s.submittedAt?.toDate?.()?.toLocaleString?.() ?? ""}
                            </Text>
                          )}
                        </View>

                        {/* Submission Content */}
                        <View style={{ padding: 10, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.sm, marginBottom: 10 }}>
                          <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{s.text || "(無文字內容)"}</Text>
                        </View>

                        {/* Links */}
                        {s.links && s.links.length > 0 && (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>附加連結：</Text>
                            {s.links.map((l, i) => (
                              <Pressable key={i} onPress={() => Linking.openURL(l)}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
                                  <Ionicons name="link" size={14} color={theme.colors.accent} />
                                  <Text style={{ color: theme.colors.accent, fontSize: 13 }} numberOfLines={1}>{l}</Text>
                                </View>
                              </Pressable>
                            ))}
                          </View>
                        )}

                        {/* Files */}
                        {s.files && s.files.length > 0 && (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>附件檔案：</Text>
                            {s.files.map((f, i) => (
                              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
                                <Ionicons name="document" size={14} color={theme.colors.muted} />
                                <Text style={{ color: theme.colors.text, fontSize: 12 }}>{f.name}</Text>
                                {f.size && <Text style={{ color: theme.colors.muted, fontSize: 11 }}>({formatFileSize(f.size)})</Text>}
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Grading Section */}
                        <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12, gap: 10 }}>
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }}>分數</Text>
                              <TextInput
                                value={gradeDraft[s.uid] ?? ""}
                                onChangeText={(t) => setGradeDraft((m) => ({ ...m, [s.uid]: t }))}
                                placeholder="0-100"
                                placeholderTextColor="rgba(168,176,194,0.6)"
                                keyboardType="numeric"
                                style={{
                                  paddingVertical: 10,
                                  paddingHorizontal: 12,
                                  borderRadius: theme.radius.sm,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                  backgroundColor: theme.colors.surface2,
                                  color: theme.colors.text,
                                  textAlign: "center",
                                  fontWeight: "700",
                                  fontSize: 16,
                                }}
                              />
                            </View>
                          </View>
                          <View>
                            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }}>評語回饋</Text>
                            <TextInput
                              value={feedbackDraft[s.uid] ?? ""}
                              onChangeText={(t) => setFeedbackDraft((m) => ({ ...m, [s.uid]: t }))}
                              placeholder="給予學生回饋..."
                              placeholderTextColor="rgba(168,176,194,0.6)"
                              multiline
                              style={{
                                minHeight: 60,
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                borderRadius: theme.radius.sm,
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                backgroundColor: theme.colors.surface2,
                                color: theme.colors.text,
                                textAlignVertical: "top",
                              }}
                            />
                          </View>
                          <Button 
                            text={isSaving ? "儲存中..." : "儲存評分"} 
                            kind="primary" 
                            disabled={isSaving}
                            onPress={() => onSaveGrade(s.uid)} 
                          />
                        </View>
                      </View>
                    </AnimatedCard>
                  );
                })}

                {filteredSubmissions.length === 0 && (
                  <View style={{ alignItems: "center", paddingVertical: 30 }}>
                    <Ionicons name="document-text-outline" size={40} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 10 }}>
                      {searchQuery ? "找不到符合的繳交" : "目前沒有繳交"}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </AnimatedCard>
        )}

        {/* 同儕互評管理（教師） */}
        {canManageCourse && submissions.length > 0 && (
          <AnimatedCard
            title="同儕互評系統"
            subtitle={peerReviewEnabled ? "已開啟互評，學生正在進行評審" : "開啟後系統將隨機分配評審任務"}
          >
            {!peerReviewEnabled ? (
              <View style={{ gap: 12 }}>
                <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                  開啟後，系統會隨機為每位已繳交的學生分配一位同學互評。評語將匿名傳送，分數會聚合計算。
                </Text>
                <View style={{ gap: 8 }}>
                  {PEER_REVIEW_CRITERIA.map((c) => (
                    <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.success} />
                      <Text style={{ color: theme.colors.text, fontSize: 13 }}>
                        {c.label}（{Math.round(c.weight * 100)}%）
                      </Text>
                    </View>
                  ))}
                </View>
                <Button
                  text={`開啟同儕互評（${submissions.length} 人）`}
                  kind="primary"
                  onPress={enablePeerReview}
                />
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.successSoft,
                  }}
                >
                  <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.success, fontWeight: "700" }}>
                    同儕互評進行中，學生已收到通知
                  </Text>
                </View>
              </View>
            )}
          </AnimatedCard>
        )}

        {/* 同儕互評（學生評審任務） */}
        {!canManageCourse && peerReviewEnabled && (
          <AnimatedCard title="同儕互評任務" subtitle="你的評語將匿名傳送給對方">
            {peerReviewSent ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.success, fontWeight: "700" }}>你已完成評審，感謝貢獻！</Text>
                </View>
                {myAggregateScore !== null && (
                  <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft, gap: 4 }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>你收到的同儕互評結果（{peerReviewReceivedCount} 人評分）</Text>
                    <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 28 }}>{myAggregateScore} 分</Text>
                  </View>
                )}
              </View>
            ) : myReviewTask ? (
              <View style={{ gap: 12 }}>
                <View style={{ padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>你被分配評審的同學作業</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", marginTop: 4 }}>
                    {myReviewTask.ownerEmail ?? myReviewTask.submissionOwnerId.slice(0, 8)}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>（評語會匿名發送）</Text>
                </View>

                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>評分項目（各 0-100 分）</Text>
                {PEER_REVIEW_CRITERIA.map((c) => (
                  <View key={c.key}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                      {c.label}（佔 {Math.round(c.weight * 100)}%）
                    </Text>
                    <TextInput
                      value={peerScores[c.key] ?? ""}
                      onChangeText={(v) => setPeerScores((p) => ({ ...p, [c.key]: v }))}
                      placeholder="0-100"
                      placeholderTextColor={theme.colors.muted}
                      keyboardType="numeric"
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface2,
                        color: theme.colors.text,
                      }}
                    />
                  </View>
                ))}

                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>整體評語（匿名）</Text>
                  <TextInput
                    value={peerComment}
                    onChangeText={setPeerComment}
                    placeholder="給予建設性的評語..."
                    placeholderTextColor={theme.colors.muted}
                    multiline
                    style={{
                      minHeight: 80,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      color: theme.colors.text,
                      textAlignVertical: "top",
                    }}
                  />
                </View>

                <Button
                  text={submittingPeerReview ? "提交中..." : "提交評審"}
                  kind="primary"
                  disabled={submittingPeerReview}
                  onPress={submitPeerReview}
                />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}>
                <Ionicons name="hourglass-outline" size={16} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted }}>等待教師分配評審任務...</Text>
              </View>
            )}
          </AnimatedCard>
        )}
      </ScrollView>
    </Screen>
  );
}
