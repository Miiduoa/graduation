/**
 * Campus AI-First — 設定 V2
 */
import React, { useCallback } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AISection,
  AIRow,
  AILegacyLink,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';

export default function SettingsAiFirstScreen(props: any) {
  const navigation = props?.navigation;

  const go = useCallback(
    (screen: string, params?: Record<string, unknown>) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch (err) {
        console.warn('[SettingsAiFirst] navigate failed', screen, err);
      }
    },
    [navigation],
  );

  const todo = useCallback(
    (label: string, desc?: string) => () => {
      Alert.alert(label, desc ?? '此功能規格已定，後端串接中。');
    },
    [],
  );

  const confirmDestructive = useCallback(
    (label: string, msg: string, after?: () => void) => () => {
      Alert.alert(label, msg, [
        { text: '取消', style: 'cancel' },
        {
          text: label,
          style: 'destructive',
          onPress: after ?? (() => {}),
        },
      ]);
    },
    [],
  );

  return (
    <AIDetailScreen title="設定" onBack={() => navigation?.goBack?.()}>
      {/* AI 控制特別凸出 */}
      <View
        style={{
          margin: aiTokens.space.md,
          padding: aiTokens.space.lg,
          backgroundColor: aiTokens.aiSurface,
          borderRadius: aiTokens.radius.lg,
          borderWidth: 1,
          borderColor: aiTokens.aiSoft,
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <AIMark size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.4 }}>
            AI 控制中心
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: aiTokens.text, marginTop: 4 }}>
            你的資料，你做主
          </Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 4 }}>
            選擇 AI 能看哪些資料，能做哪些事
          </Text>
        </View>
      </View>

      {/* AI & 隱私 */}
      <AISection title="AI & 隱私">
        <AIRow
          icon="🤖"
          title="AI 可使用的資料"
          subtitle="課表、成績、訊息、地點…"
          tag="開啟中"
          tagTone="ai"
          onPress={todo('AI 可使用的資料', '在此切換 AI 對課表、成績、訊息等資料的存取權。')}
        />
        <AIRow
          icon="🛡"
          title="AI 自動執行"
          subtitle="預設關閉 · 任何動作都先問你"
          tag="關閉"
          tagTone="muted"
          onPress={todo('AI 自動執行', '預設關閉。開啟後 AI 才會在你授權的範圍內自動執行動作。')}
        />
        <AIRow
          icon="💾"
          title="清空 AI 對話歷史"
          subtitle="不可逆"
          onPress={confirmDestructive('清空 AI 對話歷史', '所有 AI 對話將被永久刪除，這個動作無法復原。')}
        />
        <AIRow
          icon="📤"
          title="匯出我的 AI 資料"
          subtitle="GDPR 合規"
          onPress={go('DataExport')}
        />
      </AISection>

      {/* 通知 */}
      <AISection title="通知">
        <AIRow
          icon="🔔"
          title="推播通知"
          tag="開啟"
          tagTone="success"
          onPress={go('NotificationSettings')}
        />
        <AIRow
          icon="⏰"
          title="上課前提醒"
          subtitle="10 分鐘前"
          onPress={go('NotificationSettings', { focus: 'class' })}
        />
        <AIRow
          icon="📅"
          title="作業截止提醒"
          subtitle="6 小時前"
          onPress={go('NotificationSettings', { focus: 'assignment' })}
        />
        <AIRow
          icon="🌙"
          title="勿擾時段"
          subtitle="23:00 – 07:00"
          onPress={go('NotificationSettings', { focus: 'dnd' })}
        />
      </AISection>

      {/* 外觀 */}
      <AISection title="外觀">
        <AIRow
          icon="🎨"
          title="主題"
          subtitle="跟隨系統"
          onPress={go('ThemePreview')}
        />
        <AIRow
          icon="🔠"
          title="字體大小"
          subtitle="標準"
          onPress={go('AccessibilitySettings')}
        />
        <AIRow
          icon="🌐"
          title="語言"
          subtitle="繁體中文"
          onPress={go('LanguageSettings')}
        />
        <AIRow
          icon="♿"
          title="無障礙"
          subtitle="動畫減量、高對比"
          onPress={go('AccessibilitySettings')}
        />
      </AISection>

      {/* 帳號 */}
      <AISection title="帳號">
        <AIRow icon="👤" title="個人資料" onPress={go('ProfileEdit')} />
        <AIRow
          icon="🔑"
          title="變更密碼"
          onPress={todo('變更密碼', '請至 SSO 入口或學校系統變更。')}
        />
        <AIRow
          icon="📱"
          title="綁定裝置"
          subtitle="2 台"
          onPress={todo('綁定裝置', '查看 / 移除已綁定的裝置。')}
        />
        <AIRow
          icon="🔗"
          title="社交帳號"
          subtitle="Google · 已連結"
          onPress={todo('社交帳號', '管理 Google / Apple 等社交帳號的連結。')}
        />
      </AISection>

      {/* 資料 */}
      <AISection title="資料">
        <AIRow
          icon="🔄"
          title="同步"
          subtitle="自動 · 上次 09:43"
          onPress={todo('資料同步', '已開啟自動同步，最近一次同步：09:43。')}
        />
        <AIRow
          icon="🗑"
          title="清除快取"
          subtitle="32 MB"
          onPress={confirmDestructive(
            '清除快取',
            '會釋放約 32 MB 空間，下次開啟需重新載入。',
          )}
        />
        <AIRow
          icon="📦"
          title="離線資料"
          subtitle="課表、地圖、菜單"
          onPress={todo('離線資料', '管理可離線使用的資料範圍。')}
        />
      </AISection>

      {/* 關於 */}
      <AISection title="關於">
        <AIRow
          icon="ℹ️"
          title="關於校園 AI"
          subtitle="v1.0 · build 2026.05"
          onPress={go('Help')}
        />
        <AIRow icon="📄" title="服務條款" onPress={go('Help', { tab: 'terms' })} />
        <AIRow icon="🔒" title="隱私政策" onPress={go('Help', { tab: 'privacy' })} />
        <AIRow icon="✉️" title="意見回饋" onPress={go('Feedback')} />
      </AISection>

      {/* 危險區 */}
      <AISection title="危險區" subtitle="這些動作影響重大">
        <AIRow
          icon="🚪"
          title="登出"
          onPress={confirmDestructive('登出', '確定要登出嗎？', () => {
            try {
              navigation?.navigate?.('SSOLogin' as never);
            } catch {
              // ignore
            }
          })}
        />
        <AIRow
          icon="❌"
          title="刪除帳號"
          subtitle="不可逆"
          tag="慎用"
          tagTone="danger"
          onPress={go('AccountDeletion')}
        />
      </AISection>

      <AILegacyLink label="開發者選項 / 進階" onPress={() => navigation?.navigate?.('SettingsLegacy' as never)} />
    </AIDetailScreen>
  );
}
