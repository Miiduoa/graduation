import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { GardenSummary, Plant, SpriteState, Unlockable } from '@campus/shared';
import { useAuth } from '../state/auth';
import { computeLocalCompanion } from '../services/companionLocalStore';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { safeNavigate } from '../utils/safeNavigate';

type Navigation = {
  navigate?: (...args: any[]) => void;
  getState?: () => unknown;
  getParent?: () => unknown;
};
type CompanionData = { sprite: SpriteState; garden: GardenSummary; unlocks: Unlockable[] };
type CompanionState =
  | { scope: string; status: 'loading' }
  | { scope: string; status: 'error' }
  | { scope: string; status: 'ready'; data: CompanionData };

const stageNames: Record<string, string> = {
  egg: '剛開始',
  sprout: '萌芽中',
  fledgling: '成長中',
  companion: '校園夥伴',
};
const weatherIcons: Record<string, string> = {
  sunny: '☀️',
  cloudy: '☁️',
  rainy: '🌧️',
  snowy: '❄️',
};

function percent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function careRoute(target: string | undefined): string | null {
  switch (target) {
    case 'cafeteria': return 'Cafeteria';
    case 'map': return 'Map';
    case 'groups': return 'Groups';
    case 'office_hours': return 'LearnHome';
    case 'counseling': return 'Health';
    default: return null;
  }
}

export default function CompanionScreen({ navigation }: { navigation?: Navigation }) {
  useThemeVersion();
  const bottom = useTabBarContentBottomPadding();
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const schoolId = auth.profile?.uid === uid ? auth.profile?.schoolId ?? null : null;
  const scope = JSON.stringify([uid, schoolId]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<CompanionState>({ scope, status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pull = false) => {
    const request = ++generation.current;
    const isCurrent = () => generation.current === request && activeScope.current === scope;
    if (pull) setRefreshing(true);
    else setState({ scope, status: 'loading' });

    try {
      const local = await computeLocalCompanion({ schoolId: schoolId ?? undefined });
      if (!isCurrent()) return;
      setState({ scope, status: 'ready', data: local });

      // Local content is usable without school SSO. A cloud failure never blocks it.
      if (uid) {
        void (async () => {
          try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const { getFirebaseApp, getCloudFunctionRegion } = await import('../firebase');
            if (!isCurrent()) return;
            const callable = httpsCallable<{ days?: number }, {
              success: boolean;
              sprite: SpriteState;
              garden: GardenSummary;
            }>(getFunctions(getFirebaseApp(), getCloudFunctionRegion()), 'computeCompanionState');
            const result = await callable({ days: 7 });
            if (!isCurrent() || !result.data.success || !result.data.sprite || !result.data.garden) return;
            setState((previous) => (
              previous.scope === scope && previous.status === 'ready'
                ? { ...previous, data: { ...previous.data, sprite: result.data.sprite, garden: result.data.garden } }
                : previous
            ));
          } catch {
            // School cloud data is optional; the local view remains available.
          }
        })();
      }
    } catch {
      if (isCurrent()) setState({ scope, status: 'error' });
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, [uid, schoolId, scope]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const current = state.scope === scope ? state : null;
  const open = (route: string, params?: Record<string, unknown>) =>
    safeNavigate(navigation, route, params);
  const page = { flex: 1, backgroundColor: theme.colors.bg };
  const card = {
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.space.md,
    gap: 12,
  } as const;

  if (!current || current.status === 'loading') {
    return (
      <View style={[page, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <ActivityIndicator color={theme.colors.accent} accessibilityLabel="讀取校園精靈" />
        <Text style={{ color: theme.colors.muted }}>正在整理這台裝置的校園紀錄…</Text>
      </View>
    );
  }

  if (current.status === 'error') {
    return (
      <View style={[page, { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }]}>
        <Text accessibilityRole="alert" style={{ color: theme.colors.text, fontSize: 18, fontWeight: '600' }}>
          暫時無法讀取校園精靈
        </Text>
        <Text style={{ color: theme.colors.muted, lineHeight: 22, textAlign: 'center' }}>
          裝置紀錄載入失敗，資料不會因此被清除。
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重試讀取校園精靈"
          onPress={() => void load()}
          style={{ backgroundColor: theme.colors.accent, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 24 }}
        >
          <Text style={{ color: theme.colors.onAccent, fontWeight: '600' }}>重新讀取</Text>
        </Pressable>
      </View>
    );
  }

  const { sprite, garden, unlocks } = current.data;
  const destination = careRoute(sprite.careHint.ctaTarget);
  const needRows = [
    { key: 'study', label: '學習', value: sprite.needs.study, color: theme.colors.accent },
    { key: 'move', label: '活動', value: sprite.needs.move, color: theme.colors.info },
    { key: 'nourish', label: '飲食', value: sprite.needs.nourish, color: theme.colors.gold },
    { key: 'social', label: '社交', value: sprite.needs.social, color: theme.colors.social },
  ];

  return (
    <ScrollView
      testID="companion-screen"
      style={page}
      contentContainerStyle={{ paddingHorizontal: theme.layout.screenPadding, paddingTop: 16, paddingBottom: bottom + 24, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.accent} />}
    >
      <View style={{ gap: 5 }}>
        <Text accessibilityRole="header" style={{ fontSize: 25, fontWeight: '700', color: theme.colors.text }}>
          校園精靈
        </Text>
        <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
          從每天的校園活動慢慢累積，不需要特別打卡。
        </Text>
      </View>

      <View style={[card, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentSoft }]}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Text accessible accessibilityLabel="校園精靈" style={{ fontSize: 57 }}>
            {sprite.evolutionStage === 'egg' ? '🥚' : sprite.evolutionStage === 'sprout' ? '🌱' : sprite.evolutionStage === 'fledgling' ? '🐣' : sprite.evolutionStage === 'companion' ? '🦝' : '🦊'}
          </Text>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 19 }}>
              {stageNames[sprite.evolutionStage] ?? '持續成長中'}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
              {(weatherIcons[sprite.appearance.weatherMood] ?? '✨') + ' ' + sprite.appearance.season}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
              活力 {percent(sprite.vitality)} / 100
            </Text>
          </View>
        </View>
        <Progress value={sprite.vitality} color={theme.colors.accent} />
        {sprite.message ? (
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>{sprite.message}</Text>
        ) : null}
      </View>

      {sprite.careHint.kind !== 'none' ? (
        <View style={[card, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>給你的建議</Text>
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>{sprite.careHint.text}</Text>
          {destination ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="依建議前往相關服務"
              onPress={() => open(destination)}
              style={{ alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: theme.colors.accentSoft, borderRadius: 8 }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>前往相關服務 ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={card}>
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
          生活節奏
        </Text>
        {needRows.map((item) => (
          <View key={item.key} style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textSecondary }}>{item.label}</Text>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{percent(item.value)}</Text>
            </View>
            <Progress value={item.value} color={item.color} />
          </View>
        ))}
      </View>

      <View style={card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
            學習花園
          </Text>
          <Text style={{ color: theme.colors.muted }}>{garden.plants.length} 株</Text>
        </View>
        {garden.plants.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {garden.plants.map((plant) => (
              <PlantTile
                key={plant.courseId}
                plant={plant}
                onPress={() => open('CourseHub', { courseSpaceId: plant.courseId, groupId: plant.courseId, section: 'week' })}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>目前還沒有課程紀錄，可以先從課程頁開始。</Text>
            <ActionButton label="查看我的課程" onPress={() => open('LearnHome')} />
          </View>
        )}
      </View>

      <View style={card}>
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
          最近解鎖
        </Text>
        {unlocks.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {unlocks.slice(-3).reverse().map((unlock) => (
              <View key={unlock.id} style={{ backgroundColor: theme.colors.goldSoft, padding: 10, borderRadius: 10 }}>
                <Text style={{ color: theme.colors.text }}>{unlock.emoji + ' ' + unlock.label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: theme.colors.muted }}>尚未解鎖成就，活動紀錄增加後會出現在這裡。</Text>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <ActionButton label="我的收藏" onPress={() => open('CompanionCollection')} />
        <ActionButton label="校園星圖" onPress={() => open('Constellation')} />
        <ActionButton label="學習狀態" onPress={() => open('LearningAnalytics')} />
      </View>

      <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: 'center' }}>
        先顯示這台裝置的活動紀錄，雲端資料依登入與服務可用狀態更新。
      </Text>
    </ScrollView>
  );
}

function Progress({ value, color }: { value: number; color: string }) {
  const ratio = percent(value) / 100;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent(value) }}
      style={{ height: 7, backgroundColor: theme.colors.border, borderRadius: 10, overflow: 'hidden', flexDirection: 'row' }}
    >
      <View style={{ flex: ratio, backgroundColor: color }} />
      <View style={{ flex: 1 - ratio }} />
    </View>
  );
}

function PlantTile({ plant, onPress }: { plant: Plant; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'開啟課程 ' + plant.courseName}
      onPress={onPress}
      style={{ width: 145, minHeight: 142, backgroundColor: theme.colors.surfaceMuted, borderRadius: 12, padding: 14, gap: 8, alignItems: 'center' }}
    >
      <Text style={{ fontSize: 37 }}>{plant.emoji}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' }} numberOfLines={2}>
        {plant.courseName}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{plant.stage}</Text>
      <View style={{ alignSelf: 'stretch' }}>
        <Progress value={plant.growth} color={plant.health < 50 ? theme.colors.warning : theme.colors.success} />
      </View>
    </Pressable>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 46,
        paddingHorizontal: 18,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
