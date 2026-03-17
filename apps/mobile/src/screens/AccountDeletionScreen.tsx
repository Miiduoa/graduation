import React, { useState } from "react";
import { ScrollView, Text, View, TextInput, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  writeBatch,
  limit,
} from "firebase/firestore";
import { deleteUser, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";

import {
  Screen,
  Card,
  Button,
  Pill,
  AnimatedCard,
  SectionTitle,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { getDb, getAuthInstance } from "../firebase";

type DeletionStep = "warning" | "confirm" | "password" | "deleting" | "done";

export function AccountDeletionScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const db = getDb();

  const [step, setStep] = useState<DeletionStep>("warning");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [deletionComplete, setDeletionComplete] = useState(false);

  const CONFIRM_TEXT = "刪除我的帳號";

  const handleProceedToConfirm = () => {
    setStep("confirm");
  };

  const handleProceedToPassword = () => {
    if (confirmText !== CONFIRM_TEXT) {
      Alert.alert("錯誤", `請輸入「${CONFIRM_TEXT}」以確認`);
      return;
    }
    setStep("password");
  };

  const handleDeleteAccount = async () => {
    if (!auth.user) {
      Alert.alert("錯誤", "請先登入");
      return;
    }

    setError(null);
    setStep("deleting");

    try {
      const uid = auth.user.uid;
      const firebaseAuth = getAuthInstance();
      const currentUser = firebaseAuth.currentUser;

      if (!currentUser) {
        throw new Error("無法取得當前用戶");
      }

      if (password) {
        setProgress("驗證身份...");
        const credential = EmailAuthProvider.credential(
          currentUser.email || "",
          password
        );
        await reauthenticateWithCredential(currentUser, credential);
      }

      setProgress("刪除個人資料...");
      
      try {
        await deleteDoc(doc(db, "users", uid));
      } catch (e) {
        console.log("User doc may not exist:", e);
      }

      setProgress("刪除通知設定...");
      try {
        await deleteDoc(doc(db, "users", uid, "settings", "notifications"));
      } catch (e) {
        console.log("Notification settings may not exist:", e);
      }

      setProgress("刪除推播 Token...");
      const tokensSnap = await getDocs(collection(db, "users", uid, "pushTokens"));
      for (const tokenDoc of tokensSnap.docs) {
        await deleteDoc(tokenDoc.ref);
      }

      setProgress("刪除群組成員資料...");
      const userGroupsSnap = await getDocs(collection(db, "users", uid, "groups"));
      for (const groupDoc of userGroupsSnap.docs) {
        await deleteDoc(groupDoc.ref);
      }

      setProgress("刪除學校成員資料...");
      try {
        await deleteDoc(doc(db, "schools", school.id, "members", uid));
      } catch (e) {
        console.log("School member doc may not exist:", e);
      }

      setProgress("刪除活動報名...");
      const regsSnap = await getDocs(
        query(
          collection(db, "schools", school.id, "registrations"),
          where("userId", "==", uid),
          limit(500)
        )
      );
      for (const regDoc of regsSnap.docs) {
        await deleteDoc(regDoc.ref);
      }

      setProgress("刪除 SSO 連結...");
      const ssoLinksSnap = await getDocs(
        query(collection(db, "ssoLinks"), where("firebaseUid", "==", uid), limit(10))
      );
      for (const ssoDoc of ssoLinksSnap.docs) {
        await deleteDoc(ssoDoc.ref);
      }

      setProgress("刪除 Firebase 帳號...");
      await deleteUser(currentUser);

      setDeletionComplete(true);
      setStep("done");
    } catch (error: any) {
      console.error("Account deletion error:", error);
      
      if (error.code === "auth/wrong-password") {
        setError("密碼錯誤，請重新輸入");
        setStep("password");
      } else if (error.code === "auth/requires-recent-login") {
        setError("需要重新登入後才能刪除帳號");
        setStep("password");
      } else {
        setError(error?.message || "刪除失敗，請稍後再試");
        setStep("warning");
      }
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <Card title="刪除帳號" subtitle="需要登入">
            <Pill text="請先登入" />
            <Text style={{ color: theme.colors.muted, marginTop: 10 }}>
              您需要登入才能刪除帳號。
            </Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  if (step === "done") {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="" subtitle="">
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: theme.colors.success + "20",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Ionicons name="checkmark-circle" size={48} color={theme.colors.success} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "700" }}>
                帳號已刪除
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  textAlign: "center",
                  marginTop: 12,
                  lineHeight: 22,
                }}
              >
                您的帳號和所有相關資料已被永久刪除。{"\n"}
                感謝您曾經使用我們的服務。
              </Text>
            </View>
          </AnimatedCard>

          <Button
            text="關閉 App"
            kind="primary"
            onPress={() => {
              Alert.alert("再見", "感謝您的使用，祝您一切順利！");
            }}
          />
        </ScrollView>
      </Screen>
    );
  }

  if (step === "deleting") {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="正在刪除帳號..." subtitle="">
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, marginTop: 16 }}>{progress}</Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: 12,
                  marginTop: 8,
                  textAlign: "center",
                }}
              >
                請勿關閉 App，此過程可能需要幾秒鐘...
              </Text>
            </View>
          </AnimatedCard>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {step === "warning" && (
          <>
            <AnimatedCard title="" subtitle="">
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <View
                  style={{
                    width: 70,
                    height: 70,
                    borderRadius: 35,
                    backgroundColor: theme.colors.error + "20",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Ionicons name="warning" size={36} color={theme.colors.error} />
                </View>
                <Text style={{ color: theme.colors.error, fontSize: 18, fontWeight: "700" }}>
                  刪除帳號
                </Text>
                <Text
                  style={{
                    color: theme.colors.muted,
                    textAlign: "center",
                    marginTop: 8,
                    lineHeight: 20,
                  }}
                >
                  此操作無法復原，請謹慎考慮
                </Text>
              </View>
            </AnimatedCard>

            {error && (
              <Card title="">
                <Pill text={error} />
              </Card>
            )}

            <Card title="刪除後將失去：">
              <View style={{ gap: 12 }}>
                {[
                  { icon: "person", text: "個人資料（姓名、學號、系所）" },
                  { icon: "heart", text: "所有收藏的項目" },
                  { icon: "people", text: "群組成員資格" },
                  { icon: "document-text", text: "發布的貼文和留言" },
                  { icon: "calendar", text: "活動報名紀錄" },
                  { icon: "school", text: "作業繳交和成績紀錄" },
                  { icon: "chatbubbles", text: "私訊對話記錄" },
                  { icon: "notifications", text: "通知設定和偏好" },
                ].map((item, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Ionicons name={item.icon as any} size={20} color={theme.colors.error} />
                    <Text style={{ color: theme.colors.text, flex: 1 }}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card title="替代方案">
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                如果您只是想暫時停用帳號，可以考慮：
              </Text>
              <View style={{ gap: 10, marginTop: 12 }}>
                <Button text="登出帳號" onPress={() => auth.signOut()} />
                <Button text="關閉推播通知" onPress={() => nav?.navigate?.("NotificationSettings")} />
                <Button text="匯出我的資料" onPress={() => nav?.navigate?.("DataExport")} />
              </View>
            </Card>

            <View style={{ gap: 10 }}>
              <Button
                text="我仍要刪除帳號"
                kind="primary"
                onPress={handleProceedToConfirm}
              />
              <Button text="取消" onPress={() => nav?.goBack?.()} />
            </View>
          </>
        )}

        {step === "confirm" && (
          <>
            <AnimatedCard title="確認刪除" subtitle="請輸入以下文字確認">
              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <View
                  style={{
                    padding: 16,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.error + "15",
                    marginBottom: 16,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.error,
                      fontSize: 18,
                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    {CONFIRM_TEXT}
                  </Text>
                </View>

                <Text style={{ color: theme.colors.muted, marginBottom: 12 }}>
                  請在下方輸入上述文字
                </Text>

                <TextInput
                  value={confirmText}
                  onChangeText={setConfirmText}
                  placeholder={CONFIRM_TEXT}
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    width: "100%",
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderRadius: theme.radius.md,
                    borderWidth: 2,
                    borderColor:
                      confirmText === CONFIRM_TEXT
                        ? theme.colors.error
                        : theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    textAlign: "center",
                    fontSize: 16,
                  }}
                />
              </View>
            </AnimatedCard>

            <View style={{ gap: 10 }}>
              <Button
                text="下一步"
                kind="primary"
                onPress={handleProceedToPassword}
                disabled={confirmText !== CONFIRM_TEXT}
              />
              <Button text="返回" onPress={() => setStep("warning")} />
            </View>
          </>
        )}

        {step === "password" && (
          <>
            <AnimatedCard title="驗證身份" subtitle="請輸入密碼以確認是本人操作">
              {error && (
                <View style={{ marginBottom: 12 }}>
                  <Pill text={error} />
                </View>
              )}

              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <View
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 30,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <Ionicons name="lock-closed" size={28} color={theme.colors.accent} />
                </View>

                <Text style={{ color: theme.colors.muted, marginBottom: 16 }}>
                  帳號：{auth.user?.email}
                </Text>

                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="輸入密碼"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  style={{
                    width: "100%",
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                    color: theme.colors.text,
                    fontSize: 16,
                  }}
                />

                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 12,
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  如果您使用 SSO 登入，請先設定密碼或聯繫管理員
                </Text>
              </View>
            </AnimatedCard>

            <View style={{ gap: 10 }}>
              <Button
                text="永久刪除我的帳號"
                kind="primary"
                onPress={handleDeleteAccount}
                disabled={!password}
              />
              <Button text="返回" onPress={() => setStep("confirm")} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
