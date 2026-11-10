import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MESSAGING_NAV_SECTIONS } from '@campus/shared/src/academicSections';
import { AIScreen, AIHero, AISection, AICard, AIRow, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useNuniSession } from '../state/nuniSession';
import { usePermissions } from '../hooks/usePermissions';
import { safeNavigate } from '../utils/safeNavigate';
import { loadFailureCopy } from '../utils/loadFailureCopy';
import { rootNavigateNested } from '../app/rootNavigation';

const NOTIFY_SECTION = MESSAGING_NAV_SECTIONS[0];
const DM_SECTION = MESSAGING_NAV_SECTIONS[1];

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
        eyebrow="CAMPUS ONE"
        title={displayName}
        subtitle={details || '管理帳號、課務資料與個人設定。'}
      />
      <AISection title="Google 帳號">
        <AIRow
          title="課程、店家與 Google 帳號"
          subtitle="和網頁版共用的課程、學校資格與店家權限"
          onPress={go('NuniWorkspace')}
        />
        {platformReady ? (
          <AIRow
            title="開啟課表助理"
            subtitle="用已驗證的 nuni 帳號查這堂課與作業"
            onPress={go('NuniTimetableAssistant')}
          />
        ) : null}
      </AISection>
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
      <AISection title="通知與私訊">
        <AIRow
          title={NOTIFY_SECTION.label}
          subtitle="作業、系統與服務通知"
          onPress={go(NOTIFY_SECTION.mobileScreen)}
        />
        <AIRow
          title={DM_SECTION.label}
          subtitle="與同學、老師的對話"
          onPress={() => rootNavigateNested(DM_SECTION.mobileTab, DM_SECTION.mobileScreen)}
        />
        <AIRow
          title="找人"
          subtitle="加好友後才能看對方課表"
          onPress={() => rootNavigateNested('訊息', 'FriendSearch')}
        />
      </AISection>
      <AISection title="課務與生活">
        <AIRow
          title="課表"
          subtitle="一週、單日、匯入與空堂"
          onPress={() => rootNavigateNested('學習', 'PersonalTimetable')}
        />
        <AIRow
          title="課程與成績"
          subtitle="從已加入的課程查看已發布成績"
          onPress={go('LearnHome')}
        />
        {isStudent && profile ? (
          <AIRow
            title="學分規劃"
            subtitle="依你的修課資料檢查畢業條件"
            onPress={go('CreditAuditStack')}
          />
        ) : null}
        <AIRow title="行事曆" subtitle="查看課程時間與自己的安排" onPress={go('Calendar')} />
        <AIRow title="我的群組" subtitle="查看已加入的課程與社團群組" onPress={go('Groups')} />
      </AISection>
      <AISection title="資料與通知設定">
        <AIRow title="通知設定" onPress={go('NotificationSettings')} />
        <AIRow title="匯出我的資料" subtitle="取得帳號可匯出的資料" onPress={go('DataExport')} />
        <AIRow title="刪除帳號" subtitle="查看刪除範圍與確認步驟" onPress={go('AccountDeletion')} />
      </AISection>
      <AISection title="使用設定">
        <AIRow title="語言" onPress={go('LanguageSettings')} />
        <AIRow title="外觀" subtitle="調整淺色與深色模式" onPress={go('Settings')} />
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
