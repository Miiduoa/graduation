/**
 * Campus AI-First — 活動詳情 V2
 */
import React from 'react';
import { View, Text } from 'react-native';
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

export default function EventDetailAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const eventId = params.id || 'E001';

  const event = {
    id: eventId,
    title: '黑客松 2026 — 校園應用創新賽',
    host: '程式設計社 + 資管系',
    date: '2026-05-23（週六）09:00 – 18:00',
    location: '工程館 B101',
    capacity: 50,
    enrolled: 32,
    description:
      '8 小時內，從 0 到 1 做出能用的校園 App 原型。提供場地、餐點、評審回饋，前 3 名有獎金。',
    tags: ['程式', '創新', '比賽'],
  };

  return (
    <AIDetailScreen
      title="活動詳情"
      onBack={() => navigation?.goBack?.()}
    >
      {/* Event hero */}
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
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {event.tags.map((t) => (
            <View
              key={t}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: aiTokens.radius.pill,
                backgroundColor: aiTokens.aiSoft,
              }}
            >
              <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700' }}>{t}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: aiTokens.text, lineHeight: 30 }}>
          {event.title}
        </Text>
        <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 8 }}>{event.host}</Text>

        <View style={{ marginTop: 14, gap: 6 }}>
          <Text style={{ fontSize: 13, color: aiTokens.text }}>📅 {event.date}</Text>
          <Text style={{ fontSize: 13, color: aiTokens.text }}>📍 {event.location}</Text>
          <Text style={{ fontSize: 13, color: aiTokens.text }}>
            👥 {event.enrolled} / {event.capacity} 已報名
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <AIButton label="立即報名" icon="✨" />
          <AIButton label="加入行事曆" variant="ghost" />
        </View>
      </View>

      <AIInsightBanner
        text="你在 5/15 對社群上的「黑客松」按過讚 · 你週六無課 · 已有 2 位朋友報名"
        source="AI · 你的興趣 + 行事曆"
        confidence="mid"
      />

      <AISection title="活動介紹">
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
          <Text style={{ fontSize: 14, color: aiTokens.text, lineHeight: 22 }}>
            {event.description}
          </Text>
        </View>
      </AISection>

      <AISection title="議程">
        <AIRow icon="🕘" title="09:00 報到" subtitle="工程館 B101" />
        <AIRow icon="🕘" title="09:30 開場 + 主題公布" />
        <AIRow icon="🕘" title="10:00 – 17:00 開發時間" subtitle="附中午便當" />
        <AIRow icon="🕘" title="17:00 – 18:00 評審 + 頒獎" />
      </AISection>

      <AISection title="AI 為你建議">
        <AICard aiGenerated icon="👥" title="你的朋友 2 人已報名" source="AI · 通訊錄" confidence="mid">
          <Text style={{ fontSize: 13, color: aiTokens.text }}>
            林同學、王同學已報名。要不要組隊？
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="找隊友 / 組隊" />
            <AIButton label="獨自參加" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      <AILegacyLink
        label="完整活動頁（含留言、附件、票券）"
        onPress={() => navigation?.navigate?.('EventDetailLegacy' as never, params as never)}
      />
    </AIDetailScreen>
  );
}
