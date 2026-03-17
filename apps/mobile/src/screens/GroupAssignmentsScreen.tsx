import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAsyncList } from "../hooks/useAsyncList";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";

type Group = {
  id: string;
  type: "course" | "club" | "admin";
  name: string;
  finalScores?: { published?: boolean; publishedAt?: any };
};

type Assignment = {
  id: string;
  title: string;
  description: string;
  dueAt?: any;
  allowLate?: boolean;
  weight?: number;
  createdAt?: any;
  createdBy: string;
  createdByEmail?: string | null;
  gradesPublished?: boolean;
};

export function GroupAssignmentsScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;

  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Formal: teacher enters a due datetime in local time.
  const [dueAtText, setDueAtText] = useState("");
  // Weight (%) for final score computation (0-100). Default 10.
  const [weightText, setWeightText] = useState("10");

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
    items: assignments,
    loading: assignmentsLoading,
    error: assignmentsError,
    reload: reloadAssignments,
  } = useAsyncList<Assignment>(
    async () => {
      if (!groupId) return [];
      const ref = collection(db, "groups", groupId, "assignments");
      const qy = query(ref, orderBy("createdAt", "desc"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any;
    },
    [db, groupId]
  );

  const canCreate = canManageCourse;

  const assignmentCountText = useMemo(() => `作業數：${assignments.length}`, [assignments.length]);

  const onCreateAssignment = async () => {
    setErr(null);
    if (!groupId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canCreate) {
      setErr("你沒有權限建立作業");
      return;
    }
    if (!title.trim() || !description.trim()) {
      setErr("請輸入作業標題與說明");
      return;
    }

    // Parse due datetime: YYYY-MM-DD HH:mm
    const rawDue = (dueAtText ?? "").trim();
    let dueAt: Date | null = null;
    if (rawDue.length) {
      const m = rawDue.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (!m) {
        setErr("截止時間格式需為 YYYY-MM-DD HH:mm，例如 2026-02-01 23:59");
        return;
      }
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      dueAt = new Date(y, mo - 1, d, hh, mm, 0, 0);
      if (Number.isNaN(dueAt.getTime())) {
        setErr("截止時間無效，請檢查日期與時間");
        return;
      }
    }

    try {
      const wRaw = (weightText ?? "").trim();
      const weight = wRaw.length ? Number(wRaw) : 0;
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
        setErr("權重請輸入 0~100 的數字（%）");
        return;
      }

      await addDoc(collection(db, "groups", groupId, "assignments"), {
        title: title.trim(),
        description: description.trim(),
        dueAt: dueAt ?? null,
        allowLate: true,
        weight,
        createdAt: serverTimestamp(),
        createdBy: auth.user.uid,
        createdByEmail: auth.user.email ?? null,
        gradesPublished: false,
        schoolId: school.id,
      });
      setTitle("");
      setDescription("");
      setDueAtText("");
      setWeightText("10");
      reloadAssignments();
    } catch (e: any) {
      setErr(e?.message ?? "建立作業失敗");
    }
  };

  const publishFinalScores = async () => {
    setErr(null);
    if (!groupId) return;
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!canManageCourse) {
      setErr("你沒有權限發布期末成績");
      return;
    }

    try {
      // Compute weighted final score = sum(grade * weight)/sum(weight) over graded assignments.
      // NOTE: MVP approach; for large classes, move to Cloud Functions.
      const passingScore = 60;

      const membersSnap = await getDocs(query(collection(db, "groups", groupId, "members")));
      const memberUids = membersSnap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as any) }))
        .filter((m: any) => m.status === "active")
        .map((m: any) => String(m.uid));

      const assignmentsRef = collection(db, "groups", groupId, "assignments");
      const aSnap = await getDocs(query(assignmentsRef, orderBy("createdAt", "desc")));
      const assignments = aSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];

      const sums: Record<string, { wSum: number; gwSum: number; graded: number }> = {};
      for (const uid of memberUids) sums[uid] = { wSum: 0, gwSum: 0, graded: 0 };

      for (const a of assignments) {
        const w = typeof a.weight === "number" ? a.weight : 0;
        if (!w || w <= 0) continue;

        for (const uid of memberUids) {
          const sDoc = await getDoc(doc(db, "groups", groupId, "assignments", a.id, "submissions", uid));
          if (!sDoc.exists()) continue;
          const s = sDoc.data() as any;
          if (typeof s.grade !== "number") continue;
          sums[uid].wSum += w;
          sums[uid].gwSum += s.grade * w;
          sums[uid].graded += 1;
        }
      }

      for (const uid of memberUids) {
        const row = sums[uid];
        const finalScore = row.wSum > 0 ? Math.round((row.gwSum / row.wSum) * 10) / 10 : null;
        const result = typeof finalScore === "number" ? (finalScore >= passingScore ? "passed" : "failed") : "incomplete";

        await setDoc(
          doc(db, "groups", groupId, "gradebook", uid),
          {
            uid,
            finalScore,
            passingScore,
            result,
            published: true,
            publishedAt: serverTimestamp(),
            publishedBy: auth.user.uid,
            computedFrom: { assignments: assignments.length, gradedAssignments: row.graded, weightSum: row.wSum },
          },
          { merge: true }
        );

        // Write per-user milestone (verified result) when published.
        await setDoc(
          doc(db, "users", uid, "milestones", `course:${groupId}`),
          {
            kind: "course",
            groupId,
            courseName: group?.name ?? null,
            schoolId: school.id,
            status: "verified",
            result,
            passingScore,
            finalScore,
            verifiedBy: auth.user.uid,
            verifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await setDoc(
        doc(db, "groups", groupId),
        {
          finalScores: {
            published: true,
            publishedAt: serverTimestamp(),
            publishedBy: auth.user.uid,
          },
        },
        { merge: true }
      );

      // Group-level milestone for back-office / admin review.
      await setDoc(
        doc(db, "groups", groupId, "milestones", "finalScores"),
        {
          kind: "finalScores",
          status: "pending_verification",
          publishedAt: serverTimestamp(),
          publishedBy: auth.user.uid,
        },
        { merge: true }
      );

      reloadAssignments();
    } catch (e: any) {
      setErr(e?.message ?? "發布期末成績失敗");
    }
  };

  if (!groupId) return <ErrorState title="作業" subtitle="缺少 groupId" />;

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="作業" subtitle={group?.name ? `${group.name}｜${assignmentCountText}` : assignmentCountText}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={canManageCourse ? "教師模式" : "學生模式"} kind={canManageCourse ? "accent" : "default"} />
            {group?.finalScores?.published ? <Pill text="期末成績：已發布" kind="accent" /> : <Pill text="期末成績：未發布" />}
          </View>

          {err ? (
            <View style={{ marginTop: 10 }}>
              <Pill text={err} />
            </View>
          ) : null}

          {canManageCourse ? (
            <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button text="發布期末成績" kind="primary" onPress={publishFinalScores} />
            </View>
          ) : null}
        </Card>

        {canCreate ? (
          <Card title="建立作業（教師）" subtitle="(MVP) 文字作業；學生可繳交文字＋連結；逾期仍可交但會標記。">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="作業標題"
              placeholderTextColor="rgba(168,176,194,0.6)"
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: theme.colors.text,
              }}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="作業說明"
              placeholderTextColor="rgba(168,176,194,0.6)"
              multiline
              style={{
                marginTop: 10,
                minHeight: 90,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: theme.colors.text,
                textAlignVertical: "top",
              }}
            />
            <TextInput
              value={dueAtText}
              onChangeText={setDueAtText}
              placeholder="截止時間（YYYY-MM-DD HH:mm），可留空"
              placeholderTextColor="rgba(168,176,194,0.6)"
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: theme.colors.text,
              }}
            />
            <Text style={{ color: theme.colors.muted, marginTop: 8, fontSize: 12, lineHeight: 18 }}>
              逾期仍可交（會標記逾期）。建議格式：2026-02-01 23:59
            </Text>

            <TextInput
              value={weightText}
              onChangeText={setWeightText}
              placeholder="權重（0~100，%）例如 10"
              placeholderTextColor="rgba(168,176,194,0.6)"
              keyboardType="numeric"
              style={{
                marginTop: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: theme.colors.text,
              }}
            />
            <Text style={{ color: theme.colors.muted, marginTop: 8, fontSize: 12, lineHeight: 18 }}>
              期末成績會依各作業權重做加權平均（只計入已評分作業）。
            </Text>

            <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button text={auth.user ? "建立" : "請先登入"} kind="primary" disabled={!auth.user} onPress={onCreateAssignment} />
              <Button text="重新整理" onPress={reloadAssignments} />
            </View>
          </Card>
        ) : null}

        {assignmentsLoading ? (
          <LoadingState title="作業" subtitle="載入中..." rows={3} />
        ) : assignmentsError ? (
          <ErrorState title="作業" subtitle="讀取作業失敗" hint={assignmentsError} actionText="重試" onAction={reloadAssignments} />
        ) : (
          <Card title="作業列表" subtitle="點進去繳交 / 批改">
            <SectionTitle text={`共 ${assignments.length} 份`} />
            <View style={{ marginTop: 10, gap: 10 }}>
              {assignments.map((a) => (
                <Card
                  key={a.id}
                  title={a.title}
                  subtitle={`${a.gradesPublished ? "成績：已發布" : "成績：未發布"}${typeof a.weight === "number" ? `｜權重：${a.weight}%` : ""}${a.dueAt ? `｜截止：${new Date(a.dueAt?.toDate?.() ?? a.dueAt).toLocaleString()}` : ""}`}
                >
                  <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{a.description}</Text>
                  <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <Button
                      text="查看 / 繳交 / 批改"
                      kind="primary"
                      onPress={() => nav?.navigate?.("AssignmentDetail", { groupId, assignmentId: a.id })}
                    />
                  </View>
                </Card>
              ))}
              {assignments.length === 0 ? <Text style={{ color: theme.colors.muted }}>目前沒有作業。</Text> : null}
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
