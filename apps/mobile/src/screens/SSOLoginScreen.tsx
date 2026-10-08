import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
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

import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from '@campus/shared/src';

import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { signInWithStudentId, type LoginProgress } from '../services/studentIdAuth';
import { getAuthInstance } from '../firebase';
import { Screen, Button, AnimatedCard, Card, Pill } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme, getThemeVersion, subscribeToTheme } from '../ui/theme';

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
  onStart: () => void;
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
    if (!request || busy || disabled || pending.current) return;
    pending.current = true;
    onStart();
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
      kind="primary"
      onPress={() => void start()}
      disabled={busy || disabled || !request}
    />
  );
}

export function SSOLoginScreen(props: SSOLoginScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
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

  const bootstrapStepOrder: LoginStep[] = [
    'authenticating',
    'syncingCampus',
    'syncingTronClass',
    'linking',
  ];

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
    setError(null);
    setIsRetryable(false);
    setStep('authenticating');
    setStageDetail('確認學校帳號');

    const onProgress = (progressStep: LoginProgress) => {
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

      setStep('linking');
      setStageDetail('完成登入');
      await auth.refreshProfile();
      setStep('success');

      const deptLabel = result.department ? `（${result.department}）` : '';
      setTimeout(() => {
        Alert.alert('登入成功', `歡迎，${result.displayName}${deptLabel}`, [
          {
            text: '確定',
            onPress: () => {
              void import('../services/companionEngine').then((m) =>
                m.recordCompanionFeatureSignal('sso_login'),
              );
              nav?.goBack?.();
            },
          },
        ]);
      }, 250);
    } catch (loginError) {
      console.warn('Student ID login error:', loginError);
      setError('學校帳號登入未完成，請確認帳號密碼與網路連線後重試。');
      setIsRetryable(true);
      setStep('error');
    }
  };

  const handleRetry = () => {
    setStep('idle');
    setStageDetail('確認學校帳號');
    setError(null);
    setIsRetryable(false);
  };

  const handleGoogleStart = () => {
    setError(null);
    setIsRetryable(false);
    setGoogleBusy(true);
  };

  const handleGoogleError = () => {
    setError('Google 登入未完成，請稍後重試或改用學校帳號。');
    setIsRetryable(true);
    setStep('error');
    setGoogleBusy(false);
  };

  const handleGoogleLogin = async (idToken: string) => {
    try {
      const cred = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(getAuthInstance(), cred);
      await auth.refreshProfile();
      void import('../services/companionEngine').then((m) =>
        m.recordCompanionFeatureSignal('sso_login'),
      );
      setStep('success');

      setTimeout(() => {
        Alert.alert('登入成功', '已使用 Google 帳號登入', [
          {
            text: '確定',
            onPress: () => {
              nav?.goBack?.();
            },
          },
        ]);
      }, 250);
    } catch (loginError) {
      console.warn('Google login error:', loginError);
      handleGoogleError();
    } finally {
      setGoogleBusy(false);
    }
  };

  const isBusy =
    step === 'authenticating' ||
    step === 'syncingCampus' ||
    step === 'syncingTronClass' ||
    step === 'linking';

  const formLocked = isBusy || googleBusy;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* ── 學校資訊卡片 ── */}
        <AnimatedCard title="登入學校帳號" subtitle="使用靜宜大學帳號登入">
          <View
            style={{
              padding: 16,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="school" size={24} color={theme.colors.onAccent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
                  {schoolName}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                  {school.shortName ? `${school.shortName} · ` : ''}
                  {PROVIDENCE_UNIVERSITY_SCHOOL_CODE}
                </Text>
              </View>
              <Pill text={PROVIDENCE_UNIVERSITY_SCHOOL_CODE} kind="accent" />
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              選擇 Google 或學校帳號登入。需要同步課程資料時，請使用學校帳號。
            </Text>
          </View>
        </AnimatedCard>

        {/* ── Google 登入（主路） ── */}
        <AnimatedCard title="Google 登入" subtitle="使用你的 Google 帳號">
          <View style={{ gap: 14 }}>
            {googleClientId ? (
              <ConfiguredGoogleLoginButton
                key={googleClientId}
                clientIds={googleIds}
                busy={googleBusy}
                disabled={isBusy}
                onStart={handleGoogleStart}
                onCancel={() => setGoogleBusy(false)}
                onError={handleGoogleError}
                onIdToken={handleGoogleLogin}
              />
            ) : (
              <Button text="Google 登入暫時無法使用" kind="primary" disabled />
            )}
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              {googleClientId
                ? '選擇要使用的 Google 帳號後，即可繼續登入。'
                : '目前暫時無法使用 Google 登入，請改用下方的學校帳號。'}
            </Text>
          </View>
        </AnimatedCard>

        {/* ── 校方帳號（進階） ── */}
        <AnimatedCard title="學校帳號登入" subtitle="使用靜宜 E 校園帳號與密碼">
          <View style={{ gap: 14 }}>
            <View
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                paddingHorizontal: 14,
                minHeight: 54,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
                學號
              </Text>
              <TextInput
                testID="student-id-input"
                value={studentIdInput}
                onChangeText={setStudentIdInput}
                placeholder="E校園帳號"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!formLocked}
                style={{ color: theme.colors.text, fontSize: 16, paddingVertical: 0 }}
              />
            </View>

            <View
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                paddingHorizontal: 14,
                minHeight: 54,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
                密碼
              </Text>
              <TextInput
                testID="student-password-input"
                value={studentPwInput}
                onChangeText={setStudentPwInput}
                placeholder="輸入 e 校園密碼"
                placeholderTextColor={theme.colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!formLocked}
                style={{ color: theme.colors.text, fontSize: 16, paddingVertical: 0 }}
              />
            </View>

            <Button
              text={isBusy ? '登入中...' : '使用學號登入'}
              kind="primary"
              onPress={handleStudentIdLogin}
              disabled={formLocked || !studentIdInput.trim() || !studentPwInput.trim()}
            />

            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
              登入後可讀取學校目前提供的個人資料、課程與成績。
            </Text>
          </View>
        </AnimatedCard>

        {/* ── 登入進度 ── */}
        {isBusy ? (
          <AnimatedCard title="登入處理中" subtitle={stepLabels[step]}>
            <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <ActivityIndicator color={theme.colors.accent} size="large" />
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{stageDetail}</Text>
              <Text style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 20 }}>
                正在確認帳號並讀取學校資料，請保持網路連線。
              </Text>
              <View style={{ width: '100%', gap: 8, marginTop: 4 }}>
                {bootstrapStepOrder.map((candidate, index) => {
                  const currentIndex = bootstrapStepOrder.indexOf(step);
                  const candidateIndex = bootstrapStepOrder.indexOf(candidate);
                  const isActive = currentIndex === candidateIndex;
                  const isDone = currentIndex > candidateIndex;

                  return (
                    <View
                      key={candidate}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: isActive ? theme.colors.accentSoft : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: isActive ? `${theme.colors.accent}40` : theme.colors.border,
                        opacity: isDone ? 0.9 : 1,
                      }}
                    >
                      <Text style={{ color: isDone ? theme.colors.success : theme.colors.muted }}>
                        {isDone ? '✓' : isActive ? '…' : `${index + 1}`}
                      </Text>
                      <Text
                        style={{
                          color: isActive ? theme.colors.accent : theme.colors.text,
                          fontWeight: isActive ? '700' : '500',
                        }}
                      >
                        {stepLabels[candidate]}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Button text="返回登入表單" kind="secondary" onPress={handleRetry} />
            </View>
          </AnimatedCard>
        ) : null}

        {/* ── 登入成功 ── */}
        {step === 'success' ? (
          <AnimatedCard title="登入進度" subtitle="">
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: `${theme.colors.success}20`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <Ionicons name="checkmark-circle" size={36} color={theme.colors.success} />
              </View>
              <Text style={{ color: theme.colors.success, fontSize: 16, fontWeight: '700' }}>
                登入成功！
              </Text>
            </View>
          </AnimatedCard>
        ) : null}

        {/* ── 登入失敗 ── */}
        {step === 'error' && error ? (
          <AnimatedCard title="登入失敗" subtitle="請檢查帳號密碼或稍後再試">
            <View style={{ gap: 14 }}>
              <View
                style={{
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.dangerSoft ?? `${theme.colors.danger}15`,
                  borderWidth: 1,
                  borderColor: `${theme.colors.danger}30`,
                }}
              >
                <Text style={{ color: theme.colors.danger, lineHeight: 20 }}>{error}</Text>
              </View>
              {isRetryable ? <Button text="重新嘗試" onPress={handleRetry} kind="primary" /> : null}
            </View>
          </AnimatedCard>
        ) : null}

        {/* ── 關於學校帳號登入（說明卡片）── */}
        {step === 'idle' ? (
          <Card title="關於學校帳號登入" subtitle="使用現有帳號，連接校園資料">
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="shield-checkmark" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>學校身分驗證</Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 18,
                    }}
                  >
                    請使用學校帳號與密碼完成身分驗證
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="flash" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>快速便捷</Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 18,
                    }}
                  >
                    使用現有學校帳號，無需另外註冊，登入後自動準備你的校園帳號
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="sync" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>自動同步</Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 18,
                    }}
                  >
                    可同步的資料依學校提供內容而定，請以登入後顯示的結果為準
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="cloud-done" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>離線快取</Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 18,
                    }}
                  >
                    已同步的資料可在離線時查看；取得最新內容仍需連線更新
                  </Text>
                </View>
              </View>
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
