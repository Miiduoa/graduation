/**
 * Constellation Screen — 校園星圖
 *
 * 把校園 POI 變成可點亮的星。
 * 區域 = 星座；點亮數 / 該區域全部 = 進度。
 * 季節限定星座只在當季出現。
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

import { getFirebaseApp } from '../firebase';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

type Star = { poiId: string; name: string; lit: boolean; region: string };

const REGIONS = [
  { key: 'academic', label: '教學區' },
  { key: 'dorm', label: '宿舍區' },
  { key: 'sport', label: '運動區' },
  { key: 'food', label: '商業區' },
  { key: 'culture', label: '藝文區' },
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
  if (month >= 3 && month <= 5) return { name: '春櫻座', icon: 'flower-outline' as const, unlocked: true };
  if (month >= 6 && month <= 8) return { name: '夏螢座', icon: 'sunny-outline' as const, unlocked: true };
  if (month >= 9 && month <= 11) return { name: '秋楓座', icon: 'leaf-outline' as const, unlocked: true };
  return { name: '冬燈座', icon: 'snow-outline' as const, unlocked: true };
};

export default function ConstellationScreen() {
  useThemeVersion();
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const litCount = stars.filter((s) => s.lit).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: theme.layout.screenHorizontalPadding,
        paddingTop: theme.space.md,
        paddingBottom: 64,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setTimeout(() => setRefreshing(false), 600);
          }}
          tintColor={theme.colors.accent}
        />
      }
    >
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, fontSize: 26, fontWeight: '700', lineHeight: 33 }}
      >
        校園星圖
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 }}>
        已點亮 {litCount} / {stars.length} 顆星
      </Text>

      {/* ── 季節限定 ── */}
      <View
        style={{
          marginTop: 16,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.goldSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={seasonal.icon} size={22} color={theme.colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
            本季限定：{seasonal.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
            只在這一季出現的星座
          </Text>
        </View>
      </View>

      {/* ── 區域星座 ── */}
      <View
        style={{
          marginTop: 16,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
        }}
      >
        {REGIONS.map((region, idx) => {
          const regionStars = stars.filter((s) => s.region === region.key);
          const litInRegion = regionStars.filter((s) => s.lit).length;
          const unlocked = litInRegion === regionStars.length;
          return (
            <View
              key={region.key}
              style={{
                padding: theme.space.md,
                borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.separator,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  {region.label}
                </Text>
                <Text
                  style={{
                    color: unlocked ? theme.colors.gold : theme.colors.muted,
                    fontSize: 12,
                    fontWeight: unlocked ? '700' : '500',
                  }}
                >
                  {litInRegion} / {regionStars.length}
                  {unlocked ? ' · 已完成' : ''}
                </Text>
              </View>
              <View
                style={{
                  marginTop: 10,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {regionStars.map((s) => (
                  <View
                    key={s.poiId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      backgroundColor: s.lit ? theme.colors.goldSoft : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: s.lit ? theme.colors.gold : theme.colors.border,
                      borderRadius: theme.radius.md,
                    }}
                  >
                    <Ionicons
                      name={s.lit ? 'star' : 'star-outline'}
                      size={12}
                      color={s.lit ? theme.colors.gold : theme.colors.muted}
                    />
                    <Text
                      style={{
                        color: s.lit ? theme.colors.text : theme.colors.muted,
                        fontSize: 12,
                        fontWeight: s.lit ? '600' : '400',
                      }}
                    >
                      {s.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="分享我與這所學校的足跡"
        onPress={() => {
          /* TODO: share */
        }}
        style={({ pressed }) => ({
          marginTop: 20,
          minHeight: 48,
          paddingHorizontal: theme.space.md,
          paddingVertical: 13,
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="share-outline" size={18} color={theme.colors.onAccent} />
        <Text style={{ color: theme.colors.onAccent, fontSize: 15, fontWeight: '700' }}>
          分享「我與這所學校的足跡」
        </Text>
      </Pressable>
    </ScrollView>
  );
}
