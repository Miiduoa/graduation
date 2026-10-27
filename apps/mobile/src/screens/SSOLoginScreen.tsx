import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';

import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { finishLoginReturn } from '../utils/loginReturn';
import { signInWithStudentId, type LoginProgress } from '../services/studentIdAuth';
import {
  SCHOOL_LOGIN_BIND_HINT,
  isSchoolLoginEntryAvailable,
  loadSchoolLoginProviderKinds,
} from '../services/schoolLoginAvailability';
import { Screen, Button, AnimatedCard } from '../ui/components';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type LoginStep =
  | 'idle'
  | 'authenticating'
  | 'syncingCampus'
  | 'syncingTronClass'
  | 'linking'
  | 'success'
  | 'error';

type SSOLoginScreenProps = {
  navigation?: {
    goBack?: () => void;
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  route?: { params?: { returnTo?: string } };
};

type LoginAttempt = { provider: 'school' | 'platform' };

export function SSOLoginScreen(props: SSOLoginScreenProps) {
  const { school } = useSchool();
  return <SchoolLoginContent key={school.id} school={school} {...props} />;
}

function SchoolLoginContent(
  props: SSOLoginScreenProps & { school: ReturnType<typeof useSchool>['school'] },
) {
  const { school } = props;
  const styles = useThemeStyleSheet(createStyles);
  const bottomPadding = useTabBarContentBottomPadding();
  const passwordInput = useRef<TextInput>(null);
  const routeNavigation = useNavigation<NavigationProp<Record<string, undefined>>>();
  const nav = props?.navigation ?? routeNavigation;
  const auth = useAuth();

  const [schoolLoginAvailable, setSchoolLoginAvailable] = useState(
    isSchoolLoginEntryAvailable(school.id),
  );

  const [studentIdInput, setStudentIdInput] = useState('');
  const [studentPwInput, setStudentPwInput] = useState('');
  const [step, setStep] = useState<LoginStep>('idle');
  const [stageDetail, setStageDetail] = useState('確認學校帳號');
  const [error, setError] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [leavingForPlatform, setLeavingForPlatform] = useState(false);
  const mounted = useRef(true);
  const activeAttempt = useRef<LoginAttempt | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    void loadSchoolLoginProviderKinds().then(() => {
      if (mounted.current) setSchoolLoginAvailable(isSchoolLoginEntryAvailable(school.id));
    });
    return () => {
      mounted.current = false;
      // Authentication may still finish; only this screen's callbacks are invalidated.
      activeAttempt.current = null;
      if (successTimer.current !== null) clearTimeout(successTimer.current);
    };
  }, []);

  function beginAttempt(provider: LoginAttempt['provider']) {
    if (!mounted.current || activeAttempt.current) return null;
    const attempt: LoginAttempt = { provider };
    activeAttempt.current = attempt;
    return attempt;
  }

  function isCurrent(attempt: LoginAttempt) {
    return mounted.current && activeAttempt.current === attempt;
  }

  function showSuccess(attempt: LoginAttempt, message: string, onConfirm?: () => void) {
    successTimer.current = setTimeout(() => {
      successTimer.current = null;
      if (!isCurrent(attempt)) return;
      Alert.alert('登入成功', message, [
        {
          text: '確定',
          onPress: () => {
            if (!isCurrent(attempt)) return;
            onConfirm?.();
          },
        },
      ]);
    }, 250);
  }

  useFocusEffect(
    useCallback(() => {
      if (activeAttempt.current?.provider === 'platform') {
        activeAttempt.current = null;
        setLeavingForPlatform(false);
      }
    }, []),
  );

  const openPlatformAccount = () => {
    if (!nav.navigate || !beginAttempt('platform')) return;
    setLeavingForPlatform(true);
    nav.navigate('NuniWorkspace');
  };

  const schoolName = school.name;

  const stepLabels: Record<LoginStep, string> = {
    idle: '等待登入',
    authenticating: '確認學校帳號',
    syncingCampus: '同步 E 校園資料',
    syncingTronClass: '同步課程資料',
    linking: '連上學校帳號',
    success: '登入完成',
    error: '登入失敗',
  };

  const handleStudentIdLogin = async () => {
    if (
      !schoolLoginAvailable ||
      school.id !== PROVIDENCE_UNIVERSITY_SCHOOL_ID ||
      !studentIdInput.trim() ||
      !studentPwInput.trim()
    ) return;
    const attempt = beginAttempt('school');
    if (!attempt) return;
    setError(null);
    setIsRetryable(false);
    setStep('authenticating');
    setStageDetail('確認學校帳號');

    const onProgress = (progressStep: LoginProgress) => {
      if (!isCurrent(attempt)) return;
      setStep(progressStep);
      setStageDetail(stepLabels[progressStep]);
    };

    try {
      const result = await signInWithStudentId({
        studentId: studentIdInput,
        password: studentPwInput,
        schoolId: school.id,
        schoolName,
        onProgress,
      });

      if (!isCurrent(attempt)) return;
      setStep('linking');
      setStageDetail('完成登入');
      await auth.refreshProfile();
      if (!isCurrent(attempt)) return;
      setStep('success');
      setStudentPwInput('');

      const deptLabel = result.department ? `（${result.department}）` : '';
      showSuccess(attempt, `歡迎，${result.displayName}${deptLabel}`, () => {
        void import('../services/companionEngine')
          .then((m) => m.recordCompanionFeatureSignal('sso_login'))
          .catch(() => undefined);
        finishLoginReturn(nav, props.route?.params?.returnTo);
      });
    } catch (loginError) {
      if (!isCurrent(attempt)) return;
      activeAttempt.current = null;
      console.warn('Student ID login error:', loginError);
      setStudentPwInput('');
      setError('學校帳號登入未完成，請確認帳號密碼與網路連線後重試。');
      setIsRetryable(true);
      setStep('error');
    }
  };

  const handleRetry = () => {
    if (!mounted.current || activeAttempt.current) return;
    setStep('idle');
    setStageDetail('確認學校帳號');
    setError(null);
    setIsRetryable(false);
  };

  const isBusy =
    step === 'authenticating' ||
    step === 'syncingCampus' ||
    step === 'syncingTronClass' ||
    step === 'linking';

  const formLocked = isBusy || leavingForPlatform || step === 'success';

  return (
    <Screen noPadding>
      <ScrollView
        testID="sso-login-form"
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + theme.space.lg }]}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Campus One · {schoolName}</Text>
          <Text accessibilityRole="header" style={styles.heading}>
            從你的課程開始。
          </Text>
          <Text style={styles.body}>只有讀取個人校務資料，才需要連線學校帳號。</Text>
        </View>

        {schoolLoginAvailable ? (
          <AnimatedCard title="學校帳號登入" subtitle="使用靜宜 E 校園帳號與密碼">
            <View style={styles.fields}>
              <View style={styles.field}>
                <Text nativeID="student-id-label" style={styles.label}>
                  學號
                </Text>
                <TextInput
                  testID="student-id-input"
                  accessibilityLabel="學號"
                  accessibilityLabelledBy="student-id-label"
                  value={studentIdInput}
                  onChangeText={setStudentIdInput}
                  placeholder="輸入 E 校園帳號"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInput.current?.focus()}
                  editable={!formLocked}
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Text nativeID="student-password-label" style={styles.label}>
                  密碼
                </Text>
                <TextInput
                  ref={passwordInput}
                  testID="student-password-input"
                  accessibilityLabel="密碼"
                  accessibilityLabelledBy="student-password-label"
                  value={studentPwInput}
                  onChangeText={setStudentPwInput}
                  placeholder="輸入 E 校園密碼"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="done"
                  editable={!formLocked}
                  style={styles.input}
                />
              </View>
              <Button
                text={isBusy ? '登入中…' : '使用學號登入'}
                kind="primary"
                onPress={handleStudentIdLogin}
                disabled={formLocked || !studentIdInput.trim() || !studentPwInput.trim()}
              />
              <Text style={styles.note}>可同步的課程與成績依學校提供內容而定。</Text>
            </View>
          </AnimatedCard>
        ) : (
          <AnimatedCard title="學校連線尚未開放">
            <Text style={styles.body}>{SCHOOL_LOGIN_BIND_HINT}</Text>
          </AnimatedCard>
        )}

        {isBusy ? (
          <View
            style={styles.status}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`登入處理中，${stageDetail}`}
            accessibilityState={{ busy: true }}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={theme.colors.accent} />
            <View style={styles.statusContent}>
              <Text style={styles.statusTitle}>{stageDetail}</Text>
              <Text style={styles.note}>正在讀取學校資料，請保持網路連線。</Text>
            </View>
          </View>
        ) : null}

        {step === 'error' && error ? (
          <View style={styles.errorPanel}>
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
            {isRetryable ? <Button text="重新嘗試" onPress={handleRetry} kind="secondary" /> : null}
          </View>
        ) : null}

        {step === 'success' ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
            <Text style={[styles.statusTitle, styles.statusContent]}>登入完成</Text>
          </View>
        ) : null}

        <AnimatedCard
          title="不用學校帳號，也能匯入"
          subtitle="讀取你自己下載的校務資料"
        >
          <Text style={styles.note}>
            可匯入學校網頁 HTML 存檔、課表截圖、PDF、CSV；先選表格核對再儲存，不必提供校務密碼。
          </Text>
          <Button
            text="匯入課表、成績或活動"
            kind="secondary"
            onPress={() => nav.navigate?.('PersonalImport')}
            disabled={formLocked}
          />
        </AnimatedCard>

        <AnimatedCard title="Google 帳號" subtitle="和網頁版使用同一個帳號">
          <Button
            text="用 Google 帳號登入"
            kind="secondary"
            onPress={openPlatformAccount}
            disabled={formLocked}
          />
          <Text style={styles.note}>
            用於加入課程、繳交作業與校園社群。學校課表與成績仍需連線學校帳號。
          </Text>
        </AnimatedCard>
        <Text style={styles.note}>已同步的資料可離線查看，更新內容時仍需網路連線。</Text>
      </ScrollView>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    scroll: { flex: 1 },
    content: {
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
      paddingHorizontal: theme.layout.screenHorizontalPadding,
      paddingTop: theme.layout.contentPaddingTop,
      gap: theme.layout.sectionGap,
    },
    intro: { gap: theme.space.sm, paddingVertical: theme.space.md },
    eyebrow: { ...theme.typography.labelSmall, color: theme.colors.textSecondary },
    heading: { ...theme.typography.h1, color: theme.colors.text },
    body: { ...theme.typography.body, color: theme.colors.textSecondary },
    fields: { gap: theme.space.md },
    field: { gap: theme.space.xs },
    label: { ...theme.typography.label, color: theme.colors.text },
    input: {
      minHeight: 48,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.bg,
      color: theme.colors.text,
      fontSize: 16,
    },
    note: { ...theme.typography.bodySmall, color: theme.colors.muted },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accentSoft,
    },
    statusContent: { flex: 1, minWidth: 0, gap: theme.space.xs },
    statusTitle: { ...theme.typography.label, color: theme.colors.text },
    errorPanel: {
      gap: theme.space.md,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.dangerSoft,
    },
    error: { ...theme.typography.bodySmall, color: theme.colors.danger },
  });
