/**
 * Campus AI-First — 加退選 V2
 */
import React, { useCallback, useState } from 'react';
import { Alert, View, Text, TextInput, StyleSheet } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function AddCourseAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'search' | 'my' | 'wait'>('search');

  const handleAdd = useCallback((name: string) => {
    Alert.alert(`加選「${name}」？`, '系統會檢查衝堂與先修課', [
      { text: '取消', style: 'cancel' },
      { text: '確認加選', onPress: () => Alert.alert('已送出', '等待 24h 內審核結果') },
    ]);
  }, []);

  return (
    <AIDetailScreen
      title="加退選"
      subtitle="第二週 · 5/25 截止"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="本學期可加退選額度：剩 2 門 · AI 發現你的星期五全空，建議加 1 門選修平衡課表"
        source="AI · 你的課表分析"
        confidence="mid"
      />

      {/* 搜尋框 */}
      <View style={searchStyles.searchWrap}>
        <TextInput
          style={searchStyles.search}
          placeholder="搜尋課名 / 老師 / 課號"
          placeholderTextColor={aiTokens.muted}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={{ position: 'absolute', right: 24, top: 16, fontSize: 18 }}>🔍</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: aiTokens.space.md, marginTop: 8 }}>
        <AIChip label="搜尋" active={tab === 'search'} onPress={() => setTab('search')} />
        <AIChip label="我的選課" active={tab === 'my'} onPress={() => setTab('my')} />
        <AIChip label="候補中 2" active={tab === 'wait'} onPress={() => setTab('wait')} />
      </View>

      {tab === 'search' && (
        <>
          <AISection title="✨ AI 為你推薦" subtitle="基於必修缺口 + 興趣">
            <AICard
              aiGenerated
              icon="📚"
              title="軟體工程（CS401）"
              badge="缺必修"
              badgeTone="danger"
              source="AI · 必修分析"
              confidence="high"
            >
              <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
                陳老師 · 週五 09:10–12:00 · 工程館 305 · 3 學分{'\n'}
                ⚠ 是「資料庫系統」的延伸，建議下學期前修完
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <AIButton label="加選" onPress={() => handleAdd('軟體工程')} />
                <AIButton label="課程詳情" variant="ghost" />
              </View>
            </AICard>

            <AICard
              aiGenerated
              icon="🎨"
              title="設計思考（GE201）"
              source="AI · 你關注創新議題"
              confidence="mid"
            >
              <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
                跨領域選修 · 週三 14:00–16:00 · 創意大樓 · 2 學分
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <AIButton label="加選" onPress={() => handleAdd('設計思考')} />
              </View>
            </AICard>
          </AISection>

          <AISection title="熱門課程">
            <AIRow icon="🌐" title="網路概論" subtitle="林老師 · 週二 13:10 · 系必修 3 學分" tag="32/40" tagTone="ai" />
            <AIRow icon="🤖" title="機器學習導論" subtitle="王老師 · 週四 09:10 · 選修 3" tag="額滿" tagTone="warning" />
            <AIRow icon="🎭" title="戲劇欣賞" subtitle="通識 · 2 學分" tag="可加" tagTone="success" />
          </AISection>
        </>
      )}

      {tab === 'my' && (
        <AISection title="本學期已選" subtitle="6 門 · 18 學分">
          <AIRow icon="📐" title="資料結構" subtitle="王大明 · 3 學分" tag="退選" tagTone="danger" />
          <AIRow icon="🗄" title="資料庫系統" subtitle="陳老師 · 3 學分" tag="退選" tagTone="danger" />
          <AIRow icon="💾" title="作業系統" subtitle="林老師 · 3 學分" tag="退選" tagTone="danger" />
          <AIRow icon="📊" title="統計學" subtitle="黃老師 · 3 學分" tag="退選" tagTone="danger" />
          <AIRow icon="✍️" title="英文寫作" subtitle="Tom · 3 學分" tag="退選" tagTone="danger" />
          <AIRow icon="🎯" title="專題討論" subtitle="王老師 · 3 學分" tag="退選" tagTone="danger" />
        </AISection>
      )}

      {tab === 'wait' && (
        <AISection title="候補中" subtitle="2 門">
          <AIRow icon="🤖" title="機器學習導論" subtitle="候補序號 #3" tag="候補中" tagTone="warning" />
          <AIRow icon="🎮" title="遊戲設計" subtitle="候補序號 #1" tag="即將成功" tagTone="ai" />
        </AISection>
      )}

      <AILegacyLink label="完整選課系統" onPress={() => navigation?.navigate?.('AddCourseLegacy' as never)} />
    </AIDetailScreen>
  );
}

const searchStyles = StyleSheet.create({
  searchWrap: {
    marginHorizontal: aiTokens.space.md,
    marginTop: aiTokens.space.md,
    position: 'relative',
  },
  search: {
    backgroundColor: aiTokens.surface,
    borderWidth: 1,
    borderColor: aiTokens.border,
    borderRadius: aiTokens.radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 14,
    color: aiTokens.text,
    paddingRight: 50,
  },
});
