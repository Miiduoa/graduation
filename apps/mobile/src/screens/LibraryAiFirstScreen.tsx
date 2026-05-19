/**
 * Campus AI-First — 圖書館 V2
 *
 * 接 demoStore：續借 / 預約 → renewBook / reserveBook，更新 borrowingOverrides
 * 與 libraryReservations。學生切換進來會看到續借後的到期日（持久化）。
 */
import React, { useCallback, useMemo } from 'react';
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
import { useDemoStore } from '../state/demoStore';
import { renewBook, reserveBook } from '../services/demoStore';

const BOOK_ALGO = {
  id: 'BK-ALGO-4',
  title: '演算法導論（第 4 版）',
  defaultDueDate: '2026-05-22',
};

const BOOK_DDIA = {
  id: 'BK-DDIA',
  title: 'Designing Data-Intensive Applications',
};

export default function LibraryAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const { role, definition } = useDemoRole();
  const store = useDemoStore();

  const algoOverride = store.borrowingOverrides[BOOK_ALGO.id];
  const algoDueDate = algoOverride?.dueDate ?? BOOK_ALGO.defaultDueDate;
  const algoRenewCount = algoOverride?.renewCount ?? 0;
  const ddiaReserved = useMemo(
    () => store.libraryReservations.some((r) => r.bookId === BOOK_DDIA.id && r.studentId === 'stu-001'),
    [store.libraryReservations],
  );

  const go = useCallback(
    (screen: string) => () => {
      try {
        navigation?.navigate?.(screen as never);
      } catch {}
    },
    [navigation],
  );

  function handleRenew() {
    if (role !== 'student') {
      Alert.alert('需切換成學生角色', `目前是「${definition.label}」，請切回學生角色再續借。`);
      return;
    }
    if (algoRenewCount >= 2) {
      Alert.alert('無法續借', '此本書已續借 2 次，請至櫃台辦理。');
      return;
    }
    renewBook(BOOK_ALGO.id, algoDueDate, algoRenewCount);
    Alert.alert('已續借', '已寫入 demoStore，新到期日會即時更新到卡片。');
  }

  function handleReserve() {
    if (role !== 'student') {
      Alert.alert('需切換成學生角色', `目前是「${definition.label}」，請切回學生角色再預約。`);
      return;
    }
    if (ddiaReserved) {
      Alert.alert('已預約', '你已預約這本書，可在訊息追蹤。');
      return;
    }
    reserveBook({
      bookId: BOOK_DDIA.id,
      bookTitle: BOOK_DDIA.title,
      studentId: 'stu-001',
      studentName: '王小明',
    });
    Alert.alert('預約成功', '已寫入 demoStore + 寄通知到你的 Inbox。');
  }

  return (
    <AIDetailScreen
      title="圖書館"
      subtitle="開放至 22:00"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="3F 自習區剩 23 座位（63% 滿）· 你借的《演算法導論》5/22 到期 · 期末讀書區延長到 23:00"
        source="即時館內 + 你的借閱"
        confidence="high"
      />

      <AISection title="即時館內狀況">
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
          <FloorStat name="1F · 大廳" total={80} used={32} />
          <FloorStat name="2F · 期刊區" total={120} used={45} />
          <FloorStat name="3F · 自習區" total={150} used={94} highlight />
          <FloorStat name="4F · 研究小間" total={20} used={18} warn />
        </View>
      </AISection>

      <AISection title="我的借閱">
        <AICard
          icon="📖"
          title="演算法導論（第 4 版）"
          badge={algoRenewCount > 0 ? `已續借 ${algoRenewCount} 次` : '5 天後到期'}
          badgeTone={algoRenewCount > 0 ? 'success' : 'warning'}
          source="借閱紀錄"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            借閱日：5/01 · 到期：{algoDueDate} · 剩可續借 {Math.max(0, 2 - algoRenewCount)} 次
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton
              label={algoRenewCount >= 2 ? '已達上限' : '續借'}
              onPress={handleRenew}
            />
            <AIButton label="導航到書架" variant="ghost" />
          </View>
        </AICard>

        <AIRow icon="📚" title="作業系統概念" subtitle="到期：6/01" tag="正常" tagTone="success" />
      </AISection>

      <AISection title="AI 為你推薦">
        <AICard
          aiGenerated
          icon="💡"
          title="《Designing Data-Intensive Applications》"
          source="AI · 你選了資料庫系統"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            與你目前修的「資料庫系統」高度相關，3F 索取號 QA76.9.D32 · 在架
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label={ddiaReserved ? '已預約' : '預約'} onPress={handleReserve} />
            <AIButton label="找位置" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      <AISection title="服務">
        <AIRow icon="🔍" title="館藏查詢 OPAC" onPress={go('LibrarySearch')} />
        <AIRow icon="📅" title="研究小間預約" subtitle="4F 1 間可預約" onPress={go('RoomReserve')} />
        <AIRow icon="🎓" title="畢業書單建議" subtitle="AI 整理 32 本" tag="AI" tagTone="ai" onPress={go('LibraryAI')} />
        <AIRow icon="💾" title="電子資源" subtitle="期刊、論文、影音" onPress={go('LibraryDigital')} />
      </AISection>

      <AILegacyLink label="完整圖書館系統" onPress={() => navigation?.navigate?.('LibraryLegacy' as never)} />
    </AIDetailScreen>
  );
}

function FloorStat({
  name,
  total,
  used,
  highlight,
  warn,
}: {
  name: string;
  total: number;
  used: number;
  highlight?: boolean;
  warn?: boolean;
}) {
  const pct = Math.round((used / total) * 100);
  const color = warn ? aiTokens.danger : highlight ? aiTokens.ai : aiTokens.muted;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 12, color }}>
          {used} / {total}（{pct}%）
        </Text>
      </View>
      <View
        style={{
          marginTop: 6,
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
