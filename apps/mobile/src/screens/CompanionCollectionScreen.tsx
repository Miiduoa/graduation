import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { ACHIEVEMENTS, evaluateAchievements, type Unlockable } from '@campus/shared';
import { useAuth } from '../state/auth';
import { getFirebaseApp } from '../firebase';
import { getLocalState } from '../services/companionLocalStore';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

const TABS: Array<{ key: Unlockable['domain']; label: string }> = [
  { key: 'study', label: '學習' },
  { key: 'library', label: '圖書館' },
  { key: 'cafeteria', label: '餐廳' },
  { key: 'campus_explore', label: '校園探索' },
  { key: 'transport', label: '交通' },
  { key: 'social', label: '社交' },
  { key: 'health', label: '健康' },
  { key: 'dorm', label: '宿舍' },
  { key: 'event', label: '活動' },
  { key: 'lifecycle', label: '生涯' },
  { key: 'system', label: '系統' },
];

type CollectionState =
  | { scope: string; status: 'loading' | 'error' }
  | { scope: string; status: 'ready'; progress: Record<string, number>; unlocked: Set<string> };

function progressPercent(current: number, threshold: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(threshold) || threshold <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / threshold) * 100)));
}

export default function CompanionCollectionScreen() {
  useThemeVersion();
  const bottom = useTabBarContentBottomPadding();
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const schoolId = auth.profile?.uid === uid ? auth.profile?.schoolId ?? null : null;
  const scope = JSON.stringify([uid, schoolId]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const [activeTab, setActiveTab] = useState<Unlockable['domain']>('study');
  const [state, setState] = useState<CollectionState>({ scope, status: 'loading' });

  const load = useCallback(async () => {
    const request = ++generation.current;
    const isCurrent = () => generation.current === request && activeScope.current === scope;
    setState({ scope, status: 'loading' });
    try {
      const local = await getLocalState();
      if (!isCurrent()) return;
      setState({
        scope,
        status: 'ready',
        progress: local.lifetime,
        unlocked: new Set(local.unlocks),
      });

      // Authenticated cloud data is an optional addition to device activity.
      if (!uid) return;
      try {
        const db = getFirestore(getFirebaseApp());
        const [lifetimeDoc, unlocksDoc] = await Promise.all([
          getDoc(doc(db, 'users', uid, 'companion', 'lifetime')),
          getDoc(doc(db, 'users', uid, 'companion', 'unlocks')),
        ]);
        if (!isCurrent()) return;
        const cloudProgress = lifetimeDoc.data();
        const cloudUnlocks = unlocksDoc.data()?.ids;
        setState((previous) => {
          if (previous.scope !== scope || previous.status !== 'ready') return previous;
          const progress = { ...previous.progress };
          if (cloudProgress) {
            for (const [key, value] of Object.entries(cloudProgress)) {
              if (typeof value === 'number' && Number.isFinite(value)) progress[key] = value;
            }
          }
          const unlocked = new Set(previous.unlocked);
          if (Array.isArray(cloudUnlocks)) {
            cloudUnlocks.forEach((id: unknown) => { if (typeof id === 'string') unlocked.add(id); });
          }
          return { ...previous, progress, unlocked };
        });
      } catch {
        // Device progress remains available when school services are offline.
      }
    } catch {
      if (isCurrent()) setState({ scope, status: 'error' });
    }
  }, [scope, uid]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const current = state.scope === scope ? state : null;
  const ready = current?.status === 'ready' ? current : null;
  const progress = ready?.progress ?? {};
  const unlocked = ready?.unlocked ?? new Set<string>();
  const visible = useMemo(() => ACHIEVEMENTS.filter((entry) => entry.unlock.domain === activeTab), [activeTab]);
  const completed = visible.filter((entry) => unlocked.has(entry.id)).length;
  const total = ACHIEVEMENTS.filter((entry) => unlocked.has(entry.id)).length;
  const upcoming = visible
    .filter((entry) => !unlocked.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      label: entry.unlock.label,
      pct: progressPercent(Number(progress[entry.signal] ?? 0), entry.threshold),
    }))
    .filter((entry) => entry.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  return (
    <View testID="companion-collection-screen" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ paddingHorizontal: theme.layout.screenPadding, paddingVertical: 20, gap: 5 }}>
        <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700', color: theme.colors.text }}>
          我的收藏
        </Text>
        <Text style={{ color: theme.colors.muted }}>
          這台裝置及已連結帳號的解鎖紀錄 · {total} / {ACHIEVEMENTS.length}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
        contentContainerStyle={{ paddingHorizontal: theme.layout.screenPadding, paddingVertical: 10, gap: 8 }}
      >
        {TABS.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab.key)}
              style={{
                minHeight: 42,
                paddingHorizontal: 15,
                borderRadius: 9,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.colors.accent : theme.colors.surface,
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent : theme.colors.border,
              }}
            >
              <Text style={{ fontWeight: '600', color: selected ? theme.colors.onAccent : theme.colors.text }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!current || current.status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={theme.colors.accent} accessibilityLabel="讀取收藏" />
          <Text style={{ color: theme.colors.muted }}>正在讀取收藏紀錄…</Text>
        </View>
      ) : current.status === 'error' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.text, fontSize: 17, fontWeight: '600' }}>
            無法讀取收藏紀錄
          </Text>
          <Text style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 22 }}>
            這台裝置的紀錄暫時無法開啟，請再試一次。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新讀取收藏"
            onPress={() => void load()}
            style={{ paddingVertical: 13, paddingHorizontal: 24, backgroundColor: theme.colors.accent, borderRadius: 10 }}
          >
            <Text style={{ color: theme.colors.onAccent, fontWeight: '600' }}>重新讀取</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          testID="companion-collection"
          contentContainerStyle={{ paddingHorizontal: theme.layout.screenPadding, paddingTop: 18, paddingBottom: bottom + 24, gap: 12 }}
        >
          <Text style={{ color: theme.colors.muted }}>
            {TABS.find((tab) => tab.key === activeTab)?.label} · 已解鎖 {completed} / {visible.length}
          </Text>
          {visible.length ? visible.map((entry) => {
            const has = unlocked.has(entry.id);
            const amount = Math.max(0, Number(progress[entry.signal] ?? 0) || 0);
            const pct = has ? 100 : progressPercent(amount, entry.threshold);
            return (
              <View
                key={entry.id}
                style={{
                  padding: 16,
                  gap: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  backgroundColor: theme.colors.surface,
                  borderColor: has ? theme.colors.gold : theme.colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 32, opacity: has ? 1 : 0.65 }}>{entry.unlock.emoji}</Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>
                      {entry.unlock.label}
                    </Text>
                    <Text style={{ color: theme.colors.muted, lineHeight: 19, fontSize: 13 }}>
                      {entry.description}
                    </Text>
                  </View>
                  {has ? <Text style={{ color: theme.colors.gold, fontSize: 12, fontWeight: '700' }}>已解鎖</Text> : null}
                </View>
                {!has ? (
                  <View style={{ gap: 5 }}>
                    <View style={{ height: 6, borderRadius: 8, backgroundColor: theme.colors.border, overflow: 'hidden', flexDirection: 'row' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
                      <View style={{ flex: pct / 100, backgroundColor: theme.colors.accent }} />
                      <View style={{ flex: 1 - pct / 100 }} />
                    </View>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      進度 {amount} / {entry.threshold}（{pct}%）
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          }) : (
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              這個分類目前沒有成就項目。
            </Text>
          )}
          {upcoming.length ? (
            <View style={{ padding: 15, borderRadius: 12, backgroundColor: theme.colors.goldSoft, gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>這個分類接近解鎖</Text>
              {upcoming.map((entry) => (
                <Text key={entry.id} style={{ color: theme.colors.textSecondary }}>
                  {entry.label} · {entry.pct}%
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
