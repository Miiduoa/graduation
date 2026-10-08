import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { AIDetailScreen, AISection, AIRow, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { useThemeMode } from '../state/theme';
import { getLegalUrl } from '../services/release';

type Navigation = { goBack?: () => void; navigate?: (screen: string) => void };

export default function SettingsAiFirstScreen({ navigation }: { navigation?: Navigation }) {
  const auth = useAuth();
  const { mode, setMode } = useThemeMode();
  const uid = auth.user?.uid;
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

  const go = (screen: string) => () => navigation?.navigate?.(screen);
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
      title="設定"
      subtitle="管理帳號與調整閱讀方式。"
      onBack={() => navigation?.goBack?.()}
    >
      <AICard title={uid ? '目前登入帳號' : '尚未登入'}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>
            {uid
              ? profile?.displayName?.trim() || auth.user?.displayName?.trim() || '我的帳號'
              : '登入後管理個人資料'}
          </Text>
          {uid ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              {auth.user?.email || profile?.email || '尚未提供電子郵件'}
            </Text>
          ) : (
            <AIButton label="學校登入" onPress={go('SSOLogin')} />
          )}
        </View>
      </AICard>

      <AISection title="外觀與閱讀">
        <AICard title="介面主題">
          <View style={{ gap: 12 }}>
            <Text style={{ color: aiTokens.muted }}>
              目前使用{mode === 'dark' ? '深色' : '淺色'}模式。
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <AIButton
                label="淺色"
                variant={mode === 'light' ? 'primary' : 'ghost'}
                onPress={() => setMode('light')}
              />
              <AIButton
                label="深色"
                variant={mode === 'dark' ? 'primary' : 'ghost'}
                onPress={() => setMode('dark')}
              />
            </View>
          </View>
        </AICard>
        <AIRow
          title="無障礙設定"
          subtitle="查看裝置輔助功能與閱讀設定"
          onPress={go('AccessibilitySettings')}
        />
        <AIRow
          title="介面語言"
          subtitle="選擇已提供翻譯的介面語言"
          onPress={go('LanguageSettings')}
        />
      </AISection>

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

      <AISection title="關於 Campus One">
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
