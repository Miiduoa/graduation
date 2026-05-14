/**
 * Campus Companion · Collection
 *
 * 列出全部 22 個成就，依 domain 分頁，顯示已解鎖 / 進度條。
 * 資料來源：users/{uid}/companion/{lifetime,unlocks}
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View, Pressable, ActivityIndicator } from 'react-native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

import { getFirebaseApp } from '../firebase';
import { ACHIEVEMENTS, evaluateAchievements, type Unlockable } from '@campus/shared';

const DOMAIN_TABS: Array<{ key: Unlockable['domain']; label: string }> = [
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

export default function CompanionCollectionScreen() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Unlockable['domain']>('study');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const app = getFirebaseApp();
        const db = getFirestore(app);
        const uid = (app as unknown as { auth?: { currentUser?: { uid?: string } } }).auth?.currentUser?.uid;
        if (uid) {
          const [lifetimeSnap, unlocksSnap] = await Promise.all([
            getDoc(doc(db, 'users', uid, 'companion', 'lifetime')),
            getDoc(doc(db, 'users', uid, 'companion', 'unlocks')),
          ]);
          setProgress((lifetimeSnap.data() as Record<string, number>) ?? {});
          setUnlocked(new Set(unlocksSnap.data()?.ids ?? []));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const result = useMemo(
    () => evaluateAchievements({ progress, alreadyUnlocked: unlocked }),
    [progress, unlocked],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const tabAchievements = ACHIEVEMENTS.filter((a) => a.unlock.domain === activeTab);
  const tabUnlockedCount = tabAchievements.filter((a) => unlocked.has(a.id)).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* 頂部 */}
      <View style={{ padding: 16, backgroundColor: '#1F4E78' }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>我的收藏</Text>
        <Text style={{ color: '#dbeafe', marginTop: 4 }}>
          已解鎖 {unlocked.size} / {ACHIEVEMENTS.length} 個成就
        </Text>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}
        contentContainerStyle={{ padding: 12, gap: 8 }}
      >
        {DOMAIN_TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: activeTab === t.key ? '#1F4E78' : '#f3f4f6',
            }}
          >
            <Text style={{ color: activeTab === t.key ? '#fff' : '#374151', fontSize: 13 }}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        <Text style={{ color: '#6b7280', marginBottom: 12 }}>
          {DOMAIN_TABS.find((t) => t.key === activeTab)?.label}：{tabUnlockedCount} /{' '}
          {tabAchievements.length} 已解鎖
        </Text>

        {tabAchievements.map((a) => {
          const has = unlocked.has(a.id);
          const current = Number(progress[a.signal as keyof typeof progress] ?? 0);
          const pct = Math.min(100, Math.round((current / a.threshold) * 100));
          return (
            <View
              key={a.id}
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 16,
                marginBottom: 10,
                opacity: has ? 1 : 0.6,
                borderWidth: has ? 2 : 1,
                borderColor: has ? '#fbbf24' : '#e5e7eb',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 36, opacity: has ? 1 : 0.4 }}>{a.unlock.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>
                    {a.unlock.label} {has && '✨'}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {a.description}
                  </Text>
                  {!has && (
                    <View style={{ marginTop: 8 }}>
                      <View
                        style={{
                          height: 4,
                          backgroundColor: '#e5e7eb',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: `${pct}%`,
                            height: 4,
                            backgroundColor: '#1F4E78',
                          }}
                        />
                      </View>
                      <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        進度 {current} / {a.threshold}（{pct}%）
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {/* 即將解鎖 */}
        {result.closestPending.length > 0 && activeTab === 'study' && (
          <View
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#92400E' }}>即將解鎖</Text>
            {result.closestPending.map((p) => (
              <Text key={p.id} style={{ fontSize: 12, color: '#92400E', marginTop: 4 }}>
                · {p.label}（{p.percent}%）
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
