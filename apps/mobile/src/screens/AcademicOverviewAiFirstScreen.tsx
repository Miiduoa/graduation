/**
 * Campus AI-First — 學業總覽 V2
 */
import React, { useCallback } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';
import { usePermissions } from '../hooks/usePermissions';

export default function AcademicOverviewAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const { isStudent } = usePermissions();
  const go = useCallback(
    (screen: string, params?: any) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch {
        Alert.alert('導航失敗', `找不到 ${screen}，可能尚未實作`);
      }
    },
    [navigation],
  );

  return (
    <AIDetailScreen
      title="學業總覽"
      subtitle="本學期 113-2 · 18 學分"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="本學期至 5/18 平均 88.4 分（+3.2 vs 上學期）· 期末預估 GPA 可達 3.78 · 強項：演算法 / 資料庫"
        source="AI · 學業引擎"
        confidence="high"
      />

      <AISection title="本學期概況">
        <View
          style={{
            marginHorizontal: aiTokens.space.md,
            padding: aiTokens.space.lg,
            backgroundColor: aiTokens.surface,
            borderRadius: aiTokens.radius.lg,
            borderWidth: 1,
            borderColor: aiTokens.border,
            flexDirection: 'row',
            gap: aiTokens.space.lg,
          }}
        >
          <Stat label="修課" value="6" sub="門" />
          <Stat label="學分" value="18" />
          <Stat label="平均" value="88.4" tone="ai" />
          <Stat label="出席率" value="96%" tone="success" />
        </View>
      </AISection>

      <AISection title="AI 學業建議">
        <AICard
          aiGenerated
          icon="🎯"
          title="集中火力在英文寫作"
          source="AI · 學科分析"
          confidence="mid"
          badge="本週重點"
          badgeTone="warning"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            英文寫作目前 80 分，是本學期最低。期末作文佔 40%，AI 預估再投入 +30% 時間可拿到 B+。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="找寫作中心" onPress={go('CampusMap', { type: 'writing-center' })} />
            <AIButton label="範文閱讀" variant="ghost" onPress={() => Alert.alert('範文閱讀', '已彙整 12 篇 A 等範文')} />
          </View>
        </AICard>
      </AISection>

      <AISection title="本學期課程">
        <AIRow icon="📐" title="資料結構" subtitle="王大明 · 92 分 · A" tag="92" tagTone="success" onPress={go('CourseHub', { courseId: 'CS301' })} />
        <AIRow icon="🗄" title="資料庫系統" subtitle="陳老師 · 88 分 · A-" tag="88" tagTone="ai" onPress={go('CourseHub', { courseId: 'CS302' })} />
        <AIRow icon="💾" title="作業系統" subtitle="林老師 · 85 分 · B+" tag="85" tagTone="ai" onPress={go('CourseHub', { courseId: 'CS304' })} />
        <AIRow icon="📊" title="統計學" subtitle="黃老師 · 90 分 · A" tag="90" tagTone="success" onPress={go('CourseHub', { courseId: 'MATH201' })} />
        <AIRow icon="✍️" title="英文寫作" subtitle="Tom · 80 分 · B" tag="80" tagTone="warning" onPress={go('CourseHub', { courseId: 'ENG201' })} />
        <AIRow icon="🎯" title="專題討論" subtitle="王老師 · 進行中" tag="進行中" tagTone="muted" onPress={go('CourseHub', { courseId: 'CS499' })} />
      </AISection>

      <AISection title="歷年成績">
        <AIRow icon="📅" title="113-1 學期" subtitle="6 門 · 18 學分" tag="GPA 3.55" tagTone="muted" onPress={go('Grades', { term: '113-1' })} />
        <AIRow icon="📅" title="112-2 學期" subtitle="7 門 · 21 學分" tag="GPA 3.62" tagTone="muted" onPress={go('Grades', { term: '112-2' })} />
        <AIRow icon="📅" title="112-1 學期" subtitle="6 門 · 19 學分" tag="GPA 3.68" tagTone="muted" onPress={go('Grades', { term: '112-1' })} />
      </AISection>

      <AISection title="快速入口">
        {isStudent && (
          <AIRow icon="🎓" title="學分試算" subtitle="畢業進度 61%" onPress={go('CreditAudit')} />
        )}
        <AIRow icon="📅" title="課表" onPress={go('Calendar')} />
        <AIRow icon="🤖" title="AI 課程顧問" subtitle="幫你排下學期" tag="AI" tagTone="ai" onPress={go('AICourseAdvisor')} />
      </AISection>

      <AILegacyLink label="完整學業檢視（含教評、評量、申訴）" onPress={() => navigation?.navigate?.('AcademicLegacy' as never)} />
    </AIDetailScreen>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ai' | 'success';
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 11, color: aiTokens.muted, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            color: tone === 'ai' ? aiTokens.ai : tone === 'success' ? aiTokens.success : aiTokens.text,
          }}
        >
          {value}
        </Text>
        {sub ? <Text style={{ fontSize: 11, color: aiTokens.muted }}>{sub}</Text> : null}
      </View>
    </View>
  );
}
