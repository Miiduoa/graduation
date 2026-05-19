/**
 * Campus AI-First — 社團頁 V2
 *
 * 接 demoStore：
 *   - 學生：對「招新中」社團可按「申請加入」→ 寫入 clubMemberships(pending)，
 *     並 sendMessage 給 club_officer。
 *   - 社團幹部：看得到「待審核申請」清單，可一鍵核准/退回。
 */
import React, { useCallback, useState } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIChip,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';
import { useDemoRole } from '../state/demoRole';
import { useDemoStore } from '../state/demoStore';
import { applyClub, approveClubMember, rejectClubMember } from '../services/demoStore';

export default function ClubsAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<'all' | 'mine' | 'recruit'>('all');
  const { role, definition } = useDemoRole();
  const store = useDemoStore();

  const go = useCallback(
    (screen: string, params?: any) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch {}
    },
    [navigation],
  );

  // 學生：自己已申請的社團 ID（避免重複申請）
  const myApplications = store.clubMemberships.filter(
    (m) => role === 'student' && m.studentId === 'stu-001',
  );
  const appliedClubIds = new Set(myApplications.map((m) => m.clubId));

  // 幹部：看得到的 pending 申請
  const pendingForOfficer =
    role === 'club_officer'
      ? store.clubMemberships.filter((m) => m.status === 'pending')
      : [];

  function handleApply(clubId: string, clubName: string) {
    if (role !== 'student') {
      Alert.alert('需切換成學生角色', `目前是「${definition.label}」，請至「我的 → 切換角色」改成學生再申請。`);
      return;
    }
    if (appliedClubIds.has(clubId)) {
      Alert.alert('已申請過', `${clubName} 申請正在審核中，可至訊息收件匣追蹤。`);
      return;
    }
    applyClub({
      clubId,
      clubName,
      studentId: 'stu-001',
      studentName: '王小明',
    });
    Alert.alert('申請已送出', `${clubName} 的申請已通知社團幹部審核，可至訊息追蹤。`);
  }

  return (
    <AIDetailScreen
      title="社團"
      subtitle={role === 'club_officer' ? `審核中 ${pendingForOfficer.length} 件` : '加入 2 個 · 8 個招新'}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={
          role === 'club_officer'
            ? `你是社團幹部，目前有 ${pendingForOfficer.length} 件入社申請待審核`
            : '你已加入 2 個社團（程式設計社 + 攝影社）· AI 看到 3 個社團跟你興趣高度相符'
        }
        source={role === 'club_officer' ? '幹部後台' : 'AI · 你的活動偏好'}
        confidence="mid"
      />

      {/* 幹部專屬：待審核列表 */}
      {role === 'club_officer' && pendingForOfficer.length > 0 && (
        <AISection title="待審核申請" subtitle={`${pendingForOfficer.length} 件`}>
          {pendingForOfficer.map((m) => (
            <AICard
              key={m.id}
              icon="📝"
              title={`${m.studentName} 申請加入 ${m.clubName}`}
              badge="待審核"
              badgeTone="warning"
            >
              <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
                學生：{m.studentName}（{m.studentId}）{'\n'}
                社團：{m.clubName}（{m.clubId}）{'\n'}
                申請時間：{new Date(m.appliedAt).toLocaleString('zh-TW')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <AIButton
                  label="核准"
                  onPress={() => {
                    approveClubMember(m.id, { officerName: definition.label });
                    Alert.alert('已核准', `${m.studentName} 已加入 ${m.clubName}，學生會收到通知。`);
                  }}
                />
                <AIButton
                  label="退回"
                  variant="ghost"
                  onPress={() => {
                    rejectClubMember(m.id, { officerName: definition.label });
                    Alert.alert('已退回', `已通知 ${m.studentName} 申請未通過。`);
                  }}
                />
              </View>
            </AICard>
          ))}
        </AISection>
      )}

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: aiTokens.space.md, marginTop: aiTokens.space.sm }}>
        <AIChip label="全部 28" active={filter === 'all'} onPress={() => setFilter('all')} />
        <AIChip label="我的 2" active={filter === 'mine'} onPress={() => setFilter('mine')} />
        <AIChip label="招新中 8" active={filter === 'recruit'} onPress={() => setFilter('recruit')} />
      </View>

      {(filter === 'all' || filter === 'mine') && (
        <AISection title="我的社團">
          <AICard
            icon="💻"
            title="程式設計社"
            badge="幹部"
            badgeTone="ai"
            onPress={go('ClubDetail', { id: 'C001' })}
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700' }}>120 位成員</Text> · 你是技術組副組長{'\n'}
              下次活動：黑客松 5/23 · 報名 32/50
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton label="社團管理" onPress={go('ClubManagement', { id: 'C001' })} />
              <AIButton label="活動排程" variant="ghost" onPress={go('Calendar')} />
            </View>
          </AICard>

          <AIRow
            icon="📷"
            title="攝影社"
            subtitle="46 位成員 · 5/20 校園走拍"
            tag="本週活動"
            tagTone="ai"
            onPress={go('ClubDetail', { id: 'C002' })}
          />
        </AISection>
      )}

      {(filter === 'all' || filter === 'recruit') && (
        <AISection title="AI 為你推薦" subtitle="基於你的興趣 + 課程">
          <AICard
            aiGenerated
            icon="🎸"
            title="吉他社"
            badge={appliedClubIds.has('C003') ? '審核中' : '高相關'}
            badgeTone={appliedClubIds.has('C003') ? 'warning' : 'ai'}
            source="AI · 你 5/15 對 Live 表演按過讚"
            confidence="mid"
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              5/19 19:00 招新講座 · 學生活動中心 201
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton
                label={appliedClubIds.has('C003') ? '已申請' : '申請加入'}
                onPress={() => handleApply('C003', '吉他社')}
              />
              <AIButton label="查看社團" variant="ghost" onPress={go('ClubDetail', { id: 'C003' })} />
            </View>
          </AICard>

          <AICard
            icon="🎨"
            title="美術社"
            badge={appliedClubIds.has('C004') ? '審核中' : '招新'}
            badgeTone={appliedClubIds.has('C004') ? 'warning' : 'ai'}
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              32 人 · 油畫 / 水彩 · 週五 18:30 工作坊
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton
                label={appliedClubIds.has('C004') ? '已申請' : '申請加入'}
                onPress={() => handleApply('C004', '美術社')}
              />
              <AIButton label="查看社團" variant="ghost" onPress={go('ClubDetail', { id: 'C004' })} />
            </View>
          </AICard>

          <AICard
            icon="⚽"
            title="足球社"
            badge={appliedClubIds.has('C005') ? '審核中' : '招新'}
            badgeTone={appliedClubIds.has('C005') ? 'warning' : 'ai'}
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>58 人 · 週六晨練</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton
                label={appliedClubIds.has('C005') ? '已申請' : '申請加入'}
                onPress={() => handleApply('C005', '足球社')}
              />
              <AIButton label="查看社團" variant="ghost" onPress={go('ClubDetail', { id: 'C005' })} />
            </View>
          </AICard>
        </AISection>
      )}

      {filter === 'all' && (
        <AISection title="所有社團" subtitle="28 個">
          <AIRow icon="🎭" title="戲劇社" subtitle="42 人" onPress={go('ClubDetail', { id: 'C006' })} />
          <AIRow icon="🎤" title="熱音社" subtitle="60 人" onPress={go('ClubDetail', { id: 'C007' })} />
          <AIRow icon="🏀" title="籃球社" subtitle="88 人" onPress={go('ClubDetail', { id: 'C008' })} />
          <AIRow icon="📖" title="讀書會" subtitle="24 人" onPress={go('ClubDetail', { id: 'C009' })} />
        </AISection>
      )}

      <AILegacyLink label="完整社團系統（含財務、活動排程、表單）" onPress={() => navigation?.navigate?.('ClubsLegacy' as never)} />
    </AIDetailScreen>
  );
}
