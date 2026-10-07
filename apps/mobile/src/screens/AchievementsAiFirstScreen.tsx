import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIDetailScreen, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { firebaseSource } from '../data/firebaseSource';
import { safeNavigate } from '../utils/safeNavigate';

type AchievementRecord = { id: string; name: string; description?: string; completed: boolean };

export default function AchievementsAiFirstScreen() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const navigation = useNavigation();
  const auth = useAuth();
  const uid = auth.user?.uid;
  const schoolId = auth.profile?.uid === uid ? auth.profile?.schoolId : null;
  const scope = JSON.stringify([uid, schoolId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    rows: AchievementRecord[];
    loading: boolean;
    error: boolean;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, rows: [], loading: true, error: false });
    try {
      if (!uid || !schoolId || uid.startsWith('demo_')) throw new Error('missing-account');
      const [records, catalog] = await Promise.all([
        firebaseSource.getUserAchievements(uid, schoolId),
        firebaseSource.listAchievements(),
      ]);
      const rows: AchievementRecord[] = [];
      for (const record of records) {
        if ((record.userId && record.userId !== uid) || record.schoolId !== schoolId) continue;
        const definition = catalog.find((item) => item.id === (record.achievementId || record.id));
        const name =
          record.achievement?.name ||
          record.name ||
          definition?.name ||
          definition?.achievement?.name;
        if (!name?.trim()) continue;
        const unlocked = record.unlockedAt ? Date.parse(record.unlockedAt) : Number.NaN;
        rows.push({
          id: record.id,
          name,
          description:
            record.achievement?.description || record.description || definition?.description,
          completed:
            record.completed === true || (Number.isFinite(unlocked) && unlocked <= Date.now()),
        });
      }
      if (currentScope.current === scope && generation.current === request) {
        setState({ scope, rows, loading: false, error: false });
      }
    } catch {
      if (currentScope.current === scope && generation.current === request) {
        setState({ scope, rows: [], loading: false, error: true });
      }
    }
  }, [uid, schoolId, scope]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current += 1;
      };
    }, [load]),
  );

  return (
    <AIDetailScreen
      title="成就紀錄"
      subtitle="查看目前帳號已記錄的成就"
      onBack={() => navigation.goBack()}
    >
      <AISection title="我的成就">
        {!visible || visible.loading ? (
          <ActivityIndicator accessibilityLabel="讀取成就" color={aiTokens.ai} />
        ) : visible.error ? (
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>
              無法讀取成就紀錄，請確認登入狀態與網路後重試。
            </Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        ) : visible.rows.length ? (
          visible.rows.map((record) => (
            <AIRow
              static
              key={record.id}
              title={record.name}
              subtitle={record.description}
              tag={record.completed ? '已完成' : '已記錄'}
              tagTone={record.completed ? 'success' : 'muted'}
            />
          ))
        ) : (
          <Text style={{ color: aiTokens.muted, padding: 16, lineHeight: 22 }}>
            目前沒有可顯示的成就紀錄。課程與待辦仍可正常使用。
          </Text>
        )}
      </AISection>
      <AISection title="繼續學習">
        <AIRow
          title="課程與待辦"
          subtitle="查看已加入的課程與近期課務"
          onPress={() => safeNavigate(navigation, 'LearnHome')}
        />
      </AISection>
    </AIDetailScreen>
  );
}
