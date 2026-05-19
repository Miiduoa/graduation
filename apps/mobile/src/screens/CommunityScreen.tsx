/* eslint-disable */
/**
 * 校園社群 — Shell
 *
 * 變更（vs. 舊版）：
 *  - 頂端標題與分頁列重新排版，加上「校園漫步」icon shortcut（縮小、不再霸佔整面）
 *  - 分頁 icon 與舊版一致，但採用 pill underline 視覺，contained badge 顯示活躍計數（之後可接事件匯流）
 *  - 仍支援 route.params.initialTab（含 social/pulse 別名）
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

import { HomeFeedScreen } from './social/HomeFeedScreen';
import { BoardsScreen } from './social/BoardsScreen';
import { RealtimeSocialScreen } from './social/RealtimeSocialScreen';
import { StudyBuddyPanel } from './community/StudyBuddyPanel';
import { CampusSocialNavProvider } from './social/CampusSocialNavContext';

type TabKey = 'feed' | 'boards' | 'realtime' | 'buddy';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'feed', label: '動態', icon: 'sparkles-outline' },
  { key: 'boards', label: '看板', icon: 'grid-outline' },
  { key: 'realtime', label: '即時', icon: 'flash-outline' },
  { key: 'buddy', label: '學伴', icon: 'people-outline' },
];

const LEGACY_TAB: Record<string, TabKey> = {
  social: 'feed',
  pulse: 'realtime',
};

export function CommunityScreen(props: Record<string, unknown>) {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('feed');
  const stackNav = (props as any)?.navigation;

  const route = (props as any)?.route;
  const rawInitial = route?.params?.initialTab as string | undefined;
  const initialTab: TabKey | undefined = rawInitial
    ? (LEGACY_TAB[rawInitial] ?? (rawInitial as TabKey))
    : undefined;
  useEffect(() => {
    if (initialTab && TABS.some((t) => t.key === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* ─── Top bar：title + 漫步 shortcut ─── */}
      <View
        style={{
          paddingTop: insets.top + theme.space.sm,
          paddingBottom: theme.space.sm,
          paddingHorizontal: 14,
          backgroundColor: theme.colors.bg,
        }}
      >
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>校園社群</Text>
            <Text style={styles.headingSub}>動態 · 看板 · 即時 · 學伴</Text>
          </View>
          <Pressable
            onPress={() => stackNav?.navigate?.('CampusGame')}
            accessibilityRole="button"
            accessibilityLabel="校園漫步"
            style={({ pressed }) => [styles.iconShortcut, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="game-controller-outline" size={20} color={theme.colors.accent} />
          </Pressable>
        </View>

        {/* ─── Tab pills ─── */}
        <View style={styles.tabRow}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Ionicons
                  name={tab.icon}
                  size={15}
                  color={active ? theme.colors.onAccent : theme.colors.textSecondary}
                />
                <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ─── Content ─── */}
      <CampusSocialNavProvider navigation={stackNav}>
        <View style={{ flex: 1 }}>
          {activeTab === 'feed' && <HomeFeedScreen />}
          {activeTab === 'boards' && <BoardsScreen />}
          {activeTab === 'realtime' && <RealtimeSocialScreen />}
          {activeTab === 'buddy' && <StudyBuddyPanel />}
        </View>
      </CampusSocialNavProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.space.md },
  heading: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
  headingSub: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2, letterSpacing: 0.4 },
  iconShortcut: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.accentSoft ?? 'rgba(124,93,250,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  tabRow: { flexDirection: 'row', gap: 6, backgroundColor: theme.colors.surface, padding: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabActive: { backgroundColor: theme.colors.accent },
  tabTxt: { fontSize: 13, color: theme.colors.textSecondary, fontWeight: '600' },
  tabTxtActive: { color: theme.colors.onAccent, fontWeight: '700' },
});

export default CommunityScreen;
