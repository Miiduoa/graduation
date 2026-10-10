import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { exchangeCodeAsync } from 'expo-auth-session';
import { discovery, useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';

import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { signInWithStudentId, type LoginProgress } from '../services/studentIdAuth';
import { getAuthInstance } from '../firebase';
import { Screen, Button, AnimatedCard } from '../ui/components';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

WebBrowser.maybeCompleteAuthSession();

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
  };
};

type GoogleClientIds = { web: string; ios: string; android: string };
type LoginAttempt = { provider: 'school' | 'google' };

function ConfiguredGoogleLoginButton({
  clientIds,
  busy,
  disabled,
  onStart,
  onCancel,
  onError,
  onIdToken,
}: {
  clientIds: GoogleClientIds;
  busy: boolean;
  disabled: boolean;
  onStart: () => boolean;
  onCancel: () => void;
  onError: () => void;
  onIdToken: (idToken: string) => Promise<void>;
}) {
  const [request, , promptAsync] = useIdTokenAuthRequest({
    webClientId: clientIds.web || undefined,
    iosClientId: clientIds.ios || undefined,
    androidClientId: clientIds.android || undefined,
    shouldAutoExchangeCode: false,
  });
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function start() {
    if (!mounted.current || !request || busy || disabled || pending.current) return;
    if (!onStart()) return;
    pending.current = true;
    try {
      const result = await promptAsync();
      if (!mounted.current) return;
      if (result.type === 'cancel' || result.type === 'dismiss') {
        onCancel();
        return;
      }
      if (result.type !== 'success') throw new Error('Google authorization did not complete');

      let idToken = result.params.id_token;
      if (!idToken && result.params.code) {
        if (!request.codeVerifier) throw new Error('Missing Google authorization verifier');
        const authentication = await exchangeCodeAsync(
          {
            clientId: request.clientId,
            code: result.params.code,
            redirectUri: request.redirectUri,
            extraParams: { code_verifier: request.codeVerifier },
          },
          discovery,
        );
        idToken = authentication.idToken ?? '';
      }
      if (typeof idToken !== 'string' || !idToken) throw new Error('Missing Google ID token');
      if (mounted.current) await onIdToken(idToken);
    } catch {
      if (mounted.current) onError();
    } finally {
      pending.current = false;
    }
  }

  return (
    <Button
      text={busy ? 'Google 登入處理中…' : request ? '使用 Google 繼續' : '正在準備 Google 登入…'}
      kind="secondary"
      onPress={() => void start()}
      disabled={busy || disabled || !request}
    />
  );
}

export function SSOLoginScreen(props: SSOLoginScreenProps) {
  const styles = useThemeStyleSheet(createStyles);
  const bottomPadding = useTabBarContentBottomPadding();
  const passwordInput = useRef<TextInput>(null);
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  const [studentIdInput, setStudentIdInput] = useState('');
  const [studentPwInput, setStudentPwInput] = useState('');
  const [step, setStep] = useState<LoginStep>('idle');
  const [stageDetail, setStageDetail] = useState('確認學校帳號');
  const [error, setError] = useState<string | null>(null);
  const [isRetryable, setIsRetryable] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const mounted = useRef(true);
  const activeAttempt = useRef<LoginAttempt | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
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
            nav?.goBack?.();
          },
        },
      ]);
    }, 250);
  }

  const googleIds = useMemo(() => {
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    return {
      web: typeof extra.googleWebClientId === 'string' ? extra.googleWebClientId.trim() : '',
      ios: typeof extra.googleIosClientId === 'string' ? extra.googleIosClientId.trim() : '',
      android:
        typeof extra.googleAndroidClientId === 'string' ? extra.googleAndroidClientId.trim() : '',
    };
  }, []);

  const googleClientId = Platform.select({
    ios: googleIds.ios,
    android: googleIds.android,
    default: googleIds.web,
  });

  const schoolName = useMemo(
    () => (school.id === PROVIDENCE_UNIVERSITY_SCHOOL_ID ? school.name : '靜宜大學'),
    [school.id, school.name],
  );

  const stepLabels: Record<LoginStep, string> = {
    idle: '等待登入',
    authenticating: '確認學校帳號',
    syncingCampus: '同步 E 校園資料',
    syncingTronClass: '同步課程資料',
    linking: '準備你的校園帳號',
    success: '登入完成',
    error: '登入失敗',
  };

  const handleStudentIdLogin = async () => {
    if (!studentIdInput.trim() || !studentPwInput.trim()) return;
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
        schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
        schoolName,
        onProgress,
      });

      if (!isCurrent(attempt)) return;
      setStep('linking');
      setStageDetail('完成登入');
      await auth.refreshProfile();
      if (!isCurrent(attempt)) return;
      setStep('success');

      const deptLabel = result.department ? `（${result.department}）` : '';
      showSuccess(attempt, `歡迎，${result.displayName}${deptLabel}`, () => {
        void import('../services/companionEngine')
          .then((m) => m.recordCompanionFeatureSignal('sso_login'))
          .catch(() => undefined);
      });
    } catch (loginError) {
      if (!isCurrent(attempt)) return;
      activeAttempt.current = null;
      console.warn('Student ID login error:', loginError);
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

  const handleGoogleStart = () => {
    if (!beginAttempt('google')) return false;
    setError(null);
    setIsRetryable(false);
    setGoogleBusy(true);
    return true;
  };

  const handleGoogleCancel = () => {
    if (!mounted.current || activeAttempt.current?.provider !== 'google') return;
    activeAttempt.current = null;
    setGoogleBusy(false);
  };

  const handleGoogleError = () => {
    if (!mounted.current || activeAttempt.current?.provider !== 'google') return;
    activeAttempt.current = null;
    setError('Google 登入未完成，請稍後重試或改用學校帳號。');
    setIsRetryable(true);
    setStep('error');
    setGoogleBusy(false);
  };

  const handleGoogleLogin = async (idToken: string) => {
    const attempt = activeAttempt.current;
    if (!attempt || attempt.provider !== 'google' || !isCurrent(attempt)) return;
    try {
      const cred = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(getAuthInstance(), cred);
      if (!isCurrent(attempt)) return;
      await auth.refreshProfile();
      if (!isCurrent(attempt)) return;
      void import('../services/companionEngine')
        .then((m) => m.recordCompanionFeatureSignal('sso_login'))
        .catch(() => undefined);
      setStep('success');
      showSuccess(attempt, '已使用 Google 帳號登入');
    } catch (loginError) {
      if (!isCurrent(attempt)) return;
      console.warn('Google login error:', loginError);
      handleGoogleError();
    } finally {
      if (isCurrent(attempt)) setGoogleBusy(false);
    }
  };

  const isBusy =
    step === 'authenticating' ||
    step === 'syncingCampus' ||
    step === 'syncingTronClass' ||
    step === 'linking';

  const formLocked = isBusy || googleBusy || step === 'success';

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
          <Text style={styles.body}>使用學校帳號，查看課程與校園生活資訊。</Text>
        </View>

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

        <AnimatedCard title="Google 登入" subtitle="使用 Google 帳號進入 Campus One">
          {googleClientId ? (
            <ConfiguredGoogleLoginButton
              key={googleClientId}
              clientIds={googleIds}
              busy={googleBusy}
              disabled={isBusy || step === 'success'}
              onStart={handleGoogleStart}
              onCancel={handleGoogleCancel}
              onError={handleGoogleError}
              onIdToken={handleGoogleLogin}
            />
          ) : (
            <Button text="Google 登入暫時無法使用" kind="secondary" disabled />
          )}
          <Text style={styles.note}>
            {googleClientId
              ? 'Google 登入不會同步學校課程；需要查看課程時，請使用學校帳號。'
              : '目前暫時無法使用 Google 登入，請使用上方的學校帳號。'}
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
