import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIDetailScreen, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { firebaseSource } from '../data/firebaseSource';
import type { Grade } from '../data/types';
import { PersonalImportSummary } from '../components/PersonalImportSummary';
import { safeNavigate } from '../utils/safeNavigate';
import { loadFailureOrLoginCopy } from '../utils/loadFailureCopy';

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
    checkedAt?: string;
    loading: boolean;
    error: unknown | null;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, rows: [], loading: true, error: null });
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
        setState({ scope, rows, checkedAt: new Date().toISOString(), loading: false, error: null });
      }
    } catch (error) {
      if (currentScope.current === scope && generation.current === request) {
        setState({ scope, rows: [], loading: false, error });
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
      <Text style={{ color: aiTokens.muted, padding: 16 }}>本次讀取：{visible?.checkedAt ? new Date(visible.checkedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未確認'}。未取得與待評顯示未知，不換算成零分。點選成績可回到原始紀錄。</Text>
      <AISection title="成績紀錄">
        {!visible || visible.loading ? (
          <ActivityIndicator accessibilityLabel="讀取成績" color={aiTokens.ai} />
        ) : visible.error ? (
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>
              {loadFailureOrLoginCopy(visible.error, '無法讀取成績，請確認登入狀態與網路後重試。')}
            </Text>
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
                key={grade.id}
                title={grade.courseName || '課程成績'}
                subtitle={[grade.gradeSource === 'school-official' || grade.gradeSource === 'school-official-offline' ? '來源：校方正式' : '來源：nuni 課程', grade.semester, credits, `公布時間：${(grade.publishedAt ? formatTaipeiDateTime(grade.publishedAt) : '') || '未知'}`].filter(Boolean).join(' · ')}
                onPress={() => grade.gradeSource?.startsWith('school-official') ? void Linking.openURL('https://ecampus.pu.edu.tw/') : safeNavigate(navigation, 'CourseGradebook', { groupId: grade.courseId, groupName: grade.courseName })}
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
      <PersonalImportSummary kind="grades" />
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
