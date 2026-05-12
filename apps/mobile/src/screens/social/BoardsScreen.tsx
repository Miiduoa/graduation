/* eslint-disable */
import React, { useCallback, useState } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useSchool } from '../../state/school';
import { isFirebaseMockMode } from '../../firebase';
import { listBoards, type CampusBoard } from '../../services/boards';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

export function BoardsScreen() {
  const injectedNav = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injectedNav ?? fb;
  const { school } = useSchool();
  const insets = useSafeAreaInsets();
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setBoards([]);
      return;
    }
    const rows = await listBoards(school.id, 80);
    setBoards(rows);
  }, [school?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? boards.filter((b) => `${b.name} ${b.slug ?? ''} ${b.rules ?? ''}`.toLowerCase().includes(q))
    : boards;

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>看板</Text>
        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          onPress={() => nav?.navigate?.('PostCompose' as never)}
          style={styles.iconBtn}
        >
          <Ionicons name="create-outline" size={22} color={theme.colors.accent} />
        </Pressable>
      </View>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={theme.colors.muted} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="搜尋看板名稱或說明"
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
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={visible}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', padding: 22 }}>
              {boards.length === 0
                ? '尚無看板。請管理者於 Firestore 各學校 boards 子集合加入種子後重新整理。'
                : '沒有符合的看板'}
            </Text>
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                nav?.navigate?.('BoardDetail' as never, {
                  boardId: item.id,
                  boardName: item.name,
                  defaultAnonymous: item.defaultAnonymous,
                })
              }
            >
              {item.coverImage ? (
                <Image source={{ uri: item.coverImage }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Ionicons name="layers-outline" size={22} color={theme.colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                {item.rules ? (
                  <Text numberOfLines={2} style={styles.rulePreview}>
                    {item.rules}
                  </Text>
                ) : (
                  <Text style={styles.subtle}>{item.type ?? 'topic'}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.border} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14, paddingVertical: 0 },
  iconBtn: {
    padding: 6,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
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
  cover: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.sm,
  },
  coverFallback: {
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  rulePreview: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  subtle: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
});

export default BoardsScreen;
