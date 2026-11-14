import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AIScreen, AIHero, AISection, AICard, AIRow, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useNuniSession } from '../state/nuniSession';
import { usePermissions } from '../hooks/usePermissions';
import { safeNavigate } from '../utils/safeNavigate';
import { loadFailureCopy } from '../utils/loadFailureCopy';
import { rootNavigateNested } from '../app/rootNavigation';

export default function MeAiFirstScreen() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const navigation = useNavigation();
  const auth = useAuth();
  const platform = useNuniSession();
  const { signOutWithWarning } = auth;
  const { isStudent } = usePermissions();
  const platformReady = !!platform.session && !platform.loading && !platform.error && !platform.pendingLogout;
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const signingOut = useRef(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const busy = Boolean(uid && busyUid === uid);
  const displayName = profile?.displayName?.trim() || auth.user?.displayName?.trim() || '我的帳號';
  const details = [profile?.department, profile?.studentId ? `學號 ${profile.studentId}` : null]
    .filter(Boolean)
    .join(' · ');
  const go = (screen: string) => () => safeNavigate(navigation, screen);

  const confirmLogout = useCallback(() => {
    if (!uid || signingOut.current) return;
    const requestedUid = uid;
    Alert.alert('登出學校帳號', '確定要登出學校帳號嗎？Google 帳號會保留登入。', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出學校帳號',
        style: 'destructive',
        onPress: async () => {
          if (currentUid.current !== requestedUid || signingOut.current) return;
          signingOut.current = true;
          setBusyUid(requestedUid);
          try {
            await signOutWithWarning();
          } catch {
            if (currentUid.current === requestedUid) Alert.alert('無法登出', '請稍後重試。');
          } finally {
            signingOut.current = false;
            setBusyUid((value) => (value === requestedUid ? null : value));
          }
        },
      },
    ]);
  }, [uid, signOutWithWarning]);

  return (
    <AIScreen>
      <AIHero
        eyebrow="nuni"
        title={displayName}
        subtitle={details || '你的個人內容、帳號與使用設定。'}
      />
      <AISection title="學校帳號資料">
        <AICard title={auth.profileLoading ? '正在讀取帳號資料' : '目前登入帳號'}>
          <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>
            {auth.user?.email || profile?.email || '尚未提供電子郵件'}
          </Text>
          {!profile && !auth.profileLoading ? (
            <Text style={{ color: aiTokens.muted, marginTop: 8 }}>
              {uid && !auth.profile
                ? auth.error || loadFailureCopy()
                : '目前無法讀取個人檔案，請確認登入狀態。'}
            </Text>
          ) : null}
        </AICard>
        {isStudent && profile ? (
          <AIRow title="數位學生證" subtitle="查看卡面與出示學號" onPress={go('StudentCard')} />
        ) : null}
        <AIRow title="個人資料" subtitle="修改顯示名稱、簡介與電話" onPress={go('ProfileEdit')} />
      </AISection>
      <AISection title="我的內容">
        <AIRow
          title="個人社群首頁"
          subtitle="整理署名貼文、圖文作品與發表新內容"
          onPress={go('MySocialProfile')}
        />
        {!!uid && (
          <AIRow
            title="查看公開社群頁"
            subtitle="查看別人看到的個人介紹與作品"
            onPress={() => rootNavigateNested('訊息', 'CreatorProfile', { memberUid: uid })}
          />
        )}
      </AISection>
      <AISection title="帳號與助理">
        <AIRow
          title="Google 帳號與連線"
          subtitle="管理 Google 帳號、學校資格與店家權限"
          onPress={() => safeNavigate(navigation, 'NuniWorkspace', { tab: 'account' })}
        />
        {platformReady ? (
          <AIRow
            title="開啟課表助理"
            subtitle="用已驗證的 nuni 帳號查這堂課與作業"
            onPress={go('NuniTimetableAssistant')}
          />
        ) : null}
      </AISection>
      <AISection title="設定與協助">
        <AIRow
          title="使用設定"
          subtitle="外觀、通知、助理權限與資料管理"
          onPress={go('Settings')}
        />
        <AIRow title="幫助與回饋" onPress={go('Help')} />
        <AIRow
          title={busy ? '正在登出…' : '登出學校帳號'}
          onPress={busy ? undefined : confirmLogout}
        />
      </AISection>
    </AIScreen>
  );
}
