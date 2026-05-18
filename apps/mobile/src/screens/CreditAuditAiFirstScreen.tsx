/**
 * Campus AI-First — 學分試算 V2
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

const REQUIREMENTS = [
  { name: '通識', total: 28, done: 22, color: aiTokens.success },
  { name: '系必修', total: 65, done: 38, color: aiTokens.ai },
  { name: '系選修', total: 24, done: 12, color: aiTokens.warning },
  { name: '自由選修', total: 11, done: 6, color: aiTokens.muted },
];

export default function CreditAuditAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const total = REQUIREMENTS.reduce((s, r) => s + r.total, 0);
  const done = REQUIREMENTS.reduce((s, r) => s + r.done, 0);
  const pct = Math.round((done / total) * 100);

  return (
    <AIDetailScreen
      title="學分試算"
      subtitle={`畢業進度 ${pct}%`}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={`已修 ${done} / ${total} 學分 · 還差 ${
          total - done
        } 學分 · AI 預估 113-2 學期可完成所有必修，明年 6 月畢業`}
        source="AI · 學分試算引擎"
        confidence="high"
      />

      {/* 大進度條 */}
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
          畢業進度
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 6 }}>
          <Text style={{ fontSize: 56, fontWeight: '700', color: aiTokens.text, lineHeight: 60 }}>
            {pct}
          </Text>
          <Text style={{ fontSize: 22, color: aiTokens.text }}>%</Text>
        </View>
        <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 6 }}>
          {done} / {total} 學分 · 預估 113-2 完成
        </Text>
        <View
          style={{
            marginTop: 14,
            height: 10,
            backgroundColor: 'rgba(255,255,255,0.6)',
            borderRadius: 5,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${pct}%`,
              height: '100%',
              backgroundColor: aiTokens.ai,
            }}
          />
        </View>
      </View>

      <AISection title="各類別進度">
        <View
          style={{
            marginHorizontal: aiTokens.space.md,
            padding: aiTokens.space.lg,
            backgroundColor: aiTokens.surface,
            borderRadius: aiTokens.radius.lg,
            borderWidth: 1,
            borderColor: aiTokens.border,
          }}
        >
          {REQUIREMENTS.map((r) => (
            <CategoryBar
              key={r.name}
              name={r.name}
              total={r.total}
              done={r.done}
              color={r.color}
            />
          ))}
        </View>
      </AISection>

      <AISection title="AI 給的建議">
        <AICard
          aiGenerated
          icon="🎯"
          title="優先補系必修"
          badge="關鍵"
          badgeTone="danger"
          source="AI · 課程相依分析"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            還缺 <Text style={{ fontWeight: '700' }}>27 系必修學分</Text>，包含「軟體工程」與「網路概論」是進階課的前置條件。
            建議下學期排這兩門。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="AI 排下學期" onPress={() => Alert.alert('AI 課程顧問', '請至「學習 → AI 課程顧問」')} />
            <AIButton label="檢視必修清單" variant="ghost" />
          </View>
        </AICard>

        <AICard
          aiGenerated
          icon="💡"
          title="自由選修可挑跨領域"
          source="AI · 你的興趣分析"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            你還有 5 學分自由選修額度。基於你關注的議題，推薦：心理學、設計思考、創業學
          </Text>
        </AICard>
      </AISection>

      <AISection title="畢業條件檢核">
        <AIRow icon="✓" title="主修學分達標" subtitle="系上規定 128 學分" tag="進度中" tagTone="ai" />
        <AIRow icon="✓" title="通識中英文" subtitle="英文 6 學分 ✓ · 中文 6 ✓" tag="達標" tagTone="success" />
        <AIRow icon="⚠" title="服務學習" subtitle="須 30 小時，目前 18" tag="差 12h" tagTone="warning" />
        <AIRow icon="⚠" title="英文門檻" subtitle="多益 750 或同等" tag="未通過" tagTone="warning" />
      </AISection>

      <AILegacyLink label="完整學分試算（申請畢業審核）" onPress={() => navigation?.navigate?.('CreditAuditLegacy' as never)} />
    </AIDetailScreen>
  );
}

function CategoryBar({
  name,
  total,
  done,
  color,
}: {
  name: string;
  total: number;
  done: number;
  color: string;
}) {
  const pct = Math.round((done / total) * 100);
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 12, color: aiTokens.muted }}>
          {done} / {total}（{pct}%）
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: aiTokens.panel,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}
