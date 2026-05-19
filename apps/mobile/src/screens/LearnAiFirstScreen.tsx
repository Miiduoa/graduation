/**
 * Campus AI-First — 學習 Tab Landing
 *
 * 設計：AI 主動把今天的學習任務排好給你（不只是課表清單）
 * 設計規範：docs/design/AI_FIRST_REDESIGN.md §4 Slot Cards
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AIScreen,
  AIHero,
  AIHero as _AIH,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';

export default function LearnAiFirstScreen() {
  const navigation = useNavigation<any>();

  return (
    <AIScreen>
      <AIHero
        eyebrow="LEARN · 學習中心"
        title={'今天 3 堂課\n2 份作業要繳'}
        subtitle="AI 已幫你按截止日排好優先順序"
      />

      {/* AI 主動建議 */}
      <AISection title="AI 為你準備" subtitle="基於你的進度、習慣、截止時間">
        <AICard
          aiGenerated
          icon="🎯"
          title="今日專注建議：先做 Lab 3"
          badge="高優先"
          badgeTone="danger"
          source="AI · 即時運算"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            作業系統 Lab 3 週三 23:59 截止，進度 <Text style={{ fontWeight: '700' }}>0%</Text>。
            預估需 4 小時，建議今晚 19:00–23:00 完成。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <AIButton label="進入作業" icon="📖" />
            <AIButton label="排到行事曆" variant="ghost" />
            <AIButton label="找同學討論" variant="ghost" />
          </View>
        </AICard>

        <AICard
          aiGenerated
          icon="💡"
          title="複習：上週資料結構 — 雜湊表"
          source="AI · 從你筆記分析"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            你週四小考會考雜湊。我把上週四節課的重點整理成 5 分鐘速覽。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="開始 5 分鐘速覽" icon="⚡" />
            <AIButton label="跳過" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      {/* 今日課程 */}
      <AISection title="今日課程" subtitle="週一 · 共 3 堂">
        <AIRow
          icon="📐"
          title="資料結構"
          subtitle="09:10–10:50 · 工程館 302 · 王大明"
          tag="下節"
          tagTone="ai"
          onPress={() => navigation.navigate?.('AcademicStack' as never)}
        />
        <AIRow
          icon="🗄"
          title="資料庫系統"
          subtitle="13:10–14:50 · 工程館 305 · 陳老師"
          tag="13:10"
          tagTone="muted"
        />
        <AIRow
          icon="📊"
          title="統計學"
          subtitle="15:10–16:50 · 商學館 401"
          tag="15:10"
          tagTone="muted"
        />
      </AISection>

      {/* 作業 */}
      <AISection
        title="作業 & 截止"
        subtitle="本週共 4 件"
        action={
          <AIButton label="全部" variant="ghost" size="sm" />
        }
      >
        <AIRow
          icon="📝"
          title="作業系統 Lab 3"
          subtitle="週三 23:59 · 進度 0%"
          tag="未開始"
          tagTone="warning"
        />
        <AIRow
          icon="📝"
          title="專題期中報告"
          subtitle="週五 14:00 · 進度 60%"
          tag="進行中"
          tagTone="ai"
        />
        <AIRow
          icon="✍️"
          title="英文週記"
          subtitle="週日 23:59"
          tag="待開始"
          tagTone="muted"
        />
        <AIRow
          icon="📝"
          title="資料庫小考準備"
          subtitle="週四 09:00"
          tag="已準備"
          tagTone="success"
        />
      </AISection>

      {/* AI 工具入口 */}
      <AISection title="AI 學習工具">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: aiTokens.space.md }}>
          <AIChip label="AI 課程顧問" />
          <AIChip label="共讀夥伴" />
          <AIChip label="筆記摘要" />
          <AIChip label="考前重點生成" />
          <AIChip label="作業解題引導" />
        </View>
      </AISection>

      {/* 行動進入點 */}
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
          <Text style={{ fontSize: 13, fontWeight: '700', color: aiTokens.text }}>
            想找特定資料？
          </Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
            點下方 ✨ AI 球用講的：「期中考範圍」「老師上週說過什麼」
          </Text>
        </View>
      </View>
    </AIScreen>
  );
}
