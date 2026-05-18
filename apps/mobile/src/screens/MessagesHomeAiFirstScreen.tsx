/**
 * Campus AI-First — 訊息對話列表 V2（私訊 + 群組）
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIChip,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

type Filter = 'all' | 'unread' | 'private' | 'group';

export default function MessagesHomeAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <AIDetailScreen
      title="訊息"
      subtitle="5 個未讀 · 12 個對話"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="5 個未讀中有 1 個重要：林助教問你週三能不能幫忙。其他都是社團群組訊息"
        source="AI · 對話重要性"
        confidence="high"
      />

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
        }}
      >
        <AIChip label="全部 12" active={filter === 'all'} onPress={() => setFilter('all')} />
        <AIChip label="未讀 5" active={filter === 'unread'} onPress={() => setFilter('unread')} />
        <AIChip label="私訊 7" active={filter === 'private'} onPress={() => setFilter('private')} />
        <AIChip label="群組 5" active={filter === 'group'} onPress={() => setFilter('group')} />
      </View>

      <AISection title="📌 釘選">
        <AIRow icon="👨‍🏫" title="林助教" subtitle="週三辦公室時間調整..." tag="重要" tagTone="danger" />
      </AISection>

      <AISection title="未讀">
        <AIRow icon="👥" title="程式設計社" subtitle="陳社長：黑客松要組隊嗎" tag="3" tagTone="ai" />
        <AIRow icon="👥" title="專題小組" subtitle="王同學分享了一個檔案" tag="1" tagTone="ai" />
        <AIRow icon="👤" title="陳老師" subtitle="期末報告延長至下週五" tag="1" tagTone="warning" />
      </AISection>

      <AISection title="所有對話">
        <AIRow icon="👤" title="李同學" subtitle="作業系統的範例答案我傳給你了" />
        <AIRow icon="👥" title="資料庫小組" subtitle="今晚 7 點工程館 308" />
        <AIRow icon="👤" title="黃同學" subtitle="明天約咖啡？" />
        <AIRow icon="👥" title="資管 109 級" subtitle="畢業旅行投票..." />
        <AIRow icon="👤" title="媽媽" subtitle="記得這週末回家吃飯" />
        <AIRow icon="👥" title="校友群" subtitle="校友聚餐報名..." />
        <AIRow icon="👤" title="張同學" subtitle="" />
      </AISection>

      <AILegacyLink
        label="完整訊息工作台（含未讀統計、批次操作）"
        onPress={() => navigation?.navigate?.('InboxLegacy' as never)}
      />
    </AIDetailScreen>
  );
}
