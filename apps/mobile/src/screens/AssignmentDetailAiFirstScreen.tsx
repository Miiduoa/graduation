/**
 * Campus AI-First — 作業詳情 V2
 * route.params: { assignmentId, courseId? }
 */
import React from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AICard,
  AISection,
  AIButton,
  AIRow,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function AssignmentDetailAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const assignmentId: string = params.assignmentId || 'HW001';

  const assignment = {
    id: assignmentId,
    title: '作業系統 Lab 3：實作 Round-Robin 排程',
    course: '作業系統 CS304',
    courseColor: aiTokens.warning,
    deadline: '2026-05-21 23:59',
    daysLeft: 3,
    progress: 0,
    points: 20,
    submittedCount: 32,
    totalStudents: 48,
  };

  return (
    <AIDetailScreen
      title={assignment.course}
      subtitle={`截止剩 ${assignment.daysLeft} 天`}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={`你還沒開始 · 同班 ${assignment.submittedCount}/${assignment.totalStudents} 已繳 · AI 預估你需 4 小時 · 建議今晚 19:00–23:00`}
        source="AI · 你的歷史交件節奏"
        confidence="mid"
      />

      {/* 截止倒數 + 進度 */}
      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
          padding: aiTokens.space.lg,
          backgroundColor: aiTokens.surface,
          borderRadius: aiTokens.radius.lg,
          borderWidth: 1,
          borderColor: aiTokens.border,
        }}
      >
        <Text style={{ fontSize: 11, color: aiTokens.warning, fontWeight: '700' }}>
          截止倒數
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 6 }}>
          <Text style={{ fontSize: 48, fontWeight: '700', color: aiTokens.text, lineHeight: 56 }}>
            {assignment.daysLeft}
          </Text>
          <Text style={{ fontSize: 16, color: aiTokens.muted }}>天</Text>
          <Text style={{ fontSize: 13, color: aiTokens.muted, marginLeft: 8 }}>
            5/21 23:59
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: aiTokens.text, marginTop: 14, lineHeight: 26 }}>
          {assignment.title}
        </Text>
        <View
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: aiTokens.border,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>你的進度</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.danger, marginTop: 2 }}>
              {assignment.progress}%
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>滿分</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.text, marginTop: 2 }}>
              {assignment.points} 分
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 11, color: aiTokens.muted }}>班上繳交率</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.text, marginTop: 2 }}>
              {Math.round((assignment.submittedCount / assignment.totalStudents) * 100)}%
            </Text>
          </View>
        </View>
      </View>

      {/* AI 引導 */}
      <AISection title="AI 為你準備" subtitle="不直接給答案，給你學會的方法">
        <AICard
          aiGenerated
          icon="🧠"
          title="拆解作業：4 步驟讓你不卡關"
          source="AI · 課程教材分析"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 20 }}>
            1. 讀懂題意（10 min）{'\n'}
            2. 畫排程時序圖（20 min）{'\n'}
            3. 用 C/Python 實作 RR（120 min）{'\n'}
            4. 寫測試 + 報告（90 min）
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="開始第 1 步" icon="🚀" />
            <AIButton label="排到我的行事曆" variant="ghost" />
          </View>
        </AICard>

        <AICard
          aiGenerated
          icon="💡"
          title="可能的關卡 + 解法"
          source="AI · 從同學常見問題"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            ⚠ Time slice 邊界處理：很多人卡在「最後一個 process 不滿一個 quantum」{'\n'}
            ⚠ 排程器 vs 進程：上學期王老師強調過的概念
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="開啟相關筆記" />
            <AIButton label="問助教" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      {/* 評分標準 */}
      <AISection title="評分標準">
        <AIRow icon="✓" title="程式正確性" subtitle="60%" tag="60%" tagTone="ai" />
        <AIRow icon="📊" title="效能測試" subtitle="20%" tag="20%" tagTone="muted" />
        <AIRow icon="📝" title="文件 + 心得" subtitle="20%" tag="20%" tagTone="muted" />
      </AISection>

      {/* 繳交區 */}
      <AISection title="繳交">
        <View
          style={{
            marginHorizontal: aiTokens.space.md,
            padding: aiTokens.space.lg,
            backgroundColor: aiTokens.surface,
            borderRadius: aiTokens.radius.lg,
            borderWidth: 1,
            borderColor: aiTokens.border,
            borderStyle: 'dashed',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Text style={{ fontSize: 36 }}>📎</Text>
          <Text style={{ fontSize: 13, color: aiTokens.muted, textAlign: 'center' }}>
            還未繳交 · 可上傳壓縮檔 / GitHub 連結
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <AIButton label="上傳檔案" icon="📁" />
            <AIButton label="連結 Git" variant="ghost" />
          </View>
        </View>
      </AISection>

      <AILegacyLink
        label="完整版（含留言、評分歷史、附件）"
        onPress={() => navigation?.navigate?.('AssignmentDetailLegacy' as never, params as never)}
      />
    </AIDetailScreen>
  );
}
