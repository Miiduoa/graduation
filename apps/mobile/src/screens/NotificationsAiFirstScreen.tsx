/**
 * Campus AI-First — 通知中心 V2
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIButton,
  AIChip,
  AIEmptyState,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

type Cat = 'all' | 'urgent' | 'class' | 'admin' | 'social' | 'system';

export default function NotificationsAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [cat, setCat] = useState<Cat>('all');

  const counts = { all: 12, urgent: 2, class: 5, admin: 3, social: 1, system: 1 };

  return (
    <AIDetailScreen
      title="通知中心"
      subtitle={`12 則新通知 · 2 則重要`}
      onBack={() => navigation?.goBack?.()}
      rightAction={<AIButton label="全部已讀" variant="ghost" size="sm" />}
    >
      <AIInsightBanner
        text="今天 12 則通知，AI 幫你篩出 2 則需要立刻處理：陳老師延長期末報告、獎學金 5/25 截止"
        source="AI · 通知重要性分類"
        confidence="high"
      />

      {/* 篩選 chips */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
        }}
      >
        <AIChip label={`全部 ${counts.all}`} active={cat === 'all'} onPress={() => setCat('all')} />
        <AIChip label={`重要 ${counts.urgent}`} active={cat === 'urgent'} onPress={() => setCat('urgent')} />
        <AIChip label={`課程 ${counts.class}`} active={cat === 'class'} onPress={() => setCat('class')} />
        <AIChip label={`系辦 ${counts.admin}`} active={cat === 'admin'} onPress={() => setCat('admin')} />
        <AIChip label={`社團 ${counts.social}`} active={cat === 'social'} onPress={() => setCat('social')} />
        <AIChip label={`系統 ${counts.system}`} active={cat === 'system'} onPress={() => setCat('system')} />
      </View>

      {/* 重要 */}
      {(cat === 'all' || cat === 'urgent') && (
        <AISection title="🔴 重要 · 需要你處理" subtitle="2 則">
          <AIRow
            icon="🔴"
            title="陳老師（資料庫）"
            subtitle="期末報告延長至下週五，請已讀回覆"
            tag="待回覆"
            tagTone="danger"
            onPress={() => navigation?.navigate?.('AnnouncementDetail' as never, { id: 'A001' } as never)}
          />
          <AIRow
            icon="🟠"
            title="系辦公告 · 獎學金申請"
            subtitle="5/25 截止 · 你符合資格"
            tag="重要"
            tagTone="warning"
          />
        </AISection>
      )}

      {/* 課程 */}
      {(cat === 'all' || cat === 'class') && (
        <AISection title="📚 課程通知" subtitle="5 則">
          <AIRow icon="📖" title="資料結構" subtitle="王老師上傳 Lab 3 範例答案" />
          <AIRow icon="📖" title="統計學" subtitle="新教材：信賴區間範例" />
          <AIRow icon="📖" title="作業系統" subtitle="林助教辦公室時間調整" />
          <AIRow icon="📖" title="資料庫系統" subtitle="陳老師：下週小考範圍公告" />
          <AIRow icon="📖" title="專題討論" subtitle="教授要求每組更新進度報告" />
        </AISection>
      )}

      {/* 系辦 */}
      {(cat === 'all' || cat === 'admin') && (
        <AISection title="🏛 系辦公告" subtitle="3 則">
          <AIRow icon="📋" title="113-2 補考申請開放" subtitle="教務處 · 5/14" />
          <AIRow icon="📋" title="期末讀書區延長開放" subtitle="圖書館 · 5/16" />
          <AIRow icon="📋" title="畢業班期末考程序" subtitle="教務處 · 5/15" />
        </AISection>
      )}

      {/* 社團 */}
      {(cat === 'all' || cat === 'social') && (
        <AISection title="🎉 社團活動" subtitle="1 則">
          <AIRow icon="🎉" title="程式設計社 · 黑客松報名" subtitle="5/23 報名截止" tag="本週" tagTone="ai" />
        </AISection>
      )}

      {/* 系統 */}
      {(cat === 'all' || cat === 'system') && (
        <AISection title="⚙ 系統通知" subtitle="1 則">
          <AIRow icon="🔄" title="校園 App 更新" subtitle="v1.0 → v1.1 已可下載" />
        </AISection>
      )}

      {cat === 'urgent' && counts.urgent === 0 && (
        <AIEmptyState icon="✨" title="沒有需要立刻處理的事" subtitle="AI 已幫你把急件全部處理掉" />
      )}

      <AILegacyLink label="完整通知歷史" onPress={() => navigation?.navigate?.('NotificationsLegacy' as never)} />
    </AIDetailScreen>
  );
}
