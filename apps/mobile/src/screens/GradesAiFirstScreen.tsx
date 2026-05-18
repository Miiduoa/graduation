/**
 * Campus AI-First — 成績單 V2
 */
import React from 'react';
import { View, Text } from 'react-native';
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

export default function GradesAiFirstScreen(props: any) {
  const navigation = props?.navigation;

  return (
    <AIDetailScreen
      title="我的成績"
      subtitle="累計 GPA 3.63 · 已修 78 學分"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="本學期成績趨勢上升（+3.2 平均），預估期末 GPA 可到 3.70。強項：演算法、資料庫｜可加強：英文寫作"
        source="AI · 與上學期比較"
        confidence="high"
      />

      {/* GPA 卡 */}
      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
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
        <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.4 }}>
          累計 GPA
        </Text>
        <Text style={{ fontSize: 48, fontWeight: '700', color: aiTokens.text, marginTop: 4 }}>3.63</Text>
        <Text style={{ fontSize: 12, color: aiTokens.success, marginTop: 4 }}>↑ 較上學期 +0.12</Text>
        <View style={{ flexDirection: 'row', marginTop: 16, gap: 24 }}>
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>已修</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: aiTokens.text, marginTop: 2 }}>78 學分</Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>系排名</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: aiTokens.text, marginTop: 2 }}>15 / 89</Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>畢業</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: aiTokens.ai, marginTop: 2 }}>61%</Text>
          </View>
        </View>
      </View>

      {/* AI 洞察 */}
      <AISection title="AI 學業洞察">
        <AICard
          aiGenerated
          icon="📈"
          title="本學期趨勢"
          source="AI · 截至 5/18"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            平均分數 <Text style={{ fontWeight: '700' }}>85.2 → 88.4</Text>（+3.2）{'\n'}
            預期班排名：前 <Text style={{ fontWeight: '700' }}>17%</Text>
          </Text>
        </AICard>

        <AICard
          aiGenerated
          icon="🎯"
          title="期末 GPA 預測"
          badge="預測"
          badgeTone="ai"
          source="AI · 機器學習模型"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            最佳情境：<Text style={{ fontWeight: '700', color: aiTokens.success }}>3.78</Text>{'\n'}
            最差情境：<Text style={{ fontWeight: '700', color: aiTokens.warning }}>3.55</Text>{'\n'}
            建議：英文寫作期末報告投入時間 +30%
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="AI 排讀書計畫" />
            <AIButton label="找學長姐筆記" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      {/* 本學期成績 */}
      <AISection title="本學期 · 113-2" subtitle="6 門課 · 18 學分">
        <AIRow icon="📐" title="資料結構" subtitle="王大明 · 3 學分" tag="A 92" tagTone="success" />
        <AIRow icon="🗄" title="資料庫系統" subtitle="陳老師 · 3 學分" tag="A- 88" tagTone="ai" />
        <AIRow icon="💾" title="作業系統" subtitle="林老師 · 3 學分" tag="B+ 85" tagTone="ai" />
        <AIRow icon="📊" title="統計學" subtitle="黃老師 · 3 學分" tag="A 90" tagTone="success" />
        <AIRow icon="✍️" title="英文寫作" subtitle="Tom · 3 學分" tag="B 80" tagTone="warning" />
        <AIRow icon="🎯" title="專題討論" subtitle="王老師 · 3 學分" tag="進行中" tagTone="muted" />
      </AISection>

      {/* 歷年 */}
      <AISection title="歷年成績">
        <AIRow icon="📅" title="113-1 學期" subtitle="6 門 · 18 學分" tag="GPA 3.55" tagTone="muted" />
        <AIRow icon="📅" title="112-2 學期" subtitle="7 門 · 21 學分" tag="GPA 3.62" tagTone="muted" />
        <AIRow icon="📅" title="112-1 學期" subtitle="6 門 · 19 學分" tag="GPA 3.68" tagTone="muted" />
      </AISection>

      <AILegacyLink
        label="完整成績單 / 學分試算 / 申請官方文件"
        onPress={() => navigation?.navigate?.('GradesLegacy' as never)}
      />
    </AIDetailScreen>
  );
}
