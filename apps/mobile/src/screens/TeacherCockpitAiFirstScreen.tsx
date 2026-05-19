/**
 * Campus AI-First — 教師駕駛艙 V2
 *
 * 接 demoStore：「示範：送一則公告審核」按鈕 → publishAnnouncement，
 *   系主任會立即在收件匣看到待審；核准後全體師生 + 校友會收到「公告發布」。
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
import { useDemoRole } from '../state/demoRole';
import { publishAnnouncement } from '../services/demoStore';

export default function TeacherCockpitAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const { role, definition } = useDemoRole();
  const go = useCallback(
    (screen: string, params?: any) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch {}
    },
    [navigation],
  );

  // Demo：老師送一則公告審核 → 系主任收件匣立即出現「公告待審」action 訊息
  const sendDemoAnnouncement = useCallback(() => {
    if (role !== 'teacher') {
      Alert.alert(
        '需切換成老師角色',
        `目前是「${definition.label}」，請至「我的 → 切換角色」改成「教師」再示範送公告。`,
      );
      return;
    }
    publishAnnouncement({
      title: '期末考試補考時段公告',
      content: '本學期期末考補考訂於 6/24（週三）下午 13:00，地點：任垣樓 R301。',
      teacherName: '張怡君老師',
    });
    Alert.alert(
      '✅ 公告已送審',
      '已送到系主任收件匣。\n切換成「系主任 黃主任」→ 訊息收件匣可看到「公告待審」並核准；\n核准後全體師生 + 校友會收到「公告發布」通知。',
    );
  }, [role, definition.label]);

  return (
    <AIDetailScreen
      title="教師工作台"
      subtitle="王大明老師 · 2 門課 · 88 位學生"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="今天 5 份 Lab 3 待批改 · 3 位學生分數異常下滑（AI 風險評估）· 助教林同學本週可幫批 2 小時"
        source="AI · 教學 dashboard"
        confidence="high"
      />

      {/* Quick stats */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <QuickStat label="今日課" value="2" sub="堂" />
        <QuickStat label="待批改" value="13" tone="warn" />
        <QuickStat label="風險生" value="3" tone="danger" />
        <QuickStat label="出席率" value="93%" tone="success" />
      </View>

      {/* AI 給教師的洞察 */}
      <AISection title="AI 教學洞察">
        <AICard
          aiGenerated
          icon="⚠️"
          title="3 位學生需要你關心"
          badge="高優先"
          badgeTone="danger"
          source="AI · 出席 + 成績 + 互動"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            學號 1099508、1099523、1099541 近 2 週成績明顯下滑、出席率低。
            建議單獨找一次。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="檢視學生風險" onPress={go('StudentRisk')} />
            <AIButton label="AI 起草訊息" variant="ghost" onPress={() => Alert.alert('AI 起草', '已草擬 3 份關心訊息')} />
          </View>
        </AICard>

        <AICard
          aiGenerated
          icon="📊"
          title="Lab 3 班級表現分布"
          source="AI · 自動分析"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            平均 76.5（去年 81.2）· 第二題 65% 學生卡關{'\n'}
            建議：下次課堂回顧該題；AI 已生成補充教材
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="使用補充教材" onPress={() => Alert.alert('已加入', '5/22 課堂播放清單')} />
          </View>
        </AICard>
      </AISection>

      <AISection title="我的課程">
        <AIRow
          icon="📐"
          title="資料結構 CS301"
          subtitle="48 位學生 · 今天 09:10 第 1 堂"
          tag="今日課"
          tagTone="ai"
          onPress={go('CourseHub', { courseId: 'CS301' })}
        />
        <AIRow
          icon="💾"
          title="進階演算法 CS401"
          subtitle="40 位學生 · 週三 14:10"
          onPress={go('CourseHub', { courseId: 'CS401' })}
        />
      </AISection>

      <AISection title="待批改" subtitle="13 件">
        <AIRow icon="📝" title="Lab 3 — 排程實作" subtitle="48 份 · 已批 35 / 48" tag="今晚" tagTone="warning" onPress={go('TeacherGrading', { assignment: 'lab-3' })} />
        <AIRow icon="📝" title="第二次小考" subtitle="48 份 · 已批 48 / 48" tag="完成" tagTone="success" />
      </AISection>

      <AISection title="助教">
        <AIRow icon="👤" title="林同學（TA）" subtitle="本週可幫批 2 小時" onPress={() => Alert.alert('分派批改', '已分派 8 份給林同學')} />
      </AISection>

      <AISection title="快速入口">
        <AIRow icon="📊" title="教學分析" subtitle="出席、成績、互動" onPress={go('AcademicInsights')} />
        <AIRow icon="📅" title="教學週報" subtitle="AI 自動產生" tag="AI" tagTone="ai" onPress={() => Alert.alert('週報生成中', 'AI 正在彙整本週教學資料...')} />
        <AIRow icon="🎓" title="期末成績登錄" subtitle="6/15 截止" tag="未開始" tagTone="muted" />
      </AISection>

      <AISection title="🎬 示範工具" subtitle="口試 / 演示專用：示範跨角色公告審核流">
        <AIRow
          icon="📢"
          title="示範：送一則公告審核"
          subtitle="呼叫 demoStore.publishAnnouncement → 系主任收到待審 action 訊息"
          tag="Demo"
          tagTone="ai"
          onPress={sendDemoAnnouncement}
        />
      </AISection>

      <AILegacyLink label="完整教師後台" onPress={() => navigation?.navigate?.('TeacherCockpitLegacy' as never)} />
    </AIDetailScreen>
  );
}

function QuickStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ai' | 'success' | 'warn' | 'danger';
}) {
  const color =
    tone === 'success'
      ? aiTokens.success
      : tone === 'warn'
      ? aiTokens.warning
      : tone === 'danger'
      ? aiTokens.danger
      : aiTokens.text;
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        backgroundColor: aiTokens.surface,
        borderRadius: aiTokens.radius.md,
        borderWidth: 1,
        borderColor: aiTokens.border,
      }}
    >
      <Text style={{ fontSize: 10, color: aiTokens.muted, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color }}>{value}</Text>
        {sub ? <Text style={{ fontSize: 10, color: aiTokens.muted }}>{sub}</Text> : null}
      </View>
    </View>
  );
}
