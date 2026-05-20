/**
 * Campus AI-First — 訊息 Tab Landing
 *
 * 設計：AI 自動分類訊息 + 跨角色動作面板 + 重點摘要
 * 設計規範：docs/design/AI_FIRST_REDESIGN.md
 *
 * 本版接 mobile demoStore（services/demoStore.ts）：
 *  - 顯示動態 dynamicMessages（依目前 demoRole 過濾 recipientRoles）
 *  - 訊息詳情含 CrossRoleActionPanel：依 relatedXxxId 自動顯示
 *    審核 / 派工 / 訂單推進 / 求助回覆 / 社員審核 / 作業批改 deep-link
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, View, Text, TextInput, Pressable } from 'react-native';
import {
  AIScreen,
  AIHero,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';
import { useDemoRole } from '../state/demoRole';
import { useDemoStore } from '../state/demoStore';
import {
  getMessagesForRole,
  getUnreadCount,
  markDynamicMessageRead,
  decideLeave,
  setDormRepairStatus,
  updateOrderStatus,
  replyHelpRequest,
  approveClubMember,
  rejectClubMember,
  approveAnnouncement,
  rejectAnnouncementWithReason,
  sendMessage as sendDynamicMessage,
  type StoreDynamicMessage,
} from '../services/demoStore';

type FilterKey = 'all' | 'unread' | 'action';

export default function MessagesAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const { role: demoRole, definition: roleDef } = useDemoRole();
  const roleLabel = roleDef.label;
  const roleIcon = roleDef.icon;
  const store = useDemoStore();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const messages = useMemo(
    () =>
      (getMessagesForRole(demoRole, store) ?? []).filter((m) => {
        if (filter === 'unread') return !m.isRead && !store.readMessageIds.includes(m.id);
        if (filter === 'action') return m.type === 'action' || m.type === 'warning';
        return true;
      }),
    [demoRole, store, filter],
  );
  const unread = useMemo(() => getUnreadCount(demoRole, store), [demoRole, store]);
  const selected = useMemo(() => messages.find((m) => m.id === selectedId) ?? null, [messages, selectedId]);

  useEffect(() => {
    if (selectedId && !messages.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [messages, selectedId]);

  function open(msg: StoreDynamicMessage) {
    setSelectedId(msg.id);
    if (!store.readMessageIds.includes(msg.id)) markDynamicMessageRead(msg.id);
  }

  return (
    <AIScreen>
      <AIHero
        eyebrow={`MESSAGES · ${roleIcon} ${roleLabel}`}
        title={`${unread} 則未讀\n${messages.length} 則收件匣訊息`}
        subtitle="跨角色動作面板：選一則「待辦/提醒」訊息可直接審核 / 推進"
      />

      {/* 私訊 / 好友快速入口 */}
      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        {[
          { label: '💬 私訊', route: 'Dms' },
          { label: '👥 好友管理', route: 'FriendsManage' },
          { label: '🔍 搜尋好友', route: 'FriendSearch' },
        ].map(({ label, route }) => (
          <Pressable
            key={route}
            onPress={() => navigation?.navigate?.(route)}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 6,
              borderRadius: 10,
              backgroundColor: pressed ? aiTokens.aiSurface : aiTokens.panel,
              borderWidth: 1,
              borderColor: aiTokens.border,
              alignItems: 'center',
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: aiTokens.text, textAlign: 'center' }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Filter chips */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <AIChip label={`全部 ${messages.length}`} onPress={() => setFilter('all')} active={filter === 'all'} />
        <AIChip label={`未讀 ${unread}`} onPress={() => setFilter('unread')} active={filter === 'unread'} />
        <AIChip label="待辦 / 提醒" onPress={() => setFilter('action')} active={filter === 'action'} />
      </View>

      {/* Message list */}
      <AISection title="收件匣" subtitle={demoRole === 'guest' ? '訪客身份無收件匣' : '點訊息可開啟詳情與跨角色動作'}>
        {messages.length === 0 ? (
          <View style={{ padding: aiTokens.space.md }}>
            <Text style={{ fontSize: 13, color: aiTokens.muted }}>
              {demoRole === 'guest'
                ? '訪客不會收到訊息。'
                : '目前沒有訊息。到 Today 頁面執行學生動作（請假 / 報修 / 訂餐 / 求助），或在 Me 頁面按「一鍵 seed」。'}
            </Text>
          </View>
        ) : (
          messages.map((m) => {
            const isUnread = !m.isRead && !store.readMessageIds.includes(m.id);
            const tone =
              m.type === 'action' ? 'danger' : m.type === 'warning' ? 'warning' : m.type === 'success' ? 'success' : 'ai';
            const icon = m.fromAvatar;
            return (
              <AIRow
                key={m.id}
                icon={icon}
                title={`${isUnread ? '🔵 ' : ''}${m.fromName}`}
                subtitle={m.subject}
                tag={
                  m.type === 'action'
                    ? '待辦'
                    : m.type === 'warning'
                      ? '提醒'
                      : m.type === 'success'
                        ? '完成'
                        : '通知'
                }
                tagTone={tone as 'danger' | 'warning' | 'success' | 'ai'}
                onPress={() => open(m)}
              />
            );
          })
        )}
      </AISection>

      {/* 訊息詳情 + 跨角色面板 */}
      {selected && (
        <AISection title="訊息詳情" subtitle="跨角色動作面板會依訊息類型自動顯示">
          <AICard icon={selected.fromAvatar} title={selected.subject} source={`${selected.fromName} · ${selected.sentAt}`}>
            <View style={{ paddingVertical: 6 }}>
              <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 20 }}>{selected.body}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <AIButton label="關閉" variant="ghost" onPress={() => setSelectedId(null)} />
            </View>
          </AICard>

          <CrossRoleActionPanel
            msg={selected}
            demoRole={demoRole}
            roleLabel={`${roleIcon} ${roleLabel}`}
            onClose={() => setSelectedId(null)}
          />
        </AISection>
      )}

      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.lg,
          padding: aiTokens.space.md,
          backgroundColor: aiTokens.aiSurface,
          borderRadius: aiTokens.radius.md,
          borderWidth: 1,
          borderColor: aiTokens.aiSoft,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <AIMark size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700' }}>跨角色動作流</Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
            學生送出後切到老師 / 系主任 / admin / 社長，這個收件匣會出現對應的審核按鈕。
          </Text>
        </View>
      </View>
    </AIScreen>
  );
}

// ─────────────────────────────────────────────────────────────
// 跨角色動作面板（mobile 版）— 對應 web 的 CrossRoleActionPanel
// ─────────────────────────────────────────────────────────────

function CrossRoleActionPanel({
  msg,
  demoRole,
  roleLabel,
  onClose,
}: {
  msg: StoreDynamicMessage;
  demoRole: string;
  roleLabel: string;
  onClose: () => void;
}) {
  const done = (label: string) => {
    Alert.alert('已處理', label);
    onClose();
  };

  if (msg.relatedLeaveId && (demoRole === 'teacher' || demoRole === 'department_head')) {
    return (
      <ActionCard title="📅 請假審核" helper="核准 / 退回後，學生會立即收到通知">
        <AIButton
          label="✅ 核准請假"
          onPress={() => {
            decideLeave({ leaveId: msg.relatedLeaveId!, decision: 'approved', decidedBy: roleLabel });
            done('已核准請假，學生會收到通知');
          }}
        />
        <AIButton
          label="❌ 退回"
          variant="danger"
          onPress={() => {
            decideLeave({
              leaveId: msg.relatedLeaveId!,
              decision: 'rejected',
              decidedBy: roleLabel,
              note: '請補充病假證明後重新申請',
            });
            done('已退回請假，學生會收到通知');
          }}
        />
      </ActionCard>
    );
  }

  if (msg.relatedDormRepairId && demoRole === 'admin') {
    return (
      <ActionCard title="🔧 報修派工" helper="派工 / 完工後學生即時收到狀態通知">
        <AIButton
          label="🔧 派工中"
          onPress={() => {
            setDormRepairStatus(msg.relatedDormRepairId!, 'dispatched');
            done('已派工，學生會收到通知');
          }}
        />
        <AIButton
          label="✅ 完工"
          onPress={() => {
            setDormRepairStatus(msg.relatedDormRepairId!, 'resolved');
            done('已完工，學生會收到通知');
          }}
        />
      </ActionCard>
    );
  }

  if (msg.relatedOrderId && demoRole === 'vendor') {
    return (
      <ActionCard title="🍱 訂單推進" helper="推進訂單狀態後學生收到對應通知">
        <AIButton
          label="🍳 準備中"
          onPress={() => {
            updateOrderStatus(msg.relatedOrderId!, 'processing');
            done('訂單已標記為準備中');
          }}
        />
        <AIButton
          label="🛎️ 已備好"
          onPress={() => {
            updateOrderStatus(msg.relatedOrderId!, 'ready');
            done('訂單已備好');
          }}
        />
        <AIButton
          label="❌ 取消"
          variant="danger"
          onPress={() => {
            updateOrderStatus(msg.relatedOrderId!, 'cancelled');
            done('訂單已取消');
          }}
        />
      </ActionCard>
    );
  }

  if (msg.relatedHelpId && (demoRole === 'ta' || demoRole === 'teacher')) {
    return <HelpReplyCard helpId={msg.relatedHelpId} roleLabel={roleLabel} onDone={done} />;
  }

  if (msg.relatedClubMembershipId && demoRole === 'club_officer') {
    return (
      <ActionCard title="📨 社員申請" helper="核准 / 拒絕後學生收到結果通知">
        <AIButton
          label="✅ 核准"
          onPress={() => {
            approveClubMember(msg.relatedClubMembershipId!, { officerName: roleLabel });
            done('已核准，學生會收到通知');
          }}
        />
        <AIButton
          label="❌ 拒絕"
          variant="danger"
          onPress={() => {
            rejectClubMember(msg.relatedClubMembershipId!, { officerName: roleLabel });
            done('已拒絕，學生會收到通知');
          }}
        />
      </ActionCard>
    );
  }

  if (msg.relatedAssignmentId && (demoRole === 'teacher' || demoRole === 'ta')) {
    return (
      <ActionCard title="📝 作業批改" helper="該學生已繳交，請前往課程成績簿批改">
        <AIButton
          label="前往成績簿 →"
          onPress={() => Alert.alert('前往成績簿', `課程 ${msg.relatedCourseId ?? 'c1'} 成績簿（mobile demo 範圍：請切到 web 演示完整 gradebook）`)}
        />
      </ActionCard>
    );
  }

  if (msg.relatedPendingAnnId && demoRole === 'department_head') {
    const annTitle = msg.subject.replace(/^【公告待審】[^：]+：/, '');
    return (
      <ActionCard title="📢 公告審核" helper="核准後全體師生收到發布通知；退回後老師收到退件原因">
        <AIButton
          label="✅ 核准發布"
          onPress={() => {
            approveAnnouncement({
              pendingId: msg.relatedPendingAnnId!,
              title: annTitle,
              approverName: roleLabel,
              submitterName: msg.fromName.replace(/（系統通知）$/, ''),
            });
            done('已核准，師生會收到發布通知');
          }}
        />
        <AIButton
          label="❌ 退回並說明"
          variant="danger"
          onPress={() => {
            rejectAnnouncementWithReason({
              pendingId: msg.relatedPendingAnnId!,
              title: annTitle,
              approverName: roleLabel,
              reason: '格式需修正，請重新送審',
            });
            done('已退回，老師會收到退件原因');
          }}
        />
      </ActionCard>
    );
  }

  // 動態訊息且為使用者角色：提供 reply（放最後，避免擋住上方有 relatedXxxId 的訊息）
  if (msg.senderRole && msg.recipientRoles.includes(demoRole as never)) {
    return <ReplyCard msg={msg} roleLabel={roleLabel} senderRole={msg.senderRole} onDone={done} />;
  }

  return null;
}

function ActionCard({ title, helper, children }: { title: string; helper: string; children: React.ReactNode }) {
  return (
    <AICard icon="⚡" title={title} source={helper}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>{children}</View>
    </AICard>
  );
}

function HelpReplyCard({
  helpId,
  roleLabel,
  onDone,
}: {
  helpId: string;
  roleLabel: string;
  onDone: (label: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <AICard icon="🙋" title="求助快速回覆" source="回覆後求助狀態變更為「已回覆」">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="輸入回覆內容..."
        placeholderTextColor={aiTokens.muted}
        multiline
        style={{
          minHeight: 60,
          backgroundColor: aiTokens.panel,
          borderRadius: aiTokens.radius.sm,
          padding: 10,
          fontSize: 13,
          color: aiTokens.text,
          marginBottom: 10,
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <AIButton
          label="送出回覆"
          onPress={() => {
            const t = text.trim();
            if (!t) return;
            replyHelpRequest({ helpId, reply: t, replierName: roleLabel });
            setText('');
            onDone('已回覆，學生會收到通知');
          }}
        />
      </View>
    </AICard>
  );
}

function ReplyCard({
  msg,
  roleLabel,
  senderRole,
  onDone,
}: {
  msg: StoreDynamicMessage;
  roleLabel: string;
  senderRole: string;
  onDone: (label: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <AICard icon="↩" title={`回覆 ${msg.fromName}`} source="送出後對方在收件匣收到回覆">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="輸入回覆..."
        placeholderTextColor={aiTokens.muted}
        multiline
        style={{
          minHeight: 60,
          backgroundColor: aiTokens.panel,
          borderRadius: aiTokens.radius.sm,
          padding: 10,
          fontSize: 13,
          color: aiTokens.text,
          marginBottom: 10,
        }}
      />
      <AIButton
        label="送出"
        onPress={() => {
          const t = text.trim();
          if (!t) return;
          sendDynamicMessage({
            fromName: roleLabel,
            fromAvatar: '💬',
            subject: `Re: ${msg.subject}`,
            body: t,
            sentAt: '剛剛',
            isRead: false,
            type: 'info',
            inReplyTo: msg.id,
            recipientRoles: [senderRole as never],
          });
          setText('');
          onDone('已回覆');
        }}
      />
    </AICard>
  );
}
