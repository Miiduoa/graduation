/**
 * Campus AI-First — 成就 V2
 */
import React from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  aiTokens,
} from '../ui/aiFirst';

type Badge = {
  icon: string;
  name: string;
  desc: string;
  unlocked: boolean;
  progress?: { current: number; total: number };
};

const BADGES: Badge[] = [
  { icon: '🏆', name: '初登入', desc: '第一次打開校園 AI', unlocked: true },
  { icon: '⭐', name: '七日連登', desc: '連續 7 天打開 App', unlocked: true },
  { icon: '📚', name: '勤奮學徒', desc: '完成 10 份作業', unlocked: true, progress: { current: 10, total: 10 } },
  { icon: '🎯', name: 'A 等學霸', desc: '一學期 GPA 達 3.8+', unlocked: false, progress: { current: 363, total: 380 } },
  { icon: '🌟', name: '社交達人', desc: '加入 3 個社團', unlocked: false, progress: { current: 2, total: 3 } },
  { icon: '🏛', name: '校園探索者', desc: '簽到 20 個 POI', unlocked: false, progress: { current: 12, total: 20 } },
  { icon: '💬', name: '熱心助教', desc: '回答 5 個討論', unlocked: false, progress: { current: 1, total: 5 } },
  { icon: '🌍', name: '永續校園', desc: '使用環保餐具 30 次', unlocked: false, progress: { current: 5, total: 30 } },
];

export default function AchievementsAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const unlocked = BADGES.filter((b) => b.unlocked).length;

  return (
    <AIDetailScreen
      title="成就 & 徽章"
      subtitle={`已解鎖 ${unlocked} / ${BADGES.length}`}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="你最接近的兩個成就：A 等學霸（差 1.7 分）、社交達人（再加 1 個社團）"
        source="AI · 成就引擎"
        confidence="high"
      />

      {/* XP 卡 */}
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
            opacity: 0.1,
          }}
        />
        <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.4 }}>
          Level 12 學者 · 1,240 XP
        </Text>
        <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 6 }}>
          再 360 XP 升到 Level 13 · 解鎖「A 等學霸」徽章獲 +200 XP
        </Text>
        <View
          style={{
            marginTop: 14,
            height: 8,
            backgroundColor: 'rgba(255,255,255,0.5)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: '78%',
              height: '100%',
              backgroundColor: aiTokens.ai,
            }}
          />
        </View>
      </View>

      <AISection title="已解鎖" subtitle={`${unlocked} 個`}>
        {BADGES.filter((b) => b.unlocked).map((b) => (
          <AIRow
            key={b.name}
            icon={b.icon}
            title={b.name}
            subtitle={b.desc}
            tag="已解鎖"
            tagTone="success"
          />
        ))}
      </AISection>

      <AISection title="進行中" subtitle={`${BADGES.length - unlocked} 個`}>
        {BADGES.filter((b) => !b.unlocked).map((b) => (
          <View key={b.name}>
            <AIRow
              icon={b.icon}
              title={b.name}
              subtitle={`${b.desc}${
                b.progress ? ` · ${b.progress.current} / ${b.progress.total}` : ''
              }`}
              tag={b.progress ? `${Math.round((b.progress.current / b.progress.total) * 100)}%` : '未解鎖'}
              tagTone="muted"
            />
          </View>
        ))}
      </AISection>

      <AISection title="今日 AI 鼓勵">
        <AICard
          aiGenerated
          icon="💪"
          title="你比 73% 同學進度好"
          source="AI · 同班比較"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            這學期已完成 10/12 份作業，平均分 88.4。{'\n'}
            如果保持節奏，期末成績有機會破自己最高紀錄。
          </Text>
        </AICard>
      </AISection>
    </AIDetailScreen>
  );
}
