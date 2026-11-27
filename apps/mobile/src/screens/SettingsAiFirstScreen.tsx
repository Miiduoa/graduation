import { NextClassLiveActivitySetting } from '../widgets/NextClassLiveActivitySetting';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { AIDetailScreen, AISection, AIRow, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { SegmentedControl } from '../ui/interactive/SegmentedControl';
import { useAuth } from '../state/auth';
import { useOptionalNuniSession } from '../state/nuniSession';
import { useThemeMode } from '../state/theme';
import { getLegalUrl } from '../services/release';
import { SchoolBrowsingControl } from '../components/SchoolBrowsingControl';

type Navigation = { goBack?: () => void; navigate?: (screen: string, params?: Record<string, unknown>) => void };

export default function SettingsAiFirstScreen({ navigation }: { navigation?: Navigation }) {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const { mode, appearanceMode, setMode } = useThemeMode();
  const uid = auth.user?.uid;
  // A cached session is not authority while refresh or logout is unresolved.
  const platformAccountStatus = platform?.pendingLogout
    ? 'logout-pending'
    : platform?.loading
      ? 'checking'
      : platform?.error
        ? 'unverified'
        : platform?.session
          ? 'ready'
          : 'guest';
  const hasPlatformSession = platformAccountStatus === 'ready';
  const accountHeading = uid
    ? '目前登入帳號'
    : platformAccountStatus === 'logout-pending'
      ? 'nuni 帳號登出處理中'
      : platformAccountStatus === 'checking'
        ? '正在確認 nuni 帳號'
        : platformAccountStatus === 'unverified'
          ? '無法確認 nuni 帳號'
          : hasPlatformSession
            ? 'nuni 帳號已登入'
            : '尚未登入';
  const accountDescription = hasPlatformSession
    ? '尚未登入學校帳號'
    : platformAccountStatus === 'logout-pending'
      ? '請完成 nuni 帳號登出後再使用助理權限。'
      : platformAccountStatus === 'checking'
        ? '正在確認登入狀態，學校登入仍可使用。'
        : platformAccountStatus === 'unverified'
          ? '請確認連線，並前往 Google 帳號與連線管理登入狀態。'
          : '登入後管理個人資料';
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const mounted = useRef(true);
  const signingOut = useRef(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<{ uid: string | undefined; message: string } | null>(null);
  const busy = Boolean(uid && busyUid === uid);
  const version = Constants.expoConfig?.version;
  const privacyUrl = getLegalUrl('privacy');
  const termsUrl = getLegalUrl('terms');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const go = (screen: string, params?: Record<string, unknown>) => () => {
    if (typeof navigation?.navigate !== 'function') {
      throw new Error(`設定頁無法開啟「${screen}」。`);
    }
    if (params) navigation.navigate(screen, params);
    else navigation.navigate(screen);
  };
  const openLegal = async (url: string | null) => {
    if (!url) return;
    const requestedUid = uid;
    setError(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current && currentUid.current === requestedUid) {
        setError({ uid: requestedUid, message: '無法開啟網頁，請確認網路連線後重試。' });
      }
    }
  };

  const confirmLogout = () => {
    if (!uid || signingOut.current) return;
    const requestedUid = uid;
    Alert.alert('登出', '確定要登出這個帳號嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
        onPress: async () => {
          if (!mounted.current || currentUid.current !== requestedUid || signingOut.current) return;
          signingOut.current = true;
          setBusyUid(requestedUid);
          setError(null);
          try {
            await auth.signOutWithWarning();
          } catch {
            if (mounted.current && currentUid.current === requestedUid) {
              setError({ uid: requestedUid, message: '無法登出，請稍後重試。' });
            }
          } finally {
            signingOut.current = false;
            if (mounted.current) setBusyUid((value) => (value === requestedUid ? null : value));
          }
        },
      },
    ]);
  };

  return (
    <AIDetailScreen
      testID="settings-screen"
      title="設定"
      subtitle="管理帳號與調整閱讀方式。"
      keyboardShouldPersistTaps="handled"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard
        title={accountHeading}
        titleTestID="settings-current-account"
      >
        <View style={{ gap: 8 }}>
          <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>
            {uid
              ? profile?.displayName?.trim() || auth.user?.displayName?.trim() || '我的帳號'
              : accountDescription}
          </Text>
          {uid ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              {auth.user?.email || profile?.email || '尚未提供電子郵件'}
            </Text>
          ) : (
            <>
              {hasPlatformSession ? (
                <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                  仍可管理助理權限；登入學校帳號後可管理校園個人資料。
                </Text>
              ) : null}
              <AIButton label="學校登入" onPress={go('SSOLogin')} />
            </>
          )}
        </View>
      </AICard>

      {platform ? (
        <AIRow
          testID="settings-google-account"
          title="Google 帳號與連線"
          subtitle="登入或管理 nuni 帳號、學校資格與連線狀態"
          onPress={go('NuniWorkspace', { tab: 'account' })}
        />
      ) : null}

      {uid && Constants.expoConfig?.extra?.release?.features?.widgets === true ? (
        <NextClassLiveActivitySetting />
      ) : null}

      <AISection title="校園">
        <SchoolBrowsingControl />
      </AISection>

      <AISection title="外觀與閱讀">
        <AICard title="介面主題">
          <View style={{ gap: 12 }}>
            <Text style={{ color: aiTokens.muted }}>
              目前使用{mode === 'dark' ? '深色' : '淺色'}模式。
            </Text>
            <SegmentedControl
              selected={appearanceMode}
              options={[
                { id: 'system', label: '跟隨系統' },
                { id: 'light', label: '淺色' },
                { id: 'dark', label: '深色' },
              ]}
              onChange={setMode}
            />
          </View>
        </AICard>
        <AIRow
          testID="settings-accessibility"
          title="無障礙設定"
          subtitle="查看裝置輔助功能與閱讀設定"
          onPress={go('AccessibilitySettings')}
        />
        <AIRow
          testID="settings-language"
          title="介面語言"
          subtitle="選擇已提供翻譯的介面語言"
          onPress={go('LanguageSettings')}
        />
      </AISection>

      {uid || hasPlatformSession ? (
        <AISection title="AI 助理">
          <AIRow
            title="助理權限"
            subtitle="逐項開關助理可執行的代辦動作（預設開啟，每次執行仍需確認）"
            onPress={go('AssistantPermissions')}
          />
        </AISection>
      ) : null}

      {uid ? (
        <>
          <AISection title="通知與個人資料">
            <AIRow
              title="通知設定"
              subtitle="管理通知類型與免打擾時段"
              onPress={go('NotificationSettings')}
            />
            <AIRow
              title="個人資料"
              subtitle="修改顯示名稱、簡介與電話"
              onPress={go('ProfileEdit')}
            />
            <AIRow
              testID="settings-export-data"
              title="匯出我的資料"
              subtitle="選擇要匯出的資料範圍"
              onPress={go('DataExport')}
            />
          </AISection>
          <AICard title="學校帳號與密碼">
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              學校帳號的密碼由校方管理。如需變更或重設，請使用學校帳號服務。
            </Text>
          </AICard>
        </>
      ) : null}

      <AISection title="關於 nuni">
        {version ? <AIRow title="版本" subtitle={version} static /> : null}
        <AIRow
          title="服務條款"
          subtitle={termsUrl ? '查看適用條款' : '目前無法提供條款連結'}
          disabled={!termsUrl}
          onPress={() => void openLegal(termsUrl)}
        />
        <AIRow
          title="隱私政策"
          subtitle={privacyUrl ? '了解資料使用與保存方式' : '目前無法提供隱私政策連結'}
          disabled={!privacyUrl}
          onPress={() => void openLegal(privacyUrl)}
        />
        <AIRow title="意見回饋" onPress={go('Feedback')} />
      </AISection>

      {uid ? (
        <AISection title="帳號管理">
          <AIRow title={busy ? '正在登出…' : '登出'} disabled={busy} onPress={confirmLogout} />
          <AIRow
            title="刪除帳號"
            subtitle="先查看刪除範圍與確認步驟"
            disabled={busy}
            onPress={go('AccountDeletion')}
          />
        </AISection>
      ) : null}
      {error && error.uid === uid ? (
        <AICard>
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            {error.message}
          </Text>
        </AICard>
      ) : null}
    </AIDetailScreen>
  );
}
