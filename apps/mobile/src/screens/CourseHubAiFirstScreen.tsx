/**
 * Campus AI-First — 課程 Hub V2 (LMS 課程主頁)
 */
import React from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  aiTokens,
} from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';

export default function CourseHubAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const courseId = params.courseId || 'CS302';
  const courseName = params.name || '資料庫系統';
  const groupId = String(params.groupId ?? params.courseSpaceId ?? courseId);

  const go = (screen: string, nextParams?: Record<string, unknown>) =>
    safeNavigate(navigation, screen, nextParams, {
      fallbackMessage: `已保留「${screen}」入口，demo 可先回到課程中心。`,
      fallbackRoute: 'CourseHub',
      fallbackParams: { courseId, groupId, name: courseName },
    });

  const openAIAssistant = () => {
    go('AIStudyBuddy', {
      courseId,
      groupId,
      courseName,
      initialPrompt: `我是${courseName}課程助理，可以回答期末範圍、補考申請、上週課程重點與 SQL JOIN 練習。`,
    });
  };

  const openAssignment = () => {
    go('HomeworkSubmit', {
      courseId,
      groupId,
      homeworkId: 'demo-sql-join-lab-4',
      title: 'Lab 4：SQL JOIN 練習',
    });
  };

  const openQuiz = () => {
    go('QuizCenter', {
      courseId,
      groupId,
      quizId: 'demo-db-quiz-3',
    });
  };

  const openMaterial = (title: string, materialId: string, type: 'pdf' | 'video' = 'pdf') => {
    if (type === 'video') {
      Alert.alert('影片摘要已開啟', '老師上週影片回放已整理成 5 段重點，可在教材檢視器查看。');
    }
    go('CourseMaterialViewer', {
      courseId,
      groupId,
      materialId,
      title,
      type,
    });
  };

  const openDiscussion = (threadTitle: string) => {
    go('CourseDiscussion', {
      courseId,
      groupId,
      focusThreadTitle: threadTitle,
    });
  };

  return (
    <AIDetailScreen
      title={courseName}
      subtitle={`${courseId} · 陳老師`}
      onBack={() => navigation?.goBack?.()}
    >
      {/* 課程 hero */}
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
            opacity: 0.1,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              backgroundColor: aiTokens.ai,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 28 }}>🗄</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700', letterSpacing: 0.4 }}>
              {courseId} · 3 學分
            </Text>
            <Text
              style={{ fontSize: 18, fontWeight: '700', color: aiTokens.text, marginTop: 4 }}
            >
              {courseName}
            </Text>
            <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
              陳老師 · 週一/三 13:10–14:50 · 工程館 305
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginTop: 16, gap: 24 }}>
          <Stat label="出席" value="13/15" />
          <Stat label="作業" value="6/7" />
          <Stat label="目前成績" value="88" tone="ai" />
        </View>
      </View>

      <AIInsightBanner
        text="下週四小考 · AI 已幫你準備 5 分鐘速覽 · 你目前 88 分，期末考拿 85 即可保 A-"
        source="AI · 課程資料 + 你的成績"
        confidence="high"
      />

      {/* 功能 chip */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <AIChip label="📚 教材" onPress={() => openMaterial('第 10 章 · 索引與優化', 'demo-db-index-ch10')} />
        <AIChip label="📝 作業" onPress={openAssignment} />
        <AIChip label="📊 測驗" onPress={openQuiz} />
        <AIChip label="💬 討論" onPress={() => openDiscussion('期末範圍會包含預存程序嗎？')} />
        <AIChip label="📅 課表" onPress={() => go('Calendar', { courseId, groupId })} />
        <AIChip label="📈 成績" onPress={() => go('CourseScores', { courseId, groupId })} />
      </View>

      {/* AI 課程助理 */}
      <AISection title="✨ AI 課程助理">
        <AICard aiGenerated icon="🎓" title="關於這門課，問我任何事" source="AI · 課程資料 + 你的歷史">
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            「老師上週說了什麼」「期末範圍」「補考怎麼申請」
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="開始對話" icon="✨" onPress={openAIAssistant} />
          </View>
        </AICard>
      </AISection>

      {/* 待辦 */}
      <AISection title="本週待辦" subtitle="2 件">
        <AIRow
          icon="📝"
          title="Lab 4：SQL JOIN 練習"
          subtitle="週五 23:59 · 進度 0%"
          tag="未開始"
          tagTone="warning"
          onPress={openAssignment}
        />
        <AIRow
          icon="📊"
          title="第三次小考"
          subtitle="週四 09:00 · 範圍：第 9-10 章"
          tag="已準備"
          tagTone="success"
          onPress={openQuiz}
        />
      </AISection>

      {/* 最近教材 */}
      <AISection title="最近教材">
        <AIRow
          icon="📄"
          title="第 10 章 · 索引與優化"
          subtitle="PDF · 5/17"
          onPress={() => openMaterial('第 10 章 · 索引與優化', 'demo-db-index-ch10')}
        />
        <AIRow
          icon="🎥"
          title="老師上週影片回放"
          subtitle="50:32 · AI 已切重點"
          tag="AI 摘要"
          tagTone="ai"
          onPress={() => openMaterial('老師上週影片回放', 'demo-db-week-video', 'video')}
        />
        <AIRow
          icon="📄"
          title="JOIN 範例集"
          subtitle="PDF · 5/15"
          onPress={() => openMaterial('JOIN 範例集', 'demo-db-join-examples')}
        />
      </AISection>

      {/* 討論區 */}
      <AISection title="課程討論" subtitle="3 個熱議">
        <AIRow
          icon="💬"
          title="期末範圍會包含預存程序嗎？"
          subtitle="林同學 · 12 回應"
          onPress={() => openDiscussion('期末範圍會包含預存程序嗎？')}
        />
        <AIRow
          icon="💬"
          title="Lab 3 第二題的索引怎麼建？"
          subtitle="王同學 · 8 回應"
          tag="未解"
          tagTone="warning"
          onPress={() => openDiscussion('Lab 3 第二題的索引怎麼建？')}
        />
        <AIRow
          icon="💬"
          title="期中考分數有人比想的高很多嗎"
          subtitle="陳同學 · 24 回應"
          tag="熱門"
          tagTone="ai"
          onPress={() => openDiscussion('期中考分數有人比想的高很多嗎')}
        />
      </AISection>
    </AIDetailScreen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ai' }) {
  return (
    <View>
      <Text style={{ fontSize: 11, color: aiTokens.muted, fontWeight: '600' }}>{label}</Text>
      <Text
        style={{
          fontSize: 20,
          fontWeight: '700',
          color: tone === 'ai' ? aiTokens.ai : aiTokens.text,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
