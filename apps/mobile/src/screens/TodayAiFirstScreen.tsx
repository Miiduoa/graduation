/**
 * Campus AI-First — Mobile Today Demo
 * ------------------------------------
 * 新版 AI-First Today 主畫面 demo（Mobile）
 *
 * 配套設計文件：docs/design/AI_FIRST_REDESIGN.md
 * 視覺原型：docs/design/prototype.html
 *
 * 此檔不取代既有 TodayCockpitScreen，是並存的新版實作起點。
 * 要切換主入口，在 navigation 把 'Today' 指向 TodayAiFirstScreen 即可。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { rootNavigateNested } from '../app/rootNavigation';
import { requestLeave } from '../services/demoStore';

// ──────────────────────────────────────────────
// 內嵌 Design Tokens（避開 packages alias 風險）
// ──────────────────────────────────────────────
const tokens = {
  bg: '#F8F9FC',
  surface: '#FFFFFF',
  panel: '#F2F2F7',
  text: '#1C1C1E',
  muted: '#8E8E93',
  border: '#E5E5EA',
  ai: '#5856D6',
  aiStrong: '#4F46E5',
  aiSoft: 'rgba(88,86,214,0.10)',
  aiSurface: '#FAFBFF',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  confidenceHigh: '#34C759',
  confidenceMid: '#FF9500',
  radius: { sm: 12, md: 18, lg: 22, pill: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
};

// ──────────────────────────────────────────────
// AI Mark — 呼吸動畫圓形 logo
// ──────────────────────────────────────────────
function AiMark({ size = 28 }: { size?: number }) {
  const [scale] = useState(new Animated.Value(1));
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.04,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [scale]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tokens.ai,
        transform: [{ scale }],
        shadowColor: tokens.ai,
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    />
  );
}

// ──────────────────────────────────────────────
// Slot Card 元件
// ──────────────────────────────────────────────
type Confidence = 'high' | 'mid' | 'low';
function SlotCard({
  title,
  icon,
  confidence,
  source,
  children,
  onPin,
  pinned,
}: {
  title: string;
  icon: string;
  confidence: Confidence;
  source: string;
  children: React.ReactNode;
  onPin?: () => void;
  pinned?: boolean;
}) {
  const confMeta = {
    high: { color: tokens.confidenceHigh, label: '已驗證 ✓' },
    mid: { color: tokens.confidenceMid, label: '中信心 ●' },
    low: { color: tokens.danger, label: '建議找真人 ⚠' },
  }[confidence];

  return (
    <View style={[styles.slotCard, pinned && { borderColor: tokens.ai, borderWidth: 2 }]}>
      <View style={styles.slotCardTopBar} />
      <View style={styles.slotCardHeader}>
        <View style={styles.slotCardIcon}>
          <Text style={{ fontSize: 16 }}>{icon}</Text>
        </View>
        <Text style={styles.slotCardTitle}>{title}</Text>
        {onPin && (
          <TouchableOpacity
            onPress={onPin}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={pinned ? '已釘選，再按一次取消' : '釘到 Today'}
          >
            <Text style={[styles.slotCardPin, !pinned && { opacity: 0.4 }]}>📌</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.slotCardBody}>{children}</View>
      <View style={styles.slotCardFooter}>
        <Text style={styles.slotCardSource}>📡 {source}</Text>
        <View
          style={[
            styles.confidenceBadge,
            { backgroundColor: confMeta.color + '20' },
          ]}
        >
          <Text style={[styles.confidenceBadgeText, { color: confMeta.color }]}>
            {confMeta.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────
type ChatMsg = { id: string; role: 'user' | 'ai'; text: string; at: Date };

type WeeklyTodo = {
  id: string;
  when: string;
  text: string;
  tone: 'todo' | 'warn' | 'done' | 'muted';
  tag: string;
};

const WEEKLY_TODOS: WeeklyTodo[] = [
  { id: 'lab3', when: '週三', text: '作業系統 Lab 3', tone: 'warn', tag: '未開始' },
  { id: 'midterm', when: '週五', text: '專題期中報告 60%', tone: 'todo', tag: '進行中' },
  { id: 'weekly', when: '週日', text: '英文週記', tone: 'muted', tag: '' },
];

export default function TodayAiFirstScreen() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [leaveSent, setLeaveSent] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<ChatMsg[]>([
    {
      id: 'seed',
      role: 'ai',
      text: '早安 ☀️ 你今天有 3 堂課，要先聊哪一件？',
      at: new Date(),
    },
  ]);
  const scrollRef = useRef<ScrollView | null>(null);

  // ── 釘到 Today（同一張卡再按一次取消）──
  const togglePin = useCallback(
    (id: string) =>
      () =>
        setPinned((p) => ({ ...p, [id]: !p[id] })),
    [],
  );

  // ── 業務 handler ──
  const handleNavigateToClassroom = useCallback(() => {
    // 工程館 302 → 校園 Tab → Map（帶 POI 提示）
    rootNavigateNested('校園', 'MapV2', { highlight: '工程館 302', label: '資料結構教室' });
  }, []);

  const handleRequestLeave = useCallback(() => {
    Alert.alert('請假', '為「資料結構 09:10–10:50」建立請假草稿？', [
      { text: '取消', style: 'cancel' },
      {
        text: '建立草稿',
        onPress: () => {
          Alert.alert('已建立', '草稿已加到下方「請假草稿」區塊，按提交即送出。');
        },
      },
    ]);
  }, []);

  const handleAiSuggestionTap = useCallback(() => {
    // AI 建議「先去主餐廳吃中餐」→ 開 Cafeteria
    rootNavigateNested('校園' as any, 'Cafeteria', { highlight: '主餐廳' });
  }, []);

  const handleTodoTap = useCallback(
    (todo: WeeklyTodo) => () => {
      // 點待辦 → 跳到學習 Tab 的作業詳情；尚無 deep link 時用 AssignmentDetail
      rootNavigateNested('訊息', 'AssignmentDetail', {
        assignmentId: todo.id,
        title: todo.text,
      });
    },
    [],
  );

  const submitLeaveDraft = useCallback(() => {
    if (leaveSent) return;
    setLeaveSent(true);
    // 寫入 mobile demoStore：切到老師 / 系主任的訊息收件匣會看到並可審核
    requestLeave({
      courseId: 'c7',
      courseName: '資料庫系統',
      studentId: 'stu-001',
      studentName: '王小明',
      reason: '病假（AI 草稿）',
      dateFrom: '2026-05-21',
      dateTo: '2026-05-21',
    });
    setTimeout(() => {
      Alert.alert(
        '已送出',
        '請假已寫入 demoStore。切到老師 / 系主任 → 訊息 → 點訊息可看到核准/退回面板。',
      );
    }, 200);
  }, [leaveSent]);

  const cancelLeaveDraft = useCallback(() => {
    Alert.alert('取消草稿', '確定要取消此份請假草稿嗎？', [
      { text: '保留', style: 'cancel' },
      {
        text: '取消',
        style: 'destructive',
        onPress: () => setLeaveSent(false),
      },
    ]);
  }, []);

  // ── AI Sheet ──
  const sendChat = useCallback(
    (textOverride?: string) => {
      const text = (textOverride ?? chatInput).trim();
      if (!text) return;
      const user: ChatMsg = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        at: new Date(),
      };
      const ai: ChatMsg = {
        id: `a-${Date.now() + 1}`,
        role: 'ai',
        text: replyHeuristic(text),
        at: new Date(),
      };
      setChatLog((prev) => [...prev, user, ai]);
      setChatInput('');
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 50);
    },
    [chatInput],
  );

  const heroSub = useMemo(() => {
    const pinnedCount = Object.values(pinned).filter(Boolean).length;
    if (pinnedCount > 0) return `已釘選 ${pinnedCount} 張卡片 · 下節 09:10 資料結構`;
    return '下節 09:10 資料結構 · 工程館 302';
  }, [pinned]);

  return (
    <View style={styles.root}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroGreet}>☀️ 早安 王小明</Text>
          <Text style={styles.heroTitle}>
            今天 3 堂課{'\n'}+ 2 份作業
          </Text>
          <Text style={styles.heroSub}>{heroSub}</Text>
        </View>

        {/* AI Suggestion — 整張卡可點 */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleAiSuggestionTap}
          accessibilityRole="button"
          accessibilityLabel="AI 建議：先去主餐廳吃中餐"
          style={styles.aiSuggestion}
        >
          <View style={styles.aiSuggestionHead}>
            <AiMark size={24} />
            <Text style={styles.aiSuggestionLabel}>AI 建議</Text>
            <Text style={{ marginLeft: 'auto', fontSize: 11, color: tokens.ai }}>查看 ›</Text>
          </View>
          <Text style={styles.aiSuggestionTitle}>先去主餐廳吃中餐？</Text>
          <Text style={styles.aiSuggestionSub}>$95 · 步行 8 分鐘 · 你上次給 ⭐4.5</Text>
        </TouchableOpacity>

        {/* Slot Cards */}
        <View style={styles.cardsList}>
          <SlotCard
            title="下節課"
            icon="⏰"
            confidence="high"
            source="教務系統 · 09:43"
            onPin={togglePin('next-class')}
            pinned={!!pinned['next-class']}
          >
            <Text style={styles.body}>
              <Text style={styles.bold}>資料結構</Text> · 09:10–10:50
            </Text>
            <Text style={styles.body}>📍 工程館 302（步行 4 分鐘）</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={handleNavigateToClassroom}
                accessibilityRole="button"
              >
                <Text style={styles.btnPrimaryText}>🧭 導航</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnGhost}
                onPress={handleRequestLeave}
                accessibilityRole="button"
              >
                <Text style={styles.btnGhostText}>請假</Text>
              </TouchableOpacity>
            </View>
          </SlotCard>

          <SlotCard
            title="本週待辦 3 件"
            icon="📅"
            confidence="high"
            source="LMS · 09:42"
            onPin={togglePin('weekly-todo')}
            pinned={!!pinned['weekly-todo']}
          >
            {WEEKLY_TODOS.map((todo) => (
              <ScheduleRow
                key={todo.id}
                when={todo.when}
                text={todo.text}
                tone={todo.tone}
                tag={todo.tag}
                onPress={handleTodoTap(todo)}
              />
            ))}
          </SlotCard>

          <SlotCard
            title="請假草稿（待確認）"
            icon="📝"
            confidence="mid"
            source="從對話自動填入"
            onPin={togglePin('leave-draft')}
            pinned={!!pinned['leave-draft']}
          >
            <Text style={styles.body}>
              <Text style={styles.bold}>5/22</Text> 資料庫系統 · 病假
            </Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btnGhost, leaveSent && { opacity: 0.5 }]}
                onPress={cancelLeaveDraft}
                disabled={!leaveSent}
                accessibilityRole="button"
              >
                <Text style={styles.btnGhostText}>{leaveSent ? '取消提交' : '取消'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, leaveSent && { backgroundColor: tokens.success }]}
                onPress={submitLeaveDraft}
                disabled={leaveSent}
                accessibilityRole="button"
              >
                <Text style={styles.btnPrimaryText}>
                  {leaveSent ? '已送出 ✓' : '提交給老師 →'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.warnNote}>
              {leaveSent
                ? '⏳ 等待老師審核中（demo 顯示，後端 API 串接中）'
                : '⚠ AI 不會自動送出，需你最終確認'}
            </Text>
          </SlotCard>
        </View>
      </ScrollView>

      {/* 浮動 AI 助理按鈕（取代原本與真實 Tab Bar 重疊的假底部 dock） */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setSheetOpen(true)}
        accessibilityLabel="開啟 AI 助理"
        accessibilityRole="button"
      >
        <Text style={{ fontSize: 26 }}>✨</Text>
      </TouchableOpacity>

      {/* AI Command Sheet */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSheetOpen(false)}
            accessibilityLabel="關閉 AI 助理"
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <AiMark size={26} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.sheetTitle}>校園 AI</Text>
                <Text style={styles.sheetSub}>線上 · 已連結 7 系統</Text>
              </View>
              <TouchableOpacity onPress={() => setSheetOpen(false)} accessibilityLabel="關閉">
                <Text style={{ fontSize: 20, color: tokens.muted }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
            >
              {chatLog.map((m) =>
                m.role === 'ai' ? (
                  <View key={m.id} style={{ marginBottom: 8 }}>
                    <View style={styles.bubbleAi}>
                      <Text style={styles.bubbleText}>{m.text}</Text>
                    </View>
                    <Text style={styles.bubbleMeta}>
                      校園 AI · {formatTime(m.at)}
                    </Text>
                  </View>
                ) : (
                  <View key={m.id} style={{ marginBottom: 8, alignItems: 'flex-end' }}>
                    <View
                      style={[
                        styles.bubbleAi,
                        { backgroundColor: tokens.ai, borderColor: tokens.ai },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: '#fff' }]}>{m.text}</Text>
                    </View>
                    <Text style={styles.bubbleMeta}>你 · {formatTime(m.at)}</Text>
                  </View>
                ),
              )}

              <View style={styles.suggestionsRow}>
                {['下節課', '本週作業', '中午吃什麼', '請假'].map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestion}
                    onPress={() => sendChat(s)}
                    accessibilityRole="button"
                  >
                    <View style={styles.suggestionDot} />
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.sheetInputRow}>
              <TextInput
                style={styles.sheetInput}
                placeholder="問校園 AI 任何事..."
                placeholderTextColor={tokens.muted}
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={() => sendChat()}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sheetSend, !chatInput.trim() && { opacity: 0.4 }]}
                onPress={() => sendChat()}
                disabled={!chatInput.trim()}
                accessibilityLabel="送出"
                accessibilityRole="button"
              >
                <Text style={{ color: 'white', fontSize: 14 }}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 極簡 stub — AI 後端串接前，至少讓對話有「回應」而不是無聲卡死。 */
function replyHeuristic(input: string): string {
  const v = input.trim();
  if (/下節|next|class/i.test(v)) return '下節是 09:10 資料結構，工程館 302。要我幫你開地圖嗎？';
  if (/作業|todo|本週/i.test(v)) return '本週要交：作業系統 Lab 3（週三）、專題期中報告（週五）、英文週記（週日）。';
  if (/中午|午餐|吃/i.test(v)) return '主餐廳 ⭐4.5、$95、步行 8 分鐘。學餐 ⭐4.2、$65、步行 5 分鐘。要看完整清單嗎？';
  if (/請假|假/i.test(v)) return '我可以幫你建立請假草稿，但需要你最終按提交。要為哪一堂課請？';
  return '收到：「' + v + '」。我會把這個記下來，AI 後端串接後會給更完整的回覆。';
}

function ScheduleRow({
  when,
  text,
  tone,
  tag,
  onPress,
}: {
  when: string;
  text: string;
  tone: 'todo' | 'warn' | 'done' | 'muted';
  tag: string;
  onPress?: () => void;
}) {
  const dotColor = {
    todo: tokens.ai,
    warn: tokens.warning,
    done: tokens.success,
    muted: tokens.muted,
  }[tone];

  const Container: any = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const } : {};

  return (
    <Container {...containerProps} style={styles.schedRow}>
      <Text style={styles.schedWhen}>{when}</Text>
      <View style={[styles.schedDot, { backgroundColor: dotColor }]} />
      <Text style={styles.schedText}>{text}</Text>
      {tag ? (
        <View style={[styles.schedTag, { backgroundColor: dotColor + '20' }]}>
          <Text style={[styles.schedTagText, { color: dotColor }]}>{tag}</Text>
        </View>
      ) : null}
      {onPress ? <Text style={{ marginLeft: 6, color: tokens.muted, fontSize: 14 }}>›</Text> : null}
    </Container>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg },
  hero: { padding: tokens.space.lg, paddingTop: tokens.space.xl + 20 },
  heroGreet: { fontSize: 13, color: tokens.muted },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: tokens.text,
    letterSpacing: -0.3,
    marginTop: 4,
  },
  heroSub: { fontSize: 13, color: tokens.muted, marginTop: 6 },

  aiSuggestion: {
    marginHorizontal: tokens.space.md,
    backgroundColor: tokens.aiSurface,
    borderColor: tokens.ai + '30',
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    padding: tokens.space.md,
    marginBottom: tokens.space.md,
  },
  aiSuggestionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  aiSuggestionLabel: {
    marginLeft: 8,
    fontSize: 11,
    color: tokens.ai,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  aiSuggestionTitle: { fontSize: 15, fontWeight: '600', color: tokens.text },
  aiSuggestionSub: { fontSize: 12, color: tokens.muted, marginTop: 4 },

  cardsList: { paddingHorizontal: tokens.space.md, gap: tokens.space.md },

  slotCard: {
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border,
    padding: tokens.space.md,
    marginBottom: tokens.space.md,
    overflow: 'hidden',
  },
  slotCardTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: tokens.ai,
  },
  slotCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  slotCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: tokens.aiSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.text,
    marginLeft: 10,
    flex: 1,
  },
  slotCardPin: { fontSize: 18 },
  slotCardBody: { gap: 4 },
  slotCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: tokens.border,
    borderStyle: 'dashed',
  },
  slotCardSource: { fontSize: 11, color: tokens.muted },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tokens.radius.pill,
  },
  confidenceBadgeText: { fontSize: 10, fontWeight: '600' },

  body: { fontSize: 13, color: tokens.text, lineHeight: 19 },
  bold: { fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnPrimary: {
    backgroundColor: tokens.ai,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.sm,
  },
  btnPrimaryText: { color: 'white', fontSize: 13, fontWeight: '600' },
  btnGhost: {
    backgroundColor: tokens.surface,
    borderColor: tokens.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.sm,
  },
  btnGhostText: { color: tokens.text, fontSize: 13, fontWeight: '500' },
  warnNote: { marginTop: 8, fontSize: 11, color: tokens.warning },

  schedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  schedWhen: { fontSize: 11, color: tokens.muted, width: 36 },
  schedDot: { width: 8, height: 8, borderRadius: 4 },
  schedText: { flex: 1, fontSize: 13, color: tokens.text },
  schedTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  schedTagText: { fontSize: 9, fontWeight: '700' },

  // Floating Action Button — 浮在右下、不擋住真實 Tab Bar
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.ai,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: tokens.ai,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  // Command Sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: tokens.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: tokens.border,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.space.lg,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border,
  },
  sheetTitle: { fontSize: 15, fontWeight: '600', color: tokens.text },
  sheetSub: { fontSize: 11, color: tokens.success, marginTop: 2 },
  sheetBody: { padding: tokens.space.lg, maxHeight: 400 },
  bubbleAi: {
    backgroundColor: tokens.aiSurface,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: tokens.radius.md,
    padding: 12,
    alignSelf: 'flex-start',
    maxWidth: '88%',
  },
  bubbleText: { fontSize: 14, color: tokens.text, lineHeight: 20 },
  bubbleMeta: { fontSize: 10, color: tokens.muted, marginTop: 4 },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.pill,
    gap: 6,
  },
  suggestionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.ai },
  suggestionText: { fontSize: 12, color: tokens.text },
  sheetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: tokens.space.md,
    backgroundColor: tokens.panel,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  sheetInput: { flex: 1, fontSize: 14, color: tokens.text },
  sheetSend: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tokens.ai,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
