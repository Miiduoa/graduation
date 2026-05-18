/**
 * Campus AI-First — 訊息 Tab Landing
 *
 * 設計：AI 自動分類訊息 + 重點摘要 + 建議回覆
 * 設計規範：docs/design/AI_FIRST_REDESIGN.md
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import {
  AIScreen,
  AIHero,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';

type Filter = 'all' | 'urgent' | 'class' | 'admin' | 'social';

export default function MessagesAiFirstScreen() {
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <AIScreen>
      <AIHero
        eyebrow="MESSAGES · 訊息收件匣"
        title={'7 則新訊息\n2 則需要你回覆'}
        subtitle="AI 已分類整理 · 系辦公告、課程通知、社團、私訊"
      />

      {/* AI 摘要 */}
      <AISection title="AI 今日摘要" subtitle="把重要的事先告訴你">
        <AICard
          aiGenerated
          icon="✨"
          title="今天 3 件你應該知道的事"
          source="AI · 從 7 則訊息整理"
          confidence="high"
        >
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700', color: aiTokens.danger }}>1.</Text>{' '}
              <Text style={{ fontWeight: '600' }}>陳老師延長期末報告繳交</Text> 至下週五（要回覆已讀）
            </Text>
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700', color: aiTokens.warning }}>2.</Text>{' '}
              <Text style={{ fontWeight: '600' }}>系辦獎學金申請</Text> 5/25 截止（要不要我幫你填？）
            </Text>
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700', color: aiTokens.ai }}>3.</Text>{' '}
              <Text style={{ fontWeight: '600' }}>程式設計社</Text> 黑客松報名截止剩 2 天
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <AIButton label="一鍵已讀" icon="✓" />
            <AIButton label="幫我回覆" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      {/* Filter chips */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <AIChip label="全部 7" onPress={() => setFilter('all')} active={filter === 'all'} />
        <AIChip label="緊急 2" onPress={() => setFilter('urgent')} active={filter === 'urgent'} />
        <AIChip label="課程 3" onPress={() => setFilter('class')} active={filter === 'class'} />
        <AIChip label="系辦 1" onPress={() => setFilter('admin')} active={filter === 'admin'} />
        <AIChip label="社團 1" onPress={() => setFilter('social')} active={filter === 'social'} />
      </View>

      {/* Message list */}
      <AISection title="收件匣" subtitle="依重要性排序，非時間">
        <AIRow
          icon="🔴"
          title="陳老師（資料庫）"
          subtitle="期末報告延長至下週五，請已讀..."
          tag="待回覆"
          tagTone="danger"
        />
        <AIRow
          icon="🟠"
          title="系辦公告"
          subtitle="獎學金申請開放 · 5/25 截止"
          tag="重要"
          tagTone="warning"
        />
        <AIRow
          icon="🟣"
          title="程式設計社 · 陳社長"
          subtitle="黑客松招募中，要不要組隊？"
          tag="本週"
          tagTone="ai"
        />
        <AIRow
          icon="📚"
          title="LMS — 資料結構"
          subtitle="王老師上傳了 Lab 3 範例答案"
        />
        <AIRow
          icon="📚"
          title="LMS — 統計學"
          subtitle="新教材：信賴區間範例"
        />
        <AIRow
          icon="👥"
          title="林助教"
          subtitle="本週辦公室時間調整為 Wed 14:00"
        />
        <AIRow
          icon="🎓"
          title="教務處"
          subtitle="選課加退選結果已公告"
        />
      </AISection>

      {/* AI 建議回覆 */}
      <AISection title="AI 建議回覆" subtitle="點一下就送出（仍需你最後確認）">
        <AICard
          aiGenerated
          icon="✍️"
          title="回 陳老師（資料庫）"
          source="AI 根據你過往語氣生成"
          confidence="mid"
        >
          <View
            style={{
              padding: 10,
              backgroundColor: aiTokens.panel,
              borderRadius: aiTokens.radius.sm,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 18 }}>
              老師您好，謝謝您的延長通知，我會在新的截止前完成。祝週末愉快！
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AIButton label="送出" icon="↗" />
            <AIButton label="編輯" variant="ghost" />
            <AIButton label="不要這版" variant="danger" />
          </View>
        </AICard>
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
          <Text style={{ fontSize: 13, fontWeight: '700' }}>找特定訊息？</Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
            「上週老師說的期中範圍」「黑客松的時間」
          </Text>
        </View>
      </View>
    </AIScreen>
  );
}
