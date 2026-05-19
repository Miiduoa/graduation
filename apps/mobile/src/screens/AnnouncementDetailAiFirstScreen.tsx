/**
 * Campus AI-First — 公告詳情 V2
 *
 * 接收與舊版相同的 route.params（id / announcementId）→ 不破壞既有導航
 * 設計：AI 摘要在最上 + 重點抽取 + 內文 + 動作 + 連回舊版
 *
 * 接 demoStore：學生「私訊系辦/老師詢問」按鈕 → sendMessage 寫 store + 通知老師/admin。
 */
import React from 'react';
import { Alert, View, Text } from 'react-native';
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
import { useDemoRole } from '../state/demoRole';
import { sendMessage } from '../services/demoStore';

export default function AnnouncementDetailAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const announcementId: string = params.id || params.announcementId || 'A001';
  const { role, definition } = useDemoRole();

  // 演示資料（之後可串實際 store）
  const ann = {
    id: announcementId,
    title: '【系務通知】113-2 學期期末考程序與注意事項',
    category: '系務',
    sender: '資管系系辦',
    pinned: true,
    publishedAt: '2026-05-17 14:30',
    deadline: '2026-06-10',
    body:
      '各位同學好：\n\n113-2 學期期末考將於 6/10 起舉行，相關事項說明如下：\n\n1. 應攜帶學生證 + 一份附照片證件\n2. 不得遲到逾 20 分鐘\n3. 考程衝堂請於 5/25 前申請\n4. 補考申請：考試後 7 日內提出，需附證明\n\n如有疑問請洽系辦 (07) 1234-5678 分機 1234',
  };

  return (
    <AIDetailScreen
      title="公告詳情"
      subtitle={ann.sender}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={`期末考 6/10 起 · 衝堂申請 5/25 前 · 補考 7 日內提出 · 已自動排進你的行事曆`}
        source="AI · 從公告內文抽取"
        confidence="high"
      />

      {/* 標題卡 */}
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
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {ann.pinned && (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: aiTokens.radius.pill,
                backgroundColor: aiTokens.dangerSoft,
              }}
            >
              <Text style={{ fontSize: 11, color: aiTokens.danger, fontWeight: '700' }}>
                📌 置頂
              </Text>
            </View>
          )}
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: aiTokens.radius.pill,
              backgroundColor: aiTokens.aiSoft,
            }}
          >
            <Text style={{ fontSize: 11, color: aiTokens.ai, fontWeight: '700' }}>
              {ann.category}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: aiTokens.text, lineHeight: 26 }}>
          {ann.title}
        </Text>
        <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 8 }}>
          {ann.sender} · {ann.publishedAt}
        </Text>
      </View>

      {/* AI 行動建議 */}
      <AISection title="AI 為你採取行動">
        <AICard
          aiGenerated
          icon="📅"
          title="已自動加入行事曆"
          source="AI · 從截止日推導"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            6/10 期末考、5/25 衝堂申請截止
          </Text>
        </AICard>

        <AICard
          aiGenerated
          icon="💬"
          title="衝堂申請草稿"
          badge="待你確認"
          badgeTone="warning"
          source="AI · 從你的課表偵測"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            檢測到你 6/10 與 6/11 各有 2 場期末，可能衝堂
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="檢視衝堂" icon="⚠" />
            <AIButton
              label="一鍵生成申請"
              variant="ghost"
              onPress={() => {
                if (role !== 'student') {
                  Alert.alert(
                    '需切換成學生角色',
                    `目前是「${definition.label}」，請先切回學生再送出衝堂申請。`,
                  );
                  return;
                }
                sendMessage({
                  fromName: '王小明（衝堂申請）',
                  fromAvatar: '📝',
                  subject: `【衝堂申請】${ann.title}`,
                  body: `來自學生 王小明 的衝堂申請：\n\n公告：${ann.title}\n衝堂日期：6/10、6/11\n\n請系辦/教務處協助安排補考時段。`,
                  sentAt: '剛剛',
                  isRead: false,
                  type: 'action',
                  relatedAnnouncementId: ann.id,
                  senderRole: 'student',
                  recipientRoles: ['admin', 'department_head'],
                });
                Alert.alert(
                  '申請已送出',
                  '已將衝堂申請送到系辦/教務處，切換到管理員角色可在 Messages 看到。',
                );
              }}
            />
          </View>
        </AICard>

        <AICard icon="💬" title="向系辦發問" source="直接寄到系辦 Inbox" confidence="high">
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            對公告內容有疑問？一鍵寄訊息給系辦。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton
              label="問系辦"
              onPress={() => {
                if (role !== 'student') {
                  Alert.alert(
                    '需切換成學生角色',
                    `目前是「${definition.label}」，請先切回學生角色再送詢問。`,
                  );
                  return;
                }
                sendMessage({
                  fromName: '王小明（提問）',
                  fromAvatar: '💬',
                  subject: `【提問】${ann.title}`,
                  body: `學生 王小明 對公告「${ann.title}」有疑問，希望系辦能說明：\n\n[請在這裡輸入問題]`,
                  sentAt: '剛剛',
                  isRead: false,
                  type: 'action',
                  relatedAnnouncementId: ann.id,
                  senderRole: 'student',
                  recipientRoles: ['admin'],
                });
                Alert.alert('已送出', '系辦會在 Messages 收到你的詢問。');
              }}
            />
          </View>
        </AICard>
      </AISection>

      {/* 公告全文 */}
      <AISection title="公告全文">
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
          <Text
            style={{
              fontSize: 14,
              color: aiTokens.text,
              lineHeight: 22,
            }}
          >
            {ann.body}
          </Text>
        </View>
      </AISection>

      {/* 相關 */}
      <AISection title="相關公告" subtitle="AI 找出相關度高的 3 則">
        <AIRow icon="📋" title="113-2 補考申請表下載" subtitle="教務處 · 5/14" tag="相關" tagTone="ai" />
        <AIRow icon="📋" title="期末讀書區開放時間延長" subtitle="圖書館 · 5/16" />
        <AIRow icon="📋" title="畢業班期末考程序" subtitle="教務處 · 5/15" />
      </AISection>

      <AILegacyLink
        label="查看完整資料 / 附件 / 留言"
        onPress={() => navigation?.navigate?.('公告詳情' as never, params as never)}
      />
    </AIDetailScreen>
  );
}
