import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AIScreen, AIHero, AISection, AICard, AIRow, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { usePermissions } from '../hooks/usePermissions';
import { safeNavigate } from '../utils/safeNavigate';

export default function MeAiFirstScreen() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const navigation = useNavigation();
  const auth = useAuth();
  const { signOutWithWarning } = auth;
  const { isStudent } = usePermissions();
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
    Alert.alert('登出學校帳號', '確定要登出學校帳號嗎？Campus One 平台帳號會保留登入。', [
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
        eyebrow="CAMPUS ONE"
        title={displayName}
        subtitle={details || '管理帳號、學習資料與個人設定。'}
      />
      <AISection title="Campus One 帳號">
        <AIRow
          title="課程、店家與平台帳號"
          subtitle="和網頁版共用的課程、學校資格與店家權限"
          onPress={go('NuniWorkspace')}
        />
      </AISection>
      <AISection title="學校帳號資料">
        <AICard title={auth.profileLoading ? '正在讀取帳號資料' : '目前登入帳號'}>
          <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>
            {auth.user?.email || profile?.email || '尚未提供電子郵件'}
          </Text>
          {!profile && !auth.profileLoading ? (
            <Text style={{ color: aiTokens.muted, marginTop: 8 }}>
              目前無法讀取個人檔案，請確認登入狀態。
            </Text>
          ) : null}
        </AICard>
        <AIRow title="個人資料" subtitle="修改顯示名稱、簡介與電話" onPress={go('ProfileEdit')} />
      </AISection>
      <AISection title="學習與參與">
        <AIRow
          title="課程與成績"
          subtitle="從已加入的課程查看已發布成績"
          onPress={go('LearnHome')}
        />
        {isStudent && profile ? (
          <AIRow
            title="學分試算"
            subtitle="依你的修課資料檢查畢業條件"
            onPress={go('CreditAuditStack')}
          />
        ) : null}
        <AIRow title="行事曆" subtitle="查看課程時間與自己的安排" onPress={go('Calendar')} />
        <AIRow title="我的群組" subtitle="查看已加入的課程與社團群組" onPress={go('Groups')} />
      </AISection>
      <AISection title="通知與資料">
        <AIRow title="通知設定" onPress={go('NotificationSettings')} />
        <AIRow title="匯出我的資料" subtitle="取得帳號可匯出的資料" onPress={go('DataExport')} />
        <AIRow title="刪除帳號" subtitle="查看刪除範圍與確認步驟" onPress={go('AccountDeletion')} />
      </AISection>
      <AISection title="使用設定">
        <AIRow title="語言" onPress={go('LanguageSettings')} />
        <AIRow title="外觀" subtitle="調整淺色與深色模式" onPress={go('ThemePreview')} />
        <AIRow title="無障礙設定" onPress={go('AccessibilitySettings')} />
        <AIRow title="幫助與回饋" onPress={go('Help')} />
        <AIRow
          title={busy ? '正在登出…' : '登出學校帳號'}
          onPress={busy ? undefined : confirmLogout}
        />
      </AISection>
    </AIScreen>
  );
}
