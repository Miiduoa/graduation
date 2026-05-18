/**
 * Campus AI-First — 公告列表 V2
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIChip,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function AnnouncementsListAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [cat, setCat] = useState<string>('all');

  return (
    <AIDetailScreen
      title="公告"
      subtitle="32 則 · 3 則重要"
      onBack={() => navigation?.goBack?.()}
      rightAction={<AIButton label="全部已讀" variant="ghost" size="sm" />}
    >
      <AIInsightBanner
        text="AI 從 32 則公告挑出 3 則跟你相關度最高：期末考程序、獎學金申請、補考表"
        source="AI · 個人化排序"
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
        <AIChip label="全部 32" active={cat === 'all'} onPress={() => setCat('all')} />
        <AIChip label="系務 12" active={cat === 'dept'} onPress={() => setCat('dept')} />
        <AIChip label="教務 8" active={cat === 'edu'} onPress={() => setCat('edu')} />
        <AIChip label="學務 6" active={cat === 'student'} onPress={() => setCat('student')} />
        <AIChip label="活動 4" active={cat === 'event'} onPress={() => setCat('event')} />
        <AIChip label="獎助 2" active={cat === 'aid'} onPress={() => setCat('aid')} />
      </View>

      <AISection title="🔴 AI 為你挑出 · 高相關" subtitle="3 則">
        <AIRow
          icon="📋"
          title="113-2 期末考程序與注意事項"
          subtitle="資管系系辦 · 14:30"
          tag="高相關"
          tagTone="danger"
          onPress={() => navigation?.navigate?.('AnnouncementDetail', { id: 'A001' })}
        />
        <AIRow
          icon="🎓"
          title="113-2 獎學金申請開放"
          subtitle="學務處 · 09:00 · 5/25 截止"
          tag="符合資格"
          tagTone="warning"
        />
        <AIRow icon="📝" title="113-2 補考申請表下載" subtitle="教務處 · 5/14" tag="本週" tagTone="ai" />
      </AISection>

      <AISection title="本週公告" subtitle="近 7 天 · 12 則">
        <AIRow icon="📌" title="期末讀書區延長開放" subtitle="圖書館 · 5/16" />
        <AIRow icon="📌" title="畢業班期末考程序" subtitle="教務處 · 5/15" />
        <AIRow icon="📌" title="畢業典禮校友參與報名" subtitle="校友中心 · 5/15" />
        <AIRow icon="📌" title="校園 WiFi 5/20 維護" subtitle="資訊處 · 5/14" />
        <AIRow icon="📌" title="體育課變動公告" subtitle="體育室 · 5/14" />
        <AIRow icon="📌" title="社團評鑑結果公布" subtitle="課外組 · 5/13" />
        <AIRow icon="📌" title="教學評量開放" subtitle="教務處 · 5/13" />
      </AISection>

      <AISection title="更早" subtitle="32 - 10 = 22 則">
        <AIRow icon="📂" title="5/12 之前" subtitle="點開查看歷史公告" />
      </AISection>

      <AILegacyLink
        label="完整公告系統（含留言、附件下載、訂閱）"
        onPress={() => navigation?.navigate?.('AnnouncementsLegacy' as never)}
      />
    </AIDetailScreen>
  );
}
