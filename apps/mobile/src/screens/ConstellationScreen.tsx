/**
 * Constellation Screen — 校園星圖
 *
 * 把校園 POI 變成可點亮的星。
 * 區域 = 星座；點亮數 / 該區域全部 = 進度。
 * 季節限定星座只在當季出現。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

import { getFirebaseApp } from '../firebase';

type Star = { poiId: string; name: string; lit: boolean; region: string };

const REGIONS = [
  { key: 'academic', label: '🏫 教學區', emoji: '⭐' },
  { key: 'dorm', label: '🛏️ 宿舍區', emoji: '🌟' },
  { key: 'sport', label: '⚽ 運動區', emoji: '✨' },
  { key: 'food', label: '🍱 商業區', emoji: '💫' },
  { key: 'culture', label: '🎭 藝文區', emoji: '🌠' },
];

const SAMPLE_STARS: Star[] = [
  { poiId: 'd_block', name: 'D 棟教學', lit: true, region: 'academic' },
  { poiId: 'a_block', name: 'A 棟行政', lit: true, region: 'academic' },
  { poiId: 'library', name: '圖書館', lit: true, region: 'academic' },
  { poiId: 'c_block', name: 'C 棟工程', lit: false, region: 'academic' },
  { poiId: 'dorm_male', name: '男生宿舍', lit: true, region: 'dorm' },
  { poiId: 'dorm_female', name: '女生宿舍', lit: false, region: 'dorm' },
  { poiId: 'gym', name: '體育館', lit: false, region: 'sport' },
  { poiId: 'track', name: '田徑場', lit: true, region: 'sport' },
  { poiId: 'cafeteria_1', name: '第一餐廳', lit: true, region: 'food' },
  { poiId: 'cafeteria_2', name: '第二餐廳', lit: true, region: 'food' },
  { poiId: 'auditorium', name: '靜思堂', lit: false, region: 'culture' },
];

const SEASONAL = (month: number) => {
  if (month >= 3 && month <= 5) return { name: '春櫻座', emoji: '🌸', unlocked: true };
  if (month >= 6 && month <= 8) return { name: '夏螢座', emoji: '🪲', unlocked: true };
  if (month >= 9 && month <= 11) return { name: '秋楓座', emoji: '🍁', unlocked: true };
  return { name: '冬燈座', emoji: '🏮', unlocked: true };
};

export default function ConstellationScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stars, setStars] = useState<Star[]>(SAMPLE_STARS);
  const month = useMemo(() => new Date().getMonth() + 1, []);
  const seasonal = useMemo(() => SEASONAL(month), [month]);

  useEffect(() => {
    (async () => {
      try {
        const app = getFirebaseApp();
        const db = getFirestore(app);
        const uid = (app as unknown as { auth?: { currentUser?: { uid?: string } } }).auth?.currentUser?.uid;
        if (uid) {
          const snap = await getDoc(doc(db, 'users', uid, 'companion', 'lifetime'));
          const visited = new Set<string>(
            Array.isArray(snap.data()?.distinctPoiIds) ? snap.data()!.distinctPoiIds : [],
          );
          if (visited.size > 0) {
            setStars((s) => s.map((x) => ({ ...x, lit: visited.has(x.poiId) || x.lit })));
          }
        }
      } catch {
        /* fallback to sample */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const litCount = stars.filter((s) => s.lit).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#0f172a' }}
      contentContainerStyle={{ padding: 16, paddingBottom: 64 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setTimeout(() => setRefreshing(false), 600);
          }}
          tintColor="#fbbf24"
        />
      }
    >
      <Text style={{ color: '#fbbf24', fontSize: 28, fontWeight: '700' }}>校園星圖</Text>
      <Text style={{ color: '#E5E5EA', marginTop: 4 }}>
        已點亮 {litCount} / {stars.length} 顆星
      </Text>

      {/* ── 季節限定 ── */}
      <View
        style={{
          marginTop: 16,
          backgroundColor: '#1e293b',
          borderRadius: 12,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 48 }}>{seasonal.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>本季限定：{seasonal.name}</Text>
          <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
            只在這一季出現的星座 ✨
          </Text>
        </View>
      </View>

      {/* ── 區域星座 ── */}
      {REGIONS.map((region) => {
        const regionStars = stars.filter((s) => s.region === region.key);
        const litInRegion = regionStars.filter((s) => s.lit).length;
        const unlocked = litInRegion === regionStars.length;
        return (
          <View key={region.key} style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#f1f5f9', fontSize: 16, fontWeight: '600' }}>
                {region.label}
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                {litInRegion} / {regionStars.length} {unlocked ? '⭐ 完成' : ''}
              </Text>
            </View>
            <View
              style={{
                marginTop: 8,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                padding: 12,
                backgroundColor: unlocked ? '#1e3a5f' : '#1e293b',
                borderRadius: 12,
              }}
            >
              {regionStars.map((s) => (
                <View
                  key={s.poiId}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: s.lit ? '#fbbf24' : '#334155',
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: s.lit ? '#0f172a' : '#94a3b8', fontSize: 12 }}>
                    {s.lit ? region.emoji : '·'} {s.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}

      <Pressable
        onPress={() => {
          /* TODO: share */
        }}
        style={{
          marginTop: 24,
          padding: 14,
          backgroundColor: '#fbbf24',
          borderRadius: 12,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '700' }}>
          📤 分享「我與這所學校的足跡」
        </Text>
      </Pressable>
    </ScrollView>
  );
}
