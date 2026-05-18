/**
 * Campus AI-First — 我的 Tab Landing
 *
 * 設計：個人歷程 + AI 給的洞察 + 隱私控制權
 * 設計規範：docs/design/AI_FIRST_REDESIGN.md
 */
import React, { useCallback } from 'react';
import { Alert, View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AIScreen,
  AIHero,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';
import { rootNavigateNested } from '../app/rootNavigation';

export default function MeAiFirstScreen() {
  const navigation = useNavigation<any>();

  // 在 MeStack 中的 screen 直接 navigate；不在 MeStack 的（成績、課表、社團…）
  // 透過 rootNavigateNested 切到對應 Tab 再帶入子 screen，避免 navigator 找不到 route 報錯。
  const goMe = useCallback(
    (screen: string, params?: Record<string, unknown>) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch (err) {
        console.warn('[MeAiFirst] navigate failed', screen, err);
      }
    },
    [navigation],
  );

  const goLearn = useCallback(
    (screen: string, params?: Record<string, unknown>) => () => {
      rootNavigateNested('學習', screen, params);
    },
    [],
  );

  const goCampus = useCallback(
    (screen: string, params?: Record<string, unknown>) => () => {
      rootNavigateNested('校園', screen, params);
    },
    [],
  );

  const confirmLogout = useCallback(() => {
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '登出',
        style: 'destructive',
        onPress: () => {
          // 真正的登出邏輯（Firebase signOut / Supabase signOut）由各 auth provider 處理；
          // 這裡先導回 SSO 登入畫面避免 UI 卡在已登入狀態。
          try {
            navigation?.navigate?.('SSOLogin' as never);
          } catch {
            // ignore
          }
        },
      },
    ]);
  }, [navigation]);

  return (
    <AIScreen>
      {/* 個人 Hero：頭像 + 身分 */}
      <View
        style={{
          margin: aiTokens.space.md,
          marginTop: aiTokens.space.xl + 16,
          padding: aiTokens.space.lg,
          backgroundColor: aiTokens.aiGradientStart,
          borderRadius: aiTokens.radius.lg,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: aiTokens.ai,
            opacity: 0.08,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: aiTokens.ai,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>王</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.5 }}>
              ME · 我的歷程
            </Text>
            <Text style={{ fontSize: 22, fontWeight: '700', color: aiTokens.text, marginTop: 4 }}>
              王小明
            </Text>
            <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 2 }}>
              資訊管理系 · 大三 · 學號 1099502
            </Text>
          </View>
        </View>

        {/* 統計列 */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: aiTokens.space.lg,
            paddingTop: aiTokens.space.md,
            borderTopWidth: 1,
            borderTopColor: 'rgba(99,102,241,0.15)',
            gap: aiTokens.space.lg,
          }}
        >
          <Stat label="累計 GPA" value="3.63" />
          <Stat label="已修學分" value="78" />
          <Stat label="畢業進度" value="61%" tone="ai" />
        </View>
      </View>

      {/* AI 給我的洞察 */}
      <AISection title="AI 學業洞察" subtitle="基於你 3 學期的資料分析">
        <AICard
          aiGenerated
          icon="🎯"
          title="畢業預測：明年 6 月可順利畢業"
          badge="高信心"
          badgeTone="success"
          source="AI · 學分試算引擎"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            還差 <Text style={{ fontWeight: '700' }}>50 學分</Text>（含必修 24、選修 26）。
            {'\n'}照目前選課速率，預估 113-2 學期完成所有必修。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="完整試算" onPress={goMe('CreditAuditStack')} />
            <AIButton
              label="AI 排我下學期"
              variant="ghost"
              onPress={goLearn('AICourseAdvisor')}
            />
          </View>
        </AICard>

        <AICard
          aiGenerated
          icon="📈"
          title="本學期成績趨勢：上升"
          source="AI · 與上學期比較"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            平均成績從 <Text style={{ fontWeight: '700' }}>85.2 → 88.4</Text>（+3.2）
            {'\n'}強項：演算法、資料庫｜可加強：英文寫作
          </Text>
        </AICard>
      </AISection>

      {/* 學業 */}
      <AISection title="學業">
        <AIRow
          icon="📊"
          title="成績單"
          subtitle="所有歷年成績"
          onPress={goLearn('Grades')}
        />
        <AIRow
          icon="🎓"
          title="學分試算"
          subtitle="畢業進度 61%"
          onPress={goMe('CreditAuditStack')}
        />
        <AIRow
          icon="📅"
          title="課表"
          subtitle="本學期 18 學分"
          onPress={goLearn('Calendar')}
        />
        <AIRow
          icon="📝"
          title="選課歷程"
          subtitle="共 6 學期紀錄"
          onPress={goLearn('AcademicOverview')}
        />
      </AISection>

      {/* 我的活動 */}
      <AISection title="我的參與">
        <AIRow
          icon="🎉"
          title="參加過的活動"
          subtitle="12 場"
          onPress={goMe('Achievements')}
        />
        <AIRow
          icon="👥"
          title="加入的社團"
          subtitle="2 個"
          onPress={goCampus('Clubs')}
        />
        <AIRow
          icon="🏆"
          title="成就 & 徽章"
          subtitle="7 個"
          onPress={goMe('Achievements')}
        />
      </AISection>

      {/* 個人 & 隱私 */}
      <AISection title="個人 & 隱私" subtitle="你對 AI 有完全的控制權">
        <AIRow icon="👤" title="個人資料" onPress={goMe('ProfileEdit')} />
        <AIRow
          icon="🔔"
          title="通知設定"
          onPress={goMe('NotificationSettings')}
        />
        <AIRow
          icon="🤖"
          title="AI 資料政策"
          subtitle="管理 AI 可以看你哪些資料"
          tag="重要"
          tagTone="ai"
          onPress={goMe('Settings')}
        />
        <AIRow
          icon="💾"
          title="匯出我的資料"
          subtitle="GDPR"
          onPress={goMe('DataExport')}
        />
        <AIRow
          icon="🗑"
          title="刪除帳號"
          subtitle="不可逆"
          onPress={goMe('AccountDeletion')}
        />
      </AISection>

      {/* 系統 */}
      <AISection title="系統">
        <AIRow
          icon="🌐"
          title="語言"
          subtitle="繁體中文"
          onPress={goMe('LanguageSettings')}
        />
        <AIRow
          icon="🌙"
          title="深色模式"
          subtitle="跟隨系統"
          onPress={goMe('ThemePreview')}
        />
        <AIRow
          icon="♿"
          title="無障礙設定"
          onPress={goMe('AccessibilitySettings')}
        />
        <AIRow
          icon="📱"
          title="關於"
          subtitle="校園 AI v1.0"
          onPress={goMe('Help')}
        />
        <AIRow icon="🚪" title="登出" onPress={confirmLogout} />
      </AISection>

      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.lg,
          padding: aiTokens.space.md,
          backgroundColor: aiTokens.aiSurface,
          borderRadius: aiTokens.radius.md,
          borderWidth: 1,
          borderColor: aiTokens.aiSoft,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <AIMark size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700' }}>你的資料，你做主</Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
            AI 永遠不會在沒問你的情況下做事
          </Text>
        </View>
      </View>
    </AIScreen>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'ai';
}) {
  return (
    <View>
      <Text style={{ fontSize: 11, color: aiTokens.muted, fontWeight: '600' }}>{label}</Text>
      <Text
        style={{
          fontSize: 22,
          fontWeight: '700',
          color: tone === 'ai' ? aiTokens.ai : aiTokens.text,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
