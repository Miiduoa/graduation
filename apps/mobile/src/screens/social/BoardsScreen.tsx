/* eslint-disable */
/**
 * 校園社群 — 看板列表
 *
 * 變更（vs. 舊版）：
 *  - 分區顯示（系所 / 課程 / 主題 / 匿名）
 *  - 顯示訂閱狀態 chip（已訂閱）
 *  - 點訂閱 icon 直接 toggle（不需進入詳情）
 *  - 預先載入 user 的訂閱集合，避免每張卡再打一次 query
 *  - 提供「建立看板」入口（任何使用者都可以在本機 UI 操作；rules 由後端把關）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Image,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useSchool } from '../../state/school';
import { useAuth } from '../../state/auth';
import { isFirebaseMockMode } from '../../firebase';
import {
  listBoards,
  listSubscribedBoardIds,
  subscribeToBoard,
  unsubscribeFromBoard,
  groupBoardsByType,
  createBoard,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '../../services/boards';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

type RowItem =
  | { kind: 'header'; type: CampusBoardType }
  | { kind: 'board'; board: CampusBoard };

const TYPE_ICON: Record<CampusBoardType, keyof typeof import('@expo/vector-icons').Ionicons.glyphMap> = {
  department: 'school-outline',
  course: 'book-outline',
  topic: 'pricetag-outline',
  anon: 'eye-off-outline',
};

export function BoardsScreen() {
  const injectedNav = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injectedNav ?? fb;
  const { school } = useSchool();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setBoards([]);
      setSubscribed(new Set());
      return;
    }
    const [rows, subs] = await Promise.all([
      listBoards(school.id, 120),
      auth.user?.uid
        ? listSubscribedBoardIds(auth.user.uid, school.id)
        : Promise.resolve([] as string[]),
    ]);
    setBoards(rows);
    setSubscribed(new Set(subs));
  }, [school?.id, auth.user?.uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const q = filter.trim().toLowerCase();
  const visibleBoards = useMemo(
    () =>
      q
        ? boards.filter((b) => `${b.name} ${b.slug ?? ''} ${b.rules ?? ''}`.toLowerCase().includes(q))
        : boards,
    [boards, q],
  );

  const items = useMemo<RowItem[]>(() => {
    const grouped = groupBoardsByType(visibleBoards);
    const order: CampusBoardType[] = ['department', 'course', 'topic', 'anon'];
    const out: RowItem[] = [];
    for (const t of order) {
      const arr = grouped[t];
      if (!arr || arr.length === 0) continue;
      out.push({ kind: 'header', type: t });
      arr.forEach((b) => out.push({ kind: 'board', board: b }));
    }
    return out;
  }, [visibleBoards]);

  const onToggleSubscribe = useCallback(
    async (b: CampusBoard) => {
      const uid = auth.user?.uid;
      const sid = school?.id;
      if (!uid || !sid || isFirebaseMockMode()) {
        if (!uid) Alert.alert('請登入', '登入後即可訂閱看板');
        return;
      }
      const wasSub = subscribed.has(b.id);
      // 樂觀更新
      setSubscribed((prev) => {
        const next = new Set(prev);
        if (wasSub) next.delete(b.id);
        else next.add(b.id);
        return next;
      });
      try {
        if (wasSub) await unsubscribeFromBoard(uid, sid, b.id);
        else await subscribeToBoard(uid, sid, b.id);
      } catch (e: any) {
        Alert.alert('訂閱失敗', e?.message ?? String(e));
        // 還原
        setSubscribed((prev) => {
          const next = new Set(prev);
          if (wasSub) next.add(b.id);
          else next.delete(b.id);
          return next;
        });
      }
    },
    [auth.user?.uid, school?.id, subscribed],
  );

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={theme.colors.muted} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="搜尋看板"
          placeholderTextColor={theme.colors.muted}
          style={styles.searchInput}
        />
        {filter.length > 0 && (
          <Pressable onPress={() => setFilter('')}>
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(it, idx) => (it.kind === 'header' ? `h_${it.type}` : `b_${it.board.id}_${idx}`)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="layers-outline" size={36} color={theme.colors.textSecondary} />
              <Text style={styles.emptyTitle}>{boards.length === 0 ? '尚無任何看板' : '沒有符合條件的看板'}</Text>
              <Text style={styles.emptyDesc}>
                {boards.length === 0
                  ? '請學校管理員到 Firestore `schools/{id}/boards` 加入種子，或點右下按鈕建立新看板。'
                  : '清空搜尋字串再試一次'}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <View style={styles.sectionHeader}>
                  <Ionicons name={TYPE_ICON[item.type]} size={14} color={theme.colors.textSecondary} />
                  <Text style={styles.sectionHeaderTxt}>{CAMPUS_BOARD_TYPE_LABEL[item.type]}</Text>
                </View>
              );
            }
            const b = item.board;
            const isSub = subscribed.has(b.id);
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  nav?.navigate?.('BoardDetail' as never, {
                    boardId: b.id,
                    boardName: b.name,
                    defaultAnonymous: b.defaultAnonymous,
                  })
                }
              >
                {b.coverImage ? (
                  <Image source={{ uri: b.coverImage }} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverFallback]}>
                    <Ionicons name={TYPE_ICON[(b.type ?? 'topic') as CampusBoardType]} size={22} color={theme.colors.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {b.name}
                    </Text>
                    {b.defaultAnonymous ? (
                      <View style={styles.anonChip}>
                        <Ionicons name="eye-off" size={10} color={theme.colors.textSecondary} />
                        <Text style={styles.anonChipTxt}>匿名</Text>
                      </View>
                    ) : null}
                  </View>
                  {b.rules ? (
                    <Text numberOfLines={2} style={styles.rulePreview}>
                      {b.rules}
                    </Text>
                  ) : (
                    <Text style={styles.subtle}>{CAMPUS_BOARD_TYPE_LABEL[(b.type ?? 'topic') as CampusBoardType]}板</Text>
                  )}
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    void onToggleSubscribe(b);
                  }}
                  style={[styles.subBtn, isSub && styles.subBtnOn]}
                >
                  <Ionicons
                    name={isSub ? 'notifications' : 'notifications-outline'}
                    size={14}
                    color={isSub ? theme.colors.onAccent : theme.colors.accent}
                  />
                  <Text style={[styles.subBtnTxt, isSub && { color: theme.colors.onAccent }]}>
                    {isSub ? '已訂閱' : '訂閱'}
                  </Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="建立新看板"
        style={[
          styles.fab,
          { bottom: insets.bottom + TAB_BAR_CONTENT_BOTTOM_PADDING + 16 },
        ]}
        onPress={() => setComposeOpen(true)}
      >
        <Ionicons name="add" size={24} color={theme.colors.onAccent} />
      </Pressable>

      <CreateBoardModal
        visible={composeOpen}
        onDismiss={() => setComposeOpen(false)}
        onCreated={async () => {
          setComposeOpen(false);
          await load();
        }}
      />
    </View>
  );
}

// ─── CreateBoardModal ──────────────────────────────────────

function CreateBoardModal(props: { visible: boolean; onDismiss: () => void; onCreated: () => void }) {
  const auth = useAuth();
  const { school } = useSchool();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampusBoardType>('topic');
  const [rules, setRules] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.visible) {
      setName('');
      setRules('');
      setType('topic');
      setAnon(false);
    }
  }, [props.visible]);

  useEffect(() => {
    setAnon(type === 'anon');
  }, [type]);

  const submit = async () => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || isFirebaseMockMode()) {
      Alert.alert('無法建立', isFirebaseMockMode() ? '模擬模式下無法寫入 Firestore' : '需要登入並選擇學校');
      return;
    }
    if (name.trim().length < 2) {
      Alert.alert('看板名稱', '請至少 2 個字');
      return;
    }
    setBusy(true);
    try {
      await createBoard({
        schoolId: sid,
        name: name.trim(),
        type,
        rules: rules.trim(),
        defaultAnonymous: anon,
        createdBy: uid,
      });
      Alert.alert('已建立', '看板已上架，下拉重新整理即可看到。');
      props.onCreated();
    } catch (e: any) {
      Alert.alert('建立失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="formSheet" onRequestClose={props.onDismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: theme.layout.screenPadding }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>建立看板</Text>
            <Pressable hitSlop={8} onPress={props.onDismiss}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.fieldLabel}>看板名稱</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例：資工系 / 程式甘苦談 / 校隊招新"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            maxLength={32}
          />

          <Text style={styles.fieldLabel}>類型</Text>
          <View style={styles.typeRow}>
            {(['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((t) => {
              const on = type === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.typeChip, on && styles.typeChipOn]}
                >
                  <Ionicons
                    name={TYPE_ICON[t]}
                    size={14}
                    color={on ? theme.colors.onAccent : theme.colors.textSecondary}
                  />
                  <Text style={[styles.typeChipTxt, on && { color: theme.colors.onAccent }]}>
                    {CAMPUS_BOARD_TYPE_LABEL[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>預設匿名發文</Text>
              <Text style={styles.hintMuted}>開啟後此看板的發文預設「匿名」</Text>
            </View>
            <Switch value={anon} onValueChange={setAnon} />
          </View>

          <Text style={styles.fieldLabel}>看板規則（選填）</Text>
          <TextInput
            value={rules}
            onChangeText={setRules}
            placeholder="例：請以友善與尊重為原則，請勿張貼商業廣告。"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={[styles.input, styles.inputMulti]}
            maxLength={400}
          />

          <Pressable
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={submit}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onAccent} />
            ) : (
              <Text style={styles.primaryBtnTxt}>建立看板</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: theme.space.md,
    marginBottom: theme.space.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14, paddingVertical: 0 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginTop: theme.space.md,
  },
  sectionHeaderTxt: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cover: { width: 52, height: 52, borderRadius: theme.radius.sm },
  coverFallback: {
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  anonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  anonChipTxt: { fontSize: 10, color: theme.colors.textSecondary, fontWeight: '700' },
  rulePreview: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4, lineHeight: 16 },
  subtle: { fontSize: 11, color: theme.colors.muted, marginTop: 4 },

  subBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  subBtnOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  subBtnTxt: { color: theme.colors.accent, fontSize: 11, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', padding: 32, gap: 6 },
  emptyTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 15, marginTop: 8 },
  emptyDesc: { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.space.md,
    marginBottom: 6,
  },
  hintMuted: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 14,
  },
  inputMulti: { minHeight: 92, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  typeChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  typeChipTxt: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '700' },

  primaryBtn: {
    marginTop: theme.space.xl,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 16 },
});

export default BoardsScreen;
