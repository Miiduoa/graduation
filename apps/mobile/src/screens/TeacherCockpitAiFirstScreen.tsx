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
  AISection,
  AICard,
  AIRow,
  AIButton,
  aiTokens,
} from '../ui/aiFirst';
import { useDemoRole } from '../state/demoRole';
import { publishAnnouncement } from '../services/demoStore';
import { safeNavigate } from '../utils/safeNavigate';

export default function TeacherCockpitAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const { role, definition } = useDemoRole();
  const go = useCallback(
    (screen: string, params?: any) => () => {
      safeNavigate(navigation, screen, params, {
        fallbackMessage: `「${screen}」目前無法直接開啟，demo 已保留此入口。`,
      });
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
      title="教師工作台 · 範例"
      subtitle="本機示範資料 · 未連結正式校務系統"
      onBack={() => navigation?.goBack?.()}
    >
      <View
        style={{
          margin: aiTokens.space.md,
          padding: aiTokens.space.md,
          backgroundColor: aiTokens.surface,
          borderRadius: aiTokens.radius.md,
          borderWidth: 1,
          borderColor: aiTokens.border,
        }}
      >
        <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
          本頁課程、分數與學生資訊均為範例。示範批改只會建立本機通知，不會同步正式成績。
        </Text>
      </View>

      {/* Quick stats */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <QuickStat label="今日課" value="—" sub="未串接" />
        <QuickStat label="待批改" value="2" tone="warn" />
        <QuickStat label="風險生" value="—" tone="danger" />
        <QuickStat label="出席率" value="—" tone="success" />
      </View>

      {/* AI 給教師的洞察 */}
      <AISection title="教學資訊（範例）">
        <AICard
          icon="⚠️"
          title="學生關懷情境"
          badge="範例"
          badgeTone="muted"
          source="非真實學籍資料"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            這是輔導流程的介面範例，未讀取學生的實際成績或出席資料。
            正式輔導判斷必須以校務系統的授權資料為準。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="查看示範流程" onPress={go('StudentRisk')} />
            <AIButton label="檢視範例說明" variant="ghost" onPress={() => Alert.alert('範例資料', '此頁沒有執行真實的學生風險判斷或訊息草擬。')} />
          </View>
        </AICard>

        <AICard
          icon="📊"
          title="班級分數分布（範例）"
          source="靜態範例，未比對歷年資料"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            範例平均 76.5 分；示範資料顯示第二題有較多錯誤。{'\n'}
            這些數字不用於正式教學決策。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="查看資料說明" onPress={() => Alert.alert('範例資料', '這些指標不是即時課堂分析結果。')} />
          </View>
        </AICard>
      </AISection>

      <AISection title="我的課程">
        <AIRow
          icon="📐"
          title="資料結構 CS301（範例）"
          subtitle="示範課程 · 非即時資料"
          tag="今日課"
          tagTone="ai"
          onPress={go('CourseHub', { courseId: 'CS301' })}
        />
        <AIRow
          icon="💾"
          title="進階演算法 CS401（範例）"
          subtitle="示範課程 · 非即時資料"
          onPress={go('CourseHub', { courseId: 'CS401' })}
        />
      </AISection>

      <AISection title="示範批改" subtitle="2 份待處理；3 份範例">
        <AIRow
          icon="📝"
          title="機器學習 · 作業批改練習"
          subtitle="3 份範例繳交 · 2 份未批改 · 僅本機通知"
          tag="示範"
          tagTone="muted"
          onPress={go('TeacherGrading', {
            assignmentId: '1',
            assignmentTitle: '作業批改練習',
            courseId: '71378',
            courseName: '機器學習',
          })}
        />
        <AIRow icon="📝" title="第二次小考（範例）" subtitle="尚未連接正式成績資料" tag="範例" tagTone="muted" onPress={() => Alert.alert('範例入口', '目前沒有已發布的真實小考成績可供查詢。')} />
      </AISection>

      <AISection title="助教">
        <AIRow icon="👤" title="林同學（TA）" subtitle="本週可幫批 2 小時" onPress={() => Alert.alert('分派批改', '已分派 8 份給林同學')} />
      </AISection>

      <AISection title="快速入口">
        <AIRow icon="📊" title="教學分析" subtitle="出席、成績、互動" onPress={go('AcademicInsights')} />
        <AIRow icon="📅" title="教學週報" subtitle="尚未串接正式教學資料" tag="範例" tagTone="muted" onPress={() => Alert.alert('尚未開放', '此頁尚未串接正式教學資料，無法產出有效週報。')} />
        <AIRow icon="🎓" title="成績登錄（範例）" subtitle="請以校務系統公告為準" tag="範例" tagTone="muted" onPress={go('CourseGradebook', { courseId: 'CS301' })} />
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
