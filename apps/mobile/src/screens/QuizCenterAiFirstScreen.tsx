/**
 * Campus AI-First — 測驗中心 V2
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

export default function QuizCenterAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const go = useCallback(
    (id: string) => () => {
      try {
        navigation?.navigate?.('QuizTaking' as never, { quizId: id } as never);
      } catch {}
    },
    [navigation],
  );

  return (
    <AIDetailScreen
      title="測驗中心"
      subtitle="3 個未做 · 5 個歷史"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="週四資料庫小考 AI 已準備 12 題模擬題 · 上次小考你錯 3 題（索引、正規化）→ 強化練習已生成"
        source="AI · 你的錯題紀錄"
        confidence="high"
      />

      <AISection title="即將到來" subtitle="3 場">
        <AICard
          aiGenerated
          icon="📝"
          title="資料庫小考"
          badge="週四 09:00"
          badgeTone="warning"
          source="陳老師 · 範圍 第 9-10 章"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            模擬考已準備 · 12 題（涵蓋你上次錯的索引、正規化）{'\n'}
            預估你目前準備度：<Text style={{ fontWeight: '700', color: aiTokens.success }}>72%</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="開始模擬考" onPress={go('q-mock-001')} />
            <AIButton label="只看重點" variant="ghost" />
          </View>
        </AICard>

        <AIRow icon="🎯" title="作業系統期中" subtitle="6/05 09:00 · 第 1-7 章" tag="3 週" tagTone="muted" />
        <AIRow icon="📋" title="統計學線上測驗" subtitle="本週可做 · 限時 30 分鐘" tag="可做" tagTone="ai" onPress={go('q-stat-001')} />
      </AISection>

      <AISection title="AI 練習" subtitle="不限時、可重複">
        <AIRow icon="🧠" title="資料結構 — 樹與圖" subtitle="20 題 · 上次 18/20" tag="精熟" tagTone="success" onPress={go('q-prac-001')} />
        <AIRow icon="🧠" title="資料庫 — 索引與優化" subtitle="15 題 · 你的弱項" tag="建議" tagTone="warning" onPress={go('q-prac-002')} />
        <AIRow icon="🧠" title="統計 — 信賴區間" subtitle="12 題" onPress={go('q-prac-003')} />
      </AISection>

      <AISection title="錯題本">
        <AICard icon="📓" title="本學期錯題 32 題">
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            其中 5 題已重複錯過 2 次（建議重點複習）
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="重做高頻錯題" onPress={() => Alert.alert('AI 出題', '從 5 題重複錯題生成練習')} />
            <AIButton label="查看全部" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      <AISection title="歷史測驗">
        <AIRow icon="📊" title="資料庫第二次小考" subtitle="5/02 · 17/20" tag="85" tagTone="ai" />
        <AIRow icon="📊" title="統計學期中" subtitle="4/28 · 92/100" tag="92" tagTone="success" />
      </AISection>

      <AILegacyLink label="完整測驗系統" onPress={() => navigation?.navigate?.('QuizCenterLegacy' as never)} />
    </AIDetailScreen>
  );
}
