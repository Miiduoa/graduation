import React, { useMemo } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { Screen, Card, Button, Pill, LoadingState, ErrorState, AnimatedCard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAsyncList } from "../hooks/useAsyncList";
import { Ionicons } from "@expo/vector-icons";

type Conversation = {
  id: string;
  type: "dm" | "group_chat";
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
};

export function DmsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const db = getDb();

  const { items, loading, error, reload } = useAsyncList<Conversation>(
    async () => {
      if (!auth.user) return [];
      try {
        const ref = collection(db, "conversations");
        const qy = query(ref, where("type", "==", "dm"), where("memberIds", "array-contains", auth.user.uid));
        const snap = await getDocs(qy);
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as any));
      } catch (e: any) {
        if (e?.code === "permission-denied" || e?.message?.includes("permission")) {
          return [];
        }
        throw e;
      }
    },
    [db, auth.user?.uid]
  );

  const rows = useMemo(() => {
    const list = [...items];
    // Avoid ordering query to prevent composite index; sort client-side.
    list.sort((a, b) => {
      const atA = (a.lastMessageAt?.seconds ?? 0) as number;
      const atB = (b.lastMessageAt?.seconds ?? 0) as number;
      return atB - atA;
    });
    return list;
  }, [items]);

  if (!auth.user) {
    return (
      <Screen>
        <AnimatedCard title="私訊" subtitle="與其他用戶的對話">
          <View style={{ alignItems: "center", padding: 24 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: theme.colors.accentSoft,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.accent} />
            </View>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18, marginBottom: 8 }}>
              尚未登入
            </Text>
            <Text style={{ color: theme.colors.muted, textAlign: "center", marginBottom: 16 }}>
              請先登入才能使用私訊功能
            </Text>
            <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.("我的")} />
          </View>
        </AnimatedCard>
      </Screen>
    );
  }

  return (
    <Screen>
      {loading ? (
        <LoadingState title="私訊" subtitle="載入中..." rows={3} />
      ) : error ? (
        <ErrorState title="私訊" subtitle="讀取私訊失敗" hint={String(error)} actionText="重試" onAction={reload} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="最近對話" subtitle={`共 ${rows.length} 個`}> 
            <View style={{ marginTop: 10, gap: 10 }}>
              {rows.map((c) => {
                const peerId = c.memberIds.find((id) => id !== auth.user?.uid) ?? "(unknown)";
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId })}
                    style={{ borderRadius: theme.radius.lg }}
                  >
                    <Card title={`${peerId.slice(0, 8)}…`} subtitle={c.lastMessageText ?? "(尚無訊息)"}>
                      <Button text="開啟" kind="primary" onPress={() => nav?.navigate?.("Chat", { kind: "dm", peerId })} />
                    </Card>
                  </Pressable>
                );
              })}
              {rows.length === 0 ? (
                <View style={{ alignItems: "center", padding: 20 }}>
                  <Ionicons name="chatbubble-ellipses-outline" size={40} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12, textAlign: "center" }}>
                    目前沒有對話{"\n"}你可以到群組成員列表開始私訊
                  </Text>
                </View>
              ) : null}
            </View>
          </AnimatedCard>
        </ScrollView>
      )}
    </Screen>
  );
}
