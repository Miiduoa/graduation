/**
 * Campus Companion 主畫面
 *
 * 顯示：
 *  - 精靈當前狀態（外型 / 季節 / 氣象 / vitality）
 *  - 4 個需求進度條（學/動/食/友）
 *  - careHint 卡片（精靈用關心語氣說話）
 *  - 學習花園預覽（橫向 carousel）
 *  - 最近解鎖的 3 個成就
 *  - 風險雷達警示（若有 critical）
 *
 * 資料來源：後端 callable `computeCompanionState` + 本機 cache。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

import { getCloudFunctionRegion, getFirebaseApp } from '../firebase';
import { getFunctions } from 'firebase/functions';
import type {
  SpriteState,
  GardenSummary,
  Plant,
  Unlockable,
} from '@campus/shared';

type CompanionPayload = {
  sprite: SpriteState;
  garden: GardenSummary;
};

export default function CompanionScreen({ navigation }: { navigation?: { navigate: (s: string, p?: unknown) => void } }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<CompanionPayload | null>(null);
  const [recentUnlocks, setRecentUnlocks] = useState<Unlockable[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setError(null);
    try {
      const app = getFirebaseApp();
      const functions = getFunctions(app, getCloudFunctionRegion());
      const callable = httpsCallable<{ days?: number }, CompanionPayload & { success: boolean }>(
        functions,
        'computeCompanionState',
      );
      const res = await callable({ days: 7 });
      if ((res.data as { success?: boolean })?.success) {
        setData({ sprite: res.data.sprite, garden: res.data.garden });
      }

      // 拉最近解鎖
      const db = getFirestore(app);
      const auth = app.options.projectId ? null : null;
      const uid = (app as unknown as { auth?: { currentUser?: { uid?: string } } }).auth?.currentUser?.uid;
      if (uid) {
        const ref = doc(db, 'users', uid, 'companion', 'unlocks');
        const snap = await getDoc(ref);
        const latest = (snap.data()?.latest as Unlockable[] | undefined) ?? [];
        setRecentUnlocks(latest.slice(0, 3));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, color: '#6b7280' }}>正在喚醒你的校園精靈⋯⋯</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, color: '#dc2626' }}>無法載入精靈狀態</Text>
        {error && <Text style={{ marginTop: 8, color: '#6b7280' }}>{error}</Text>}
        <Pressable
          onPress={() => {
            setLoading(true);
            fetch();
          }}
          style={{ marginTop: 16, padding: 12, backgroundColor: '#1F4E78', borderRadius: 8 }}
        >
          <Text style={{ color: '#fff', textAlign: 'center' }}>重試</Text>
        </Pressable>
      </View>
    );
  }

  const sprite = data.sprite;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      contentContainerStyle={{ padding: 16, paddingBottom: 64 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetch();
          }}
        />
      }
    >
      {/* ── 精靈頭像區 ── */}
      <SpriteHeader sprite={sprite} />

      {/* ── careHint ── */}
      {sprite.careHint.kind !== 'none' && (
        <CareHintCard
          hint={sprite.careHint}
          onPress={() => {
            if (sprite.careHint.ctaTarget && navigation) {
              navigation.navigate(deepLinkForCareHint(sprite.careHint.ctaTarget));
            }
          }}
        />
      )}

      {/* ── 4 需求 ── */}
      <Section title="今日精靈四象">
        <NeedBar label="學" value={sprite.needs.study} color="#6366F1" />
        <NeedBar label="動" value={sprite.needs.move} color="#10B981" />
        <NeedBar label="食" value={sprite.needs.nourish} color="#F59E0B" />
        <NeedBar label="友" value={sprite.needs.social} color="#EF4444" />
      </Section>

      {/* ── 花園預覽 ── */}
      <Section title={`學習花園・${data.garden.plants.length} 株植物`}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {data.garden.plants.map((p) => (
            <PlantCard
              key={p.courseId}
              plant={p}
              onPress={() =>
                navigation?.navigate('CourseHub', { courseSpaceId: p.courseId })
              }
            />
          ))}
          {data.garden.plants.length === 0 && (
            <Text style={{ color: '#6b7280', padding: 12 }}>
              還沒有植物，先選一門課讓花園開始長出來。
            </Text>
          )}
        </ScrollView>
      </Section>

      {/* ── 最近解鎖 ── */}
      <Section title="最近解鎖">
        {recentUnlocks.length === 0 ? (
          <Text style={{ color: '#6b7280' }}>還沒有新解鎖，繼續使用 APP 就會出現 ✨</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recentUnlocks.map((u) => (
              <UnlockChip key={u.id} unlock={u} />
            ))}
          </View>
        )}
      </Section>

      {/* ── 入口列 ── */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <NavButton label="🌌 星圖" onPress={() => navigation?.navigate('Constellation')} />
        <NavButton label="🧺 收藏" onPress={() => navigation?.navigate('CompanionCollection')} />
        <NavButton label="📊 風險雷達" onPress={() => navigation?.navigate('LearningAnalytics')} />
      </View>
    </ScrollView>
  );
}

function deepLinkForCareHint(target: string): string {
  switch (target) {
    case 'cafeteria':
      return 'Cafeteria';
    case 'map':
      return 'Map';
    case 'groups':
      return 'Groups';
    case 'office_hours':
      return 'CourseHub';
    case 'counseling':
      return 'Health';
    default:
      return 'CompanionScreen';
  }
}

// ──────────────────────────────────────────────
// Sub components
// ──────────────────────────────────────────────

function SpriteHeader({ sprite }: { sprite: SpriteState }) {
  const stageEmoji =
    sprite.evolutionStage === 'egg'
      ? '🥚'
      : sprite.evolutionStage === 'sprout'
      ? '🌱'
      : sprite.evolutionStage === 'fledgling'
      ? '🐣'
      : sprite.evolutionStage === 'companion'
      ? '🦝'
      : '🦊';
  const weatherEmoji =
    sprite.appearance.weatherMood === 'sunny'
      ? '☀️'
      : sprite.appearance.weatherMood === 'cloudy'
      ? '☁️'
      : sprite.appearance.weatherMood === 'rainy'
      ? '🌧️'
      : sprite.appearance.weatherMood === 'snowy'
      ? '❄️'
      : '✨';

  return (
    <View
      style={{
        backgroundColor: '#1F4E78',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Text style={{ fontSize: 72 }}>{stageEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>
            {sprite.evolutionStage} ・ {weatherEmoji} {sprite.appearance.season}
          </Text>
          <Text style={{ color: '#dbeafe', fontSize: 14, marginTop: 4 }}>
            裝飾：{sprite.appearance.seasonalAccessory}
          </Text>
          <View
            style={{
              marginTop: 12,
              backgroundColor: '#1e3a5f',
              borderRadius: 8,
              padding: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>vitality {sprite.vitality} / 100</Text>
            <View
              style={{
                height: 6,
                backgroundColor: '#3b5b87',
                marginTop: 4,
                borderRadius: 3,
              }}
            >
              <View
                style={{
                  height: 6,
                  width: `${sprite.vitality}%`,
                  backgroundColor: '#fbbf24',
                  borderRadius: 3,
                }}
              />
            </View>
          </View>
        </View>
      </View>
      {sprite.message && (
        <Text style={{ color: '#fef3c7', fontSize: 13, marginTop: 12, fontStyle: 'italic' }}>
          {sprite.message}
        </Text>
      )}
    </View>
  );
}

function CareHintCard({
  hint,
  onPress,
}: {
  hint: SpriteState['careHint'];
  onPress: () => void;
}) {
  const bg =
    hint.kind === 'rest'
      ? '#FEF3C7'
      : hint.kind === 'meal'
      ? '#FED7AA'
      : hint.kind === 'social'
      ? '#FECACA'
      : '#D1FAE5';
  const icon =
    hint.kind === 'rest'
      ? '🌙'
      : hint.kind === 'meal'
      ? '🍱'
      : hint.kind === 'social'
      ? '👯'
      : '🎉';
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: bg,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        flexDirection: 'row',
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: '#111827' }}>{hint.text}</Text>
        {hint.ctaTarget && (
          <Text style={{ fontSize: 12, color: '#1F4E78', marginTop: 6, fontWeight: '600' }}>
            ▶ 點此前往
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#111827' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function NeedBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, color: '#374151' }}>{label}</Text>
        <Text style={{ fontSize: 13, color: '#6b7280' }}>{value}</Text>
      </View>
      <View
        style={{
          height: 8,
          backgroundColor: '#e5e7eb',
          borderRadius: 4,
          marginTop: 4,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: 8,
            width: `${value}%`,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

function PlantCard({ plant, onPress }: { plant: Plant; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 120,
        marginRight: 12,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 48 }}>{plant.emoji}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 4 }} numberOfLines={1}>
        {plant.courseName}
      </Text>
      <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{plant.stage}</Text>
      <View
        style={{
          height: 4,
          backgroundColor: '#e5e7eb',
          borderRadius: 2,
          width: '100%',
          marginTop: 6,
        }}
      >
        <View
          style={{
            height: 4,
            width: `${plant.growth}%`,
            backgroundColor: plant.health < 50 ? '#dc2626' : '#10B981',
            borderRadius: 2,
          }}
        />
      </View>
      {plant.harvestable && (
        <Text style={{ fontSize: 10, color: '#16a34a', marginTop: 4 }}>🧺 可採收</Text>
      )}
    </Pressable>
  );
}

function UnlockChip({ unlock }: { unlock: Unlockable }) {
  return (
    <View
      style={{
        backgroundColor: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: '#e5e7eb',
      }}
    >
      <Text style={{ fontSize: 16 }}>{unlock.emoji}</Text>
      <Text style={{ fontSize: 12, color: '#111827' }}>{unlock.label}</Text>
    </View>
  );
}

function NavButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 12,
        backgroundColor: '#fff',
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
      }}
    >
      <Text style={{ fontSize: 13, color: '#111827', fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
