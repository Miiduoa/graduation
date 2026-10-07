import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIDetailScreen, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { firebaseSource } from '../data/firebaseSource';
import type { Grade } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';

export default function GradesAiFirstScreen() {
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
    rows: Grade[];
    loading: boolean;
    error: boolean;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, rows: [], loading: true, error: false });
    try {
      if (!uid || !schoolId || uid.startsWith('demo_')) throw new Error('missing-account');
      const rows = (await firebaseSource.listGrades(uid, undefined, schoolId)).filter(
        (grade) =>
          grade.userId === uid &&
          grade.schoolId === schoolId &&
          grade.publishedAt &&
          Number.isFinite(Date.parse(grade.publishedAt)) &&
          Date.parse(grade.publishedAt) <= Date.now(),
      );
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
      title="我的成績"
      subtitle="查看目前帳號已同步的成績紀錄"
      onBack={() => navigation.goBack()}
    >
      <AISection title="成績紀錄">
        {!visible || visible.loading ? (
          <ActivityIndicator accessibilityLabel="讀取成績" color={aiTokens.ai} />
        ) : visible.error ? (
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>無法讀取成績，請確認登入狀態與網路後重試。</Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        ) : visible.rows.length ? (
          visible.rows.map((grade) => {
            const score = grade.score ?? grade.finalScore ?? grade.grade;
            const result =
              typeof score === 'number' && Number.isFinite(score)
                ? `${score} 分`
                : grade.letterGrade || '未提供分數';
            const credits =
              typeof grade.credits === 'number' &&
              Number.isFinite(grade.credits) &&
              grade.credits >= 0
                ? `${grade.credits} 學分`
                : null;
            return (
              <AIRow
                static
                key={grade.id}
                title={grade.courseName || '課程成績'}
                subtitle={[grade.semester, credits, grade.letterGrade].filter(Boolean).join(' · ')}
                tag={result}
              />
            );
          })
        ) : (
          <Text style={{ color: aiTokens.muted, padding: 16, lineHeight: 22 }}>
            尚無可確認屬於目前學校且已發布的成績紀錄。可從課程查看教師提供的課內成績。
          </Text>
        )}
      </AISection>
      <AISection title="課程資料">
        <AIRow
          title="查看課內成績"
          subtitle="從已加入的課程開啟成績簿"
          onPress={() => safeNavigate(navigation, 'LearnHome')}
        />
      </AISection>
    </AIDetailScreen>
  );
}
