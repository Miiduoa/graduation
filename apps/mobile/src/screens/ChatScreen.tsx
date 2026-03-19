import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ScrollView, Text, TextInput, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, LoadingState, ErrorState } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { useAsyncList } from "../hooks/useAsyncList";

type Msg = { id: string; senderId: string; text: string; createdAt?: any };

type Conversation = {
  id: string;
  type: "dm" | "group_chat";
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
};

function dmId(a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `dm_${x}_${y}`;
}

export function ChatScreen(props: any) {
  const peerId = props?.route?.params?.peerId as string | undefined;
  const refPostId = props?.route?.params?.refPostId as string | undefined;
  const auth = useAuth();
  const db = getDb();

  const [text, setText] = useState("");
  // 快取用戶名稱：{ [uid]: displayName }
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const fetchUserName = useCallback(async (uid: string) => {
    if (userNames[uid]) return;
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const name = snap.data()?.displayName ?? snap.data()?.email ?? uid.slice(0, 8);
        setUserNames((prev) => ({ ...prev, [uid]: name }));
      } else {
        setUserNames((prev) => ({ ...prev, [uid]: uid.slice(0, 8) }));
      }
    } catch {
      setUserNames((prev) => ({ ...prev, [uid]: uid.slice(0, 8) }));
    }
  }, [db, userNames]);

  const convoKey = useMemo(() => {
    if (!auth.user || !peerId) return null;
    return dmId(auth.user.uid, peerId);
  }, [auth.user?.uid, peerId]);

  const { items: convoRows, loading: convoLoading, error: convoError, reload: reloadConvo } = useAsyncList<Conversation>(
    async () => {
      if (!convoKey) return [];
      const snap = await getDoc(doc(db, "conversations", convoKey));
      if (!snap.exists()) return [];
      return [{ id: snap.id, ...(snap.data() as any) } as any];
    },
    [db, convoKey]
  );

  const convo = convoRows[0];

  const [messages, setMessages] = useState<Msg[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);
  const [msgError, setMsgError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!convoKey) {
      setMessages([]);
      setMsgLoading(false);
      return;
    }

    setMsgLoading(true);
    setMsgError(null);

    const ref = collection(db, "conversations", convoKey, "messages");
    const qy = query(ref, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(
      qy,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Msg[];
        setMessages(rows);
        setMsgLoading(false);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        // 預先抓取所有發訊者的用戶名稱
        const senderIds = [...new Set(rows.map((m) => m.senderId).filter((id) => id !== auth.user?.uid))];
        senderIds.forEach(fetchUserName);
      },
      (error) => {
        console.error("[ChatScreen] Messages subscription error:", error);
        setMsgError(error.message);
        setMsgLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db, convoKey]);

  const headerHint = useMemo(() => {
    if (!refPostId) return null;
    return `引用貼文：${refPostId}`;
  }, [refPostId]);

  const ensureConversation = async () => {
    if (!auth.user || !peerId || !convoKey) return;
    const ref = doc(db, "conversations", convoKey);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      type: "dm",
      memberIds: [auth.user.uid, peerId],
      createdAt: serverTimestamp(),
    });
  };

  const onSend = async () => {
    if (!auth.user) return;
    if (!peerId) return;
    if (!convoKey) return;
    if (!text.trim()) return;

    await ensureConversation();

    await addDoc(collection(db, "conversations", convoKey, "messages"), {
      senderId: auth.user.uid,
      text: text.trim(),
      createdAt: serverTimestamp(),
      refPostId: refPostId ?? null,
    });

    await setDoc(
      doc(db, "conversations", convoKey),
      {
        lastMessageText: text.trim(),
        lastMessageAt: serverTimestamp(),
      },
      { merge: true }
    );

    setText("");
    reloadConvo();
  };

  if (!auth.user) {
    return <ErrorState title="對話" subtitle="尚未登入" hint="請先到『我的』登入" />;
  }
  if (!peerId) {
    return <ErrorState title="對話" subtitle="缺少 peerId" hint="請從群組成員列表進入私訊" />;
  }

  if (convoLoading) return <LoadingState title="對話" subtitle="載入中..." rows={2} />;
  if (convoError) return <ErrorState title="對話" subtitle="讀取對話失敗" hint={convoError} actionText="重試" onAction={reloadConvo} />;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* 訊息列表 */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 8 }}
        >
          {refPostId ? (
            <View style={{ padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft, marginBottom: 8 }}>
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>引用貼文：{refPostId}</Text>
            </View>
          ) : null}

          {msgLoading ? <LoadingState title="訊息" subtitle="載入中..." rows={3} /> : null}
          {msgError ? <ErrorState title="訊息" subtitle="讀取失敗" hint={msgError} /> : null}

          {messages.map((m) => {
            const mine = m.senderId === auth.user?.uid;
            const senderName = mine ? "我" : (userNames[m.senderId] ?? m.senderId.slice(0, 8));
            return (
              <View
                key={m.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                }}
              >
                {!mine && (
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4, marginLeft: 4 }}>
                    {senderName}
                  </Text>
                )}
                <View
                  style={{
                    padding: 12,
                    borderRadius: 18,
                    borderBottomRightRadius: mine ? 4 : 18,
                    borderBottomLeftRadius: mine ? 18 : 4,
                    backgroundColor: mine ? theme.colors.accent : theme.colors.surface2,
                    borderWidth: mine ? 0 : 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text style={{ color: mine ? "#fff" : theme.colors.text, lineHeight: 20 }}>{m.text}</Text>
                </View>
              </View>
            );
          })}
          {messages.length === 0 && !msgLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
              <Ionicons name="chatbubble-outline" size={36} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted }}>尚無訊息，發送第一則訊息開始對話</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* 輸入列 */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: 12,
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="輸入訊息..."
            placeholderTextColor={theme.colors.muted}
            onSubmitEditing={onSend}
            returnKeyType="send"
            multiline
            style={{
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
              maxHeight: 80,
            }}
          />
          <Pressable
            onPress={onSend}
            disabled={!text.trim()}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: text.trim() ? theme.colors.accent : theme.colors.surface2,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="send" size={20} color={text.trim() ? "#fff" : theme.colors.muted} />
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
