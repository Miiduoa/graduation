import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
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
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="訊息" subtitle={convo ? "已建立對話（即時更新）" : "尚未建立對話（送出第一則訊息會建立）"}>
          {refPostId ? <Pill text={`引用：${refPostId}`} kind="accent" /> : null}

          {msgLoading ? <LoadingState title="訊息" subtitle="載入中..." rows={3} /> : null}
          {msgError ? <ErrorState title="訊息" subtitle="讀取失敗" hint={msgError} /> : null}

          <View style={{ marginTop: 12, gap: 10 }}>
            {messages.map((m) => {
              const mine = m.senderId === auth.user?.uid;
              return (
                <View
                  key={m.id}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    backgroundColor: mine ? "rgba(112,76,255,0.18)" : "rgba(255,255,255,0.04)",
                  }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{mine ? "我" : m.senderId.slice(0, 8) + "…"}</Text>
                  <Text style={{ color: theme.colors.text, marginTop: 4, lineHeight: 20 }}>{m.text}</Text>
                </View>
              );
            })}
            {messages.length === 0 ? <Text style={{ color: theme.colors.muted }}>尚無訊息。</Text> : null}
          </View>
        </Card>

        <Card title="輸入" subtitle="先做文字訊息。">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="輸入訊息..."
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
          <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button text="送出" kind="primary" onPress={onSend} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
