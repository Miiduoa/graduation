/**
 * Campus AI-First — 公車時刻 V2
 */
import React, { useState } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIChip,
  AIButton,
  aiTokens,
} from '../ui/aiFirst';

export default function BusAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [route, setRoute] = useState<'a' | 'b' | 'c'>('a');

  return (
    <AIDetailScreen
      title="校園公車"
      subtitle="下班 14:20"
      onBack={() => navigation?.goBack?.()}
    >
      {/* 即時下班 */}
      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
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
          下班公車
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6, gap: 6 }}>
          <Text style={{ fontSize: 48, fontWeight: '700', color: aiTokens.text }}>14:20</Text>
          <Text style={{ fontSize: 14, color: aiTokens.muted, marginLeft: 8 }}>還有 32 分鐘</Text>
        </View>
        <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 6 }}>
          A 路線 · 校門口 → 火車站 · 約 12 分鐘到達
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <AIButton label="設定提醒" icon="⏰" onPress={() => Alert.alert('已設定提醒', '14:10 會提醒你前往校門口站牌。')} />
          <AIButton label="即時位置" variant="ghost" onPress={() => navigation?.navigate?.('OnBusMode' as never, { route } as never)} />
        </View>
      </View>

      <AIInsightBanner
        text="你 5/15 (週四) 17:30 課後常坐 B 路線回家。今天週一 18:00 後 B 路線只剩 2 班，建議改 A 接捷運"
        source="AI · 你的乘車紀錄"
        confidence="mid"
      />

      {/* 路線切換 */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <AIChip label="A · 火車站" active={route === 'a'} onPress={() => setRoute('a')} />
        <AIChip label="B · 捷運" active={route === 'b'} onPress={() => setRoute('b')} />
        <AIChip label="C · 中山路" active={route === 'c'} onPress={() => setRoute('c')} />
      </View>

      <AISection title={`${route.toUpperCase()} 路線 · 今日班次`} subtitle="● 已過 ◯ 未到">
        <AIRow icon="●" title="13:00" subtitle="校門口 → 火車站" tag="已過" tagTone="muted" disabled />
        <AIRow icon="●" title="13:40" subtitle="校門口 → 火車站" tag="已過" tagTone="muted" disabled />
        <AIRow
          icon="◯"
          title="14:20"
          subtitle="校門口 → 火車站"
          tag="下班 32 min"
          tagTone="ai"
          onPress={() => Alert.alert('已設定提醒', '14:10 會提醒你搭 14:20 班次。')}
        />
        <AIRow icon="◯" title="15:00" subtitle="校門口 → 火車站" onPress={() => Alert.alert('已設定提醒', '14:50 會提醒你搭 15:00 班次。')} />
        <AIRow icon="◯" title="15:40" subtitle="校門口 → 火車站" onPress={() => Alert.alert('已設定提醒', '15:30 會提醒你搭 15:40 班次。')} />
        <AIRow icon="◯" title="16:20" subtitle="校門口 → 火車站" onPress={() => Alert.alert('已設定提醒', '16:10 會提醒你搭 16:20 班次。')} />
        <AIRow icon="◯" title="17:00" subtitle="校門口 → 火車站" tag="尖峰" tagTone="warning" onPress={() => Alert.alert('已設定提醒', '16:50 會提醒你搭 17:00 班次。')} />
        <AIRow icon="◯" title="17:40" subtitle="校門口 → 火車站" tag="尖峰" tagTone="warning" onPress={() => Alert.alert('已設定提醒', '17:30 會提醒你搭 17:40 班次。')} />
      </AISection>

      <AISection title="路線地圖">
        <View
          style={{
            marginHorizontal: aiTokens.space.md,
            height: 200,
            borderRadius: aiTokens.radius.lg,
            backgroundColor: aiTokens.aiGradientStart,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 64 }}>🗺</Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 8 }}>
            校門口 → 圖書館 → 學餐 → 體育館 → 後門 → 火車站
          </Text>
        </View>
      </AISection>
    </AIDetailScreen>
  );
}
